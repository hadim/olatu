"""Météo-France wind per STATION → one unified, buoy-style tiered dataset per station.

See specs/2026-07-24-0012-wind.md. Wind is keyed by **station**, shared across buoys (a wind
observation is a property of a place, and buoys can share a station) — the exact analog of
tides/ports. Each buoy resolves to its nearest curated station (schema.resolve_wind_station).

**One series per station**, structured exactly like a buoy campaign so the webapp can plot a
station beside a buoy on the same time axis at any zoom (years ↔ a single day):

    wind/<station>/raw/<station>_hist.csv          one-shot HOURLY history 2010→seed (immutable)
    wind/<station>/raw/<station>_<YEAR>_live.csv    forward-growing 6-MIN accumulator (per year)
    wind/<station>/data/manifest.json | latest.json | recent.json
    wind/<station>/data/year/<station>_<YEAR>.parquet    native cadence (hourly ≤seed, 6-min after)
    wind/<station>/data/hourly/<station>_<YEAR>.parquet  hourly means (uniform over all history)
    wind/<station>/data/daily.parquet                    daily means (the wide "years" view)

Two feeds, one schema (8 canonical vars, sensible units):
  - **Historical, hourly, no key** — the open bulk files on meteo.data.gouv.fr
    (`donnees-climatologiques-de-base-horaires`). Fetched ONCE (`--seed`), written to `_hist.csv`,
    never refreshed: from the seed onward the record grows only from the 6-min feed.
  - **Live, 6-minute, `METEOFRANCE_API_KEY`** — the DPObs API. Each run polls the recent 6-min
    grid and appends to the per-year `_live.csv`. Units differ (`t` Kelvin→°C, `pmer` Pa→hPa,
    gust `raf10`); 429s are retried, not swallowed (the API caps at 100 req/min).

`build_station` coalesces hist+live (hist-preferred, never interpolates) and (re)emits the tiers,
mirroring `ingest/build.py`. A missing/bad station or a fetch failure is non-fatal.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import re
import shutil
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import polars as pl

from . import build as build_mod
from . import ui
from .schema import (
    CAMPAIGN_ID,
    WIND_DIRECTION_VARS,
    WIND_HEADLINE,
    WIND_HOURLY_MAP,
    WIND_SOURCE,
    WIND_STATIONS,
    WIND_UNITS,
    resolve_wind_station,
)

DEFAULT_REPO = "hadim/olatu"  # HF bucket id
DATASET = "donnees-climatologiques-de-base-horaires"
DATAGOUV_API = f"https://www.data.gouv.fr/api/1/datasets/{DATASET}/"
START_YEAR = 2010  # history tied to the wave archive (specs/0012 §2.1)
DT = "datetime_utc"
ROW_GROUP_SIZE = build_mod.ROW_GROUP_SIZE

# Upper bound on any single network step (same knob as update.NET_TIMEOUT_S). The bulk files
# reach ~50 MB, so give the download a generous read timeout under the watchdog.
NET_TIMEOUT_S = float(os.environ.get("OLATU_NET_TIMEOUT", "600"))

# The 8 canonical wind columns (order = WIND_UNITS), i.e. everything but the datetime.
_TIER_COLS = list(WIND_UNITS.keys())

# --- 6-minute live (DPObs API). Ingest-only key, never in the client.
DPOBS_BASE = "https://public-api.meteofrance.fr/public/DPObs/v2"
ENV_KEY = "METEOFRANCE_API_KEY"
LIVE_STEP_MIN = 6  # the DPObs infra-hourly cadence
LIVE_LOOKBACK_MIN = 66  # routine per-run window: > 2x the 30-min cron gap (11 points)
LIVE_SEED_HOURS = 12  # `--seed`: initial 6-min backfill so latest.json isn't empty
DPOBS_PACE_S = 0.1  # polite spacing between DPObs calls
DPOBS_RETRY_STATUS = frozenset(
    {429, 500, 502, 503, 504}
)  # back off + retry, don't swallow
# DPObs 6-min CSV column -> canonical. Same 8 variables as the hourly bulk BUT different source
# names and UNITS: `t` Kelvin (-> °C), `pmer` Pascal (-> hPa); gust is `raf10`/`ddraf10` (10-min
# max) vs the hourly FXI. Conversions are applied in _canon6, not here.
WIND_6M_MAP = {
    "ff": "wind_speed_ms",
    "dd": "wind_direction_deg",
    "raf10": "wind_gust_ms",
    "ddraf10": "wind_gust_direction_deg",
    "t": "air_temperature_c",
    "rr_per": "precipitation_mm",
    "u": "humidity_pct",
    "pmer": "pressure_msl_hpa",
}


class WindError(RuntimeError):
    """A wind fetch/parse failure that should be logged but not abort the whole run."""


# --------------------------------------------------------------------------- canonical


def _empty() -> pl.DataFrame:
    return pl.DataFrame(
        schema={DT: pl.Datetime("us"), **{c: pl.Float64 for c in _TIER_COLS}}
    )


def _canonical(df: pl.DataFrame) -> pl.DataFrame:
    """Coerce a frame to exactly [datetime_utc, <8 vars>], stable dtypes, sorted, unique times.

    Missing variables (e.g. humidity/pressure where a station drops them) are filled null so
    every frame shares one schema and concat/unique never mismatch.
    """
    if df.height == 0:
        return _empty()
    df = df.with_columns(pl.col(DT).cast(pl.Datetime("us")))
    for c in _TIER_COLS:
        if c not in df.columns:
            df = df.with_columns(pl.lit(None, dtype=pl.Float64).alias(c))
    return (
        df.select([DT, *_TIER_COLS])
        .drop_nulls(subset=[DT])
        .unique(subset=[DT], keep="last")
        .sort(DT)
    )


def _merge(acc: pl.DataFrame, fresh: pl.DataFrame) -> pl.DataFrame:
    """Coalesce fresh over existing: keep-last on duplicate timestamps (fresh is authoritative)."""
    return (
        pl.concat([_canonical(acc), _canonical(fresh)])
        .unique(subset=[DT], keep="last")
        .sort(DT)
    )


# ------------------------------------------------------------------- historical (bulk)


def _get(url: str, *, label: str, timeout, attempts: int = 3) -> bytes:
    """GET `url` under a watchdog, retrying transient transport faults with backoff.

    Mirrors update._net's resilience for the external (non-HF) sources we fetch: a stalled read
    turns into a *named*, diagnosable abort instead of a silent hang (see ui.watchdog and the
    2026-07-13 LEARNINGS entry). 4xx/5xx from raise_for_status propagate (not retried here).
    """
    last: Exception | None = None
    with ui.watchdog(NET_TIMEOUT_S, label):
        for i in range(attempts):
            try:
                r = httpx.get(url, timeout=timeout, follow_redirects=True)
                r.raise_for_status()
                return r.content
            except httpx.TransportError as e:  # reset/timeout/refused -> transient
                last = e
                if i == attempts - 1:
                    break
                delay = 2.0**i
                ui.warn(f"{label}: {type(e).__name__}: {e} — retrying in {delay:.0f}s")
                time.sleep(delay)
    raise WindError(f"{label} failed after {attempts} attempts: {last!r}")


def resource_urls(dept: str) -> list[str]:
    """Department bulk-file URLs from the data.gouv dataset, every period ending >= START_YEAR.

    Resolved from the API (not hard-coded S3 paths) so it survives the `latest-`/`previous-`/decade
    filename churn as years roll. Oldest first. The whole history is fetched once, at seed time.
    """
    payload = _get(DATAGOUV_API, label=f"data.gouv {DATASET} ({dept})", timeout=30.0)
    resources = json.loads(payload).get("resources", [])
    pat = re.compile(rf"HOR_departement_{dept}_periode_(\d{{4}})-(\d{{4}})")
    found: list[tuple[int, str]] = []
    for res in resources:
        m = pat.match(res.get("title", ""))
        if m and int(m.group(2)) >= START_YEAR:
            found.append((int(m.group(1)), res.get("url", "")))
    found.sort()
    return [u for _, u in found]


def _station_frame(gz_bytes: bytes, num_posts: set[str]) -> pl.DataFrame:
    """Decompress one department gzip CSV and return canonical HOURLY rows for a NUM_POSTE set.

    Streams the decompression to a temp file so a ~500 MB CSV never sits in RAM, then scan_csv
    with filter-pushdown materialises only the wanted stations' rows (Utf8 then cast, like
    build._read_raw_csv). Keeps NUM_POSTE so the caller can split a multi-station department.
    """
    keep = ["NUM_POSTE", "AAAAMMJJHH", *WIND_HOURLY_MAP]
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tf:
        with gzip.GzipFile(fileobj=io.BytesIO(gz_bytes)) as gzf:
            shutil.copyfileobj(gzf, tf)
        tmp = tf.name
    try:
        df = (
            pl.scan_csv(tmp, separator=";", infer_schema_length=0)
            .filter(pl.col("NUM_POSTE").is_in(list(num_posts)))
            .select(keep)
            .collect()
        )
    finally:
        os.unlink(tmp)
    if df.height == 0:
        return df
    # AAAAMMJJHH is YYYYMMDDHH (no minutes); polars strptime wants hour+minute together, so pad
    # "00" and parse %Y%m%d%H%M. Times are UTC for métropole (Olatu's storage convention).
    return df.rename({**WIND_HOURLY_MAP, "AAAAMMJJHH": DT}).with_columns(
        (pl.col(DT) + pl.lit("00")).str.strptime(
            pl.Datetime("us"), "%Y%m%d%H%M", strict=False
        ),
        *[pl.col(c).cast(pl.Float64, strict=False) for c in _TIER_COLS],
    )


def fetch_hist(station_ids: list[str]) -> dict[str, pl.DataFrame]:
    """Download + parse the full hourly history per station, sharing per-department downloads.

    Socoa and Biarritz share dept 64, so each department file is fetched once and split across
    the stations it contains. Returns {station_id: canonical hourly frame}.
    """
    by_dept: dict[str, list[str]] = {}
    for sid in station_ids:
        by_dept.setdefault(WIND_STATIONS[sid]["dept"], []).append(sid)

    hist: dict[str, pl.DataFrame] = {sid: _empty() for sid in station_ids}
    for dept, sids in sorted(by_dept.items()):
        num_to_sid = {WIND_STATIONS[s]["num_poste"]: s for s in sids}
        urls = resource_urls(dept)
        ui.detail(
            f"dept {dept}: {len(urls)} bulk file(s) for {', '.join(sids)}",
            style=ui.WIND,
        )
        for url in urls:
            name = url.rsplit("/", 1)[-1]
            gz = _get(
                url, label=f"download {name}", timeout=httpx.Timeout(30.0, read=300.0)
            )
            df = _station_frame(gz, set(num_to_sid))
            for num, sid in num_to_sid.items():
                sub = df.filter(pl.col("NUM_POSTE") == num).drop("NUM_POSTE")
                if sub.height:
                    hist[sid] = pl.concat([hist[sid], _canonical(sub)])
            ui.detail(f"  {name}: {df.height} station-row(s)", style=ui.WIND)
    return hist


# ----------------------------------------------------------------------- live (6-min)


def _floor6(dt: datetime) -> datetime:
    """Floor a datetime to the DPObs 6-minute grid."""
    return dt.replace(
        second=0, microsecond=0, minute=(dt.minute // LIVE_STEP_MIN) * LIVE_STEP_MIN
    )


def _num(x: str | None) -> float | None:
    try:
        return float(x)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _canon6(row: dict) -> dict:
    """Map one DPObs 6-min CSV row to the canonical schema, converting units (K->°C, Pa->hPa)."""
    t = _num(row.get("t"))
    pmer = _num(row.get("pmer"))
    vt = (row.get("validity_time") or "").replace("Z", "")
    return {
        DT: datetime.fromisoformat(vt) if vt else None,
        "wind_speed_ms": _num(row.get("ff")),
        "wind_direction_deg": _num(row.get("dd")),
        "wind_gust_ms": _num(row.get("raf10")),
        "wind_gust_direction_deg": _num(row.get("ddraf10")),
        "air_temperature_c": None if t is None else round(t - 273.15, 2),
        "precipitation_mm": _num(row.get("rr_per")),
        "humidity_pct": _num(row.get("u")),
        "pressure_msl_hpa": None if pmer is None else round(pmer / 100.0, 2),
    }


def _dpobs_row(
    key: str, num_poste: str, date_iso: str, *, attempts: int = 4
) -> dict | None:
    """Fetch one 6-min observation (or None if that timestamp isn't published yet).

    Retries 429/5xx with backoff (honouring Retry-After) instead of swallowing them: the API caps
    at 100 req/min, so a burst trips 429, and silently treating that as "no data" would drop real
    observations. 401/403 is a bad key -> raise. A 200 with an empty body -> None.
    """
    for i in range(attempts):
        r = httpx.get(
            f"{DPOBS_BASE}/station/infrahoraire-6m",
            params={"id_station": num_poste, "date": date_iso, "format": "csv"},
            headers={"apikey": key},
            timeout=30,
            follow_redirects=True,
        )
        if r.status_code in (401, 403):
            raise WindError(f"DPObs {r.status_code} — bad/expired {ENV_KEY}")
        if r.status_code == 200:
            rows = list(csv.DictReader(io.StringIO(r.text), delimiter=";"))
            return rows[0] if rows else None
        if r.status_code in DPOBS_RETRY_STATUS and i < attempts - 1:
            ra = r.headers.get("retry-after", "")
            time.sleep(float(ra) if ra.isdigit() else 2.0**i)
            continue
        return None  # other non-200 (e.g. 204) or retries exhausted
    return None


def fetch_live(key: str, num_poste: str, minutes: int, *, label: str) -> pl.DataFrame:
    """Poll the recent 6-min grid (now back `minutes`) and return canonical rows.

    One HTTP call per grid point (the API serves a single observation per date). The whole batch
    runs under one watchdog; the most-recent points are often empty (H-latency) and just skipped.
    """
    now = _floor6(datetime.now(timezone.utc)).replace(tzinfo=None)
    rows: list[dict] = []
    with ui.watchdog(NET_TIMEOUT_S, label):
        for k in range(minutes // LIVE_STEP_MIN + 1):
            d = now - timedelta(minutes=LIVE_STEP_MIN * k)
            row = _dpobs_row(key, num_poste, d.strftime("%Y-%m-%dT%H:%M:%SZ"))
            if row:
                c = _canon6(row)
                if c[DT] is not None:
                    rows.append(c)
            time.sleep(DPOBS_PACE_S)
    if not rows:
        return _empty()
    return pl.DataFrame(
        rows, schema={DT: pl.Datetime("us"), **{c: pl.Float64 for c in _TIER_COLS}}
    )


# ---------------------------------------------------------------------- raw storage
#
# raw/<station>_hist.csv          one-shot hourly history (immutable, like a buoy *_arch.csv)
# raw/<station>_<YEAR>_live.csv   forward-growing 6-min, split per year (like a *_reel.csv)


def _raw_dir(wind_root: Path, sid: str) -> Path:
    return wind_root / sid / "raw"


def _hist_path(wind_root: Path, sid: str) -> Path:
    return _raw_dir(wind_root, sid) / f"{sid}_hist.csv"


def _live_path(wind_root: Path, sid: str, year: int) -> Path:
    return _raw_dir(wind_root, sid) / f"{sid}_{year}_live.csv"


def _write_csv(path: Path, df: pl.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _canonical(df).with_columns(pl.col(DT).dt.strftime("%Y-%m-%dT%H:%M:%S")).write_csv(
        path
    )


def _read_csv(path: Path) -> pl.DataFrame:
    if not path.exists():
        return _empty()
    raw = pl.read_csv(path, infer_schema_length=0)
    return _canonical(
        raw.with_columns(
            pl.col(DT).str.strptime(
                pl.Datetime("us"), "%Y-%m-%dT%H:%M:%S", strict=False
            ),
            *[
                pl.col(c).cast(pl.Float64, strict=False)
                for c in _TIER_COLS
                if c in raw.columns
            ],
        )
    )


def read_hist(wind_root: Path, sid: str) -> pl.DataFrame:
    return _read_csv(_hist_path(wind_root, sid))


def read_live(wind_root: Path, sid: str) -> pl.DataFrame:
    frames = [
        _read_csv(p) for p in sorted(_raw_dir(wind_root, sid).glob(f"{sid}_*_live.csv"))
    ]
    frames = [f for f in frames if f.height]
    return _canonical(pl.concat(frames)) if frames else _empty()


def append_live(wind_root: Path, sid: str, fresh: pl.DataFrame) -> int:
    """Coalesce fresh 6-min rows into the per-year live accumulators. Returns rows written."""
    fresh = _canonical(fresh)
    if fresh.height == 0:
        return 0
    for y in sorted({d.year for d in fresh[DT].to_list() if d is not None}):
        p = _live_path(wind_root, sid, y)
        merged = _merge(_read_csv(p), fresh.filter(pl.col(DT).dt.year() == y))
        _write_csv(p, merged)
    return fresh.height


def scrape_live(wind_root: Path, sid: str, key: str, *, minutes: int) -> int:
    """Fetch the recent 6-min window for a station and append it to the live accumulator."""
    fresh = fetch_live(
        key, WIND_STATIONS[sid]["num_poste"], minutes, label=f"dpobs {sid}"
    )
    return append_live(wind_root, sid, fresh)


# ------------------------------------------------------------------------- tiers


def _downsample(df: pl.DataFrame, every: str) -> pl.DataFrame:
    """Down-sample all 8 vars: arithmetic mean, but CIRCULAR mean for the direction columns."""
    exprs = []
    for c in _TIER_COLS:
        if c in WIND_DIRECTION_VARS:
            ang = pl.col(c).radians()
            mean_ang = pl.arctan2(ang.sin().mean(), ang.cos().mean()).degrees()
            exprs.append(((mean_ang + 360) % 360).alias(c))
        else:
            exprs.append(pl.col(c).mean().alias(c))
    return df.sort(DT).group_by_dynamic(DT, every=every).agg(exprs)


def _assemble(hist: pl.DataFrame, live: pl.DataFrame) -> pl.DataFrame:
    """Coalesce hist + live into one series, hist-preferred on overlap, never interpolating."""
    parts = [f for f in (_canonical(hist), _canonical(live)) if f.height]
    if not parts:
        return _empty()
    # hist first + keep-first -> at a shared :00 timestamp the QC'd hourly value wins; live only
    # extends the series forward (real gaps between feeds are left as gaps, like the buoys).
    return pl.concat(parts).unique(subset=[DT], keep="first").sort(DT)


def build_station(wind_root: Path, sid: str) -> int:
    """Coalesce hist+live and (re)emit the buoy-style tiers for a station. Returns row count."""
    merged = _assemble(read_hist(wind_root, sid), read_live(wind_root, sid))
    out = wind_root / sid / "data"
    # Rewrite data/ from scratch so a restructure never leaves orphaned tiers behind locally.
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    if merged.height == 0:
        ui.warn(f"{sid}: no wind data → skip tiers")
        return 0

    years = sorted({d.year for d in merged[DT].to_list() if d is not None})
    year_files = []
    for y in years:
        g = merged.filter(pl.col(DT).dt.year() == y)
        rel = f"year/{sid}_{y}.parquet"
        size = build_mod.write_parquet(out / rel, g, ROW_GROUP_SIZE)
        year_files.append(
            {"year": y, "file": rel, "rows": g.height, "byteLength": size}
        )

    hourly = _downsample(merged, "1h")
    daily = _downsample(merged, "1d")
    hourly_files = []
    for y in years:
        g = hourly.filter(pl.col(DT).dt.year() == y)
        rel = f"hourly/{sid}_{y}.parquet"
        size = build_mod.write_parquet(out / rel, g, ROW_GROUP_SIZE)
        hourly_files.append(
            {"year": y, "file": rel, "rows": g.height, "byteLength": size}
        )
    build_mod.write_parquet(out / "daily.parquet", daily)

    last_dt = merged[DT].max()
    latest = merged.filter(pl.col(DT) >= last_dt - timedelta(hours=48))
    recent = merged.filter(pl.col(DT) >= last_dt - timedelta(days=30))
    build_mod.write_json(
        out / "latest.json", build_mod._to_columnar(latest, _TIER_COLS)
    )
    build_mod.write_json(
        out / "recent.json", build_mod._to_columnar(recent, _TIER_COLS)
    )

    station = {"id": sid, **WIND_STATIONS[sid]}
    manifest = {
        "station": station,
        "source": WIND_SOURCE,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "timezone": "Europe/Paris",
        "cadence": "hourly (history) + 6-min (live)",
        "span": {
            "start": merged[DT].min().replace(tzinfo=timezone.utc).isoformat(),
            "end": merged[DT].max().replace(tzinfo=timezone.utc).isoformat(),
        },
        "rows": merged.height,
        "variables": [
            {"name": n, "unit": WIND_UNITS[n], "headline": n in WIND_HEADLINE}
            for n in WIND_UNITS
        ],
        "years": year_files,
        "hourly_files": hourly_files,
        "coverage": {n: build_mod.coverage(merged, n) for n in _TIER_COLS},
        "tiers": {
            "latest": "latest.json",
            "recent": "recent.json",
            "daily": "daily.parquet",
        },
    }
    build_mod.write_json(out / "manifest.json", manifest)
    ui.detail(
        f"{sid}: {merged.height} rows, {len(years)} year(s) "
        f"{years[0]}→{years[-1]} → tiers in {out}",
        style=ui.WIND,
    )
    return merged.height


# ------------------------------------------------------------------------------ HF sync
#
# update.py is imported lazily so wind.py has no module-level dependency on it (update.py imports
# wind.py — avoid an import cycle).


def pull_wind(wind_root: Path, sid: str, repo: str, token: str | None) -> None:
    """Mirror a station's raw inputs locally: live accumulators always, hist only if absent.

    The hist file is immutable (seeded once) → pull it only when missing (CI caches it), like a
    buoy archive. First run for a station has no remote prefix yet → tolerate the miss.
    """
    from huggingface_hub import sync_bucket

    from . import update as update_mod

    dst = _raw_dir(wind_root, sid)
    dst.mkdir(parents=True, exist_ok=True)
    src = f"hf://buckets/{repo}/wind/{sid}/raw"

    def _do() -> None:
        try:
            sync_bucket(
                src, str(dst), include=[f"{sid}_*_live.csv"], token=token, quiet=True
            )
        except Exception as e:  # noqa: BLE001 — missing prefix / transient: non-fatal
            ui.detail(f"no remote live for {sid} yet ({e})", style=ui.WIND)
        if not _hist_path(wind_root, sid).exists():
            try:
                sync_bucket(
                    src, str(dst), include=[f"{sid}_hist.csv"], token=token, quiet=True
                )
            except Exception as e:  # noqa: BLE001
                ui.detail(f"no remote hist for {sid} yet ({e})", style=ui.WIND)

    update_mod._net(f"pull wind {sid}", _do)


def upload_wind(
    wind_root: Path, sid: str, repo: str, token: str | None, *, seed: bool = False
) -> None:
    """Push a station's tiers + live accumulators (+ hist on seed) to wind/<station>/.

    Routine runs never re-send the immutable hist (unchanged); the year parquets sync only when
    their bytes change, so past years are skipped and only the current year + live move.
    """
    from huggingface_hub import sync_bucket

    from . import update as update_mod

    include = ["data/**", f"raw/{sid}_*_live.csv"]
    if seed:
        include.append(f"raw/{sid}_hist.csv")
    update_mod._net(
        f"upload wind {sid}",
        sync_bucket,
        str(wind_root / sid),
        f"hf://buckets/{repo}/wind/{sid}",
        include=include,
        token=token,
        quiet=True,
    )
    ui.detail(
        f"uploaded wind/{sid}/{{data, raw live{'+hist' if seed else ''}}} → {repo}",
        style=ui.WIND,
    )


# ----------------------------------------------------------------------------------- run


def run(
    station_ids: list[str], wind_root: Path, *, seed: bool, repo: str, do_upload: bool
) -> None:
    """Refresh a set of stations end to end: (seed hist) → (pull) → scrape 6-min → build → upload."""
    key = os.environ.get(ENV_KEY)
    token = None
    if do_upload:
        from . import update as update_mod

        token = update_mod._net("auth", update_mod.resolve_token, repo)

    if seed:
        hist = fetch_hist(station_ids)
        for sid in station_ids:
            _write_csv(_hist_path(wind_root, sid), hist[sid])

    rows: list[list[str]] = []
    for sid in station_ids:
        if do_upload and not seed:
            pull_wind(wind_root, sid, repo, token)
        n_live = 0
        if key:
            minutes = LIVE_SEED_HOURS * 60 if seed else LIVE_LOOKBACK_MIN
            try:
                n_live = scrape_live(wind_root, sid, key, minutes=minutes)
            except WindError as e:
                ui.warn(f"{sid} live failed ({e}) → keep existing")
        elif not seed:
            ui.warn(f"no {ENV_KEY} → skip 6-min live for {sid}")
        n = build_station(wind_root, sid)
        if do_upload and n:
            upload_wind(wind_root, sid, repo, token, seed=seed)
        rows.append(
            [
                sid,
                WIND_STATIONS[sid]["label"],
                f"{n:,}",
                str(n_live),
                "✓" if (do_upload and n) else "—",
            ]
        )

    ui.summary_table(
        "Wind",
        ["station", "label", "rows", "fresh 6-min", "uploaded"],
        rows,
        style=ui.WIND,
    )


def _resolve_ids(args) -> list[str]:
    if args.all:
        return list(WIND_STATIONS)
    if args.station:
        if args.station not in WIND_STATIONS:
            raise SystemExit(
                f"unknown station {args.station!r} (one of {list(WIND_STATIONS)})"
            )
        return [args.station]
    station = resolve_wind_station(args.campaign or CAMPAIGN_ID)
    if station is None:
        ui.warn(
            f"{args.campaign or CAMPAIGN_ID} has no station within range → nothing to do"
        )
        return []
    return [station["id"]]


def main() -> None:
    p = argparse.ArgumentParser(
        description="Météo-France wind per station → one buoy-style tiered dataset."
    )
    g = p.add_mutually_exclusive_group()
    g.add_argument(
        "--campaign",
        default=None,
        help="resolve this buoy's nearest station and refresh it (default: 06403)",
    )
    g.add_argument(
        "--station",
        default=None,
        help=f"refresh a station id directly ({list(WIND_STATIONS)})",
    )
    p.add_argument(
        "--all", action="store_true", help="refresh every curated station in one run"
    )
    p.add_argument(
        "--seed",
        action="store_true",
        help="one-shot: fetch the full hourly history (2010→) + a 6-min backfill, then build",
    )
    p.add_argument(
        "--wind-root",
        type=Path,
        default=Path("hfdata") / "wind",
        help="wind root dir (default: hfdata/wind)",
    )
    p.add_argument("--repo", default=DEFAULT_REPO, help="HF bucket id")
    p.add_argument(
        "--no-upload", action="store_true", help="build locally without uploading to HF"
    )
    args = p.parse_args()

    station_ids = _resolve_ids(args)
    if not station_ids:
        return
    ui.section(
        ui.ICON_WIND,
        "wind",
        f"{'seed' if args.seed else 'refresh'} · {', '.join(station_ids)}",
        style=ui.WIND,
    )
    run(
        station_ids,
        args.wind_root,
        seed=args.seed,
        repo=args.repo,
        do_upload=not args.no_upload,
    )
    ui.ok("wind done")


if __name__ == "__main__":
    main()

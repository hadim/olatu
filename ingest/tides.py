"""Fetch tide predictions (high/low extrema + coefficient) from api-maree.fr, per PORT.

See specs/2026-07-05-0008-tides.md (+ §8.2 / §11 revisions). api-maree.fr publishes
IFREMER / PREVIMER harmonic predictions (CC-BY); its `/tide-extrema` endpoint returns the
PM/BM of a date range directly, each **pleine mer** carrying the French *coefficient de
maree* -- so we no longer densely sample `/water-levels` and detect peaks ourselves (spec
§11). The key is **ingest-only** and never reaches the webapp, which only ever reads the
derived `tides.parquet`.

Tides are keyed by **port**, not buoy (a tide is a property of a place, and buoys can share
a port). Each buoy resolves to its nearest curated port (schema.resolve_tide_port). Per
port, each run (gated -- see the horizon gate below):

  1. fetch `/tide-extrema` for the port over J-30..J+30 -- **one** request, tz=UTC
     (Olatu stores UTC),
  2. replace-window coalesce into the forward-growing accumulator
     `tides/<port>/raw/extrema.csv` (keep old events outside the fetched window, replace inside),
  3. emit `tides/<port>/data/tides.parquet` (the tier the webapp reads from the HF bucket).

Port meta (label, range_ref, source) is NOT in the tier -- it rides each buoy's manifest
tide block (build.py). A missing key / bad site / fetch failure is non-fatal: the step logs
and falls back to the existing accumulator so the rest of the refresh still runs.
"""

from __future__ import annotations

import argparse
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import polars as pl

from . import ui
from .schema import CAMPAIGN_ID, TIDE_PORTS, resolve_tide_port

API_BASE = "https://api-maree.fr/tide-extrema"
ENV_KEY = "API_MAREE_KEY"

WINDOW_PAST_DAYS = 30  # J-30 (api-maree.fr free-tier floor)
WINDOW_FWD_DAYS = 30  # J+30 (api-maree.fr free-tier ceiling)

# Only fetch when the accumulator's forward horizon drops below this (stateless, quota-
# polite): a fetch restores +30 days, so it re-fires ~ every 10 days per port. The
# accumulator always still brackets "now", so the banner never goes empty between fetches.
HORIZON_GATE_DAYS = 20

# `c` = the French coefficient de maree, carried by PM rows only (null on BM, and null
# everywhere for a port SHOM doesn't index -- it is a Brest-referenced NATIONAL number, not
# a per-port one). Nullable Int64 so the CSV accumulator round-trips old rows written
# before spec §11 as nulls.
_ACC_SCHEMA = {"t": pl.Int64, "h": pl.Float64, "k": pl.Utf8, "c": pl.Int64}


class TideError(RuntimeError):
    """A tide fetch/parse failure that should be logged but not abort the whole refresh."""


# ------------------------------------------------------------------------- time helpers


def _parse_iso_utc(s: str) -> float:
    """Parse an ISO-8601 instant to an epoch (s). Naive values are treated as UTC."""
    d = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


def _day_midnight_utc(epoch_s: float) -> datetime:
    d = datetime.fromtimestamp(epoch_s, tz=timezone.utc)
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


# --------------------------------------------------------------------------------- fetch


def fetch_extrema(key: str, site: str, start: datetime, end: datetime) -> list[dict]:
    """High/low extrema for `site` over the days [start, end], as {t, h, k, c} dicts.

    One request covers the whole J-30..J+30 window (~240 extrema, ~15 kB). The payload is
    grouped by day -- `{"date": "YYYY-MM-DD", "extrema": [{"type": "PM"|"BM", "time":
    "HH:MM", "height": m, "coef": int?}]}` -- and `tz=UTC` makes date+time an unambiguous
    UTC instant. `coef` rides the PM entries only.
    """
    r = httpx.get(
        API_BASE,
        params={
            "site": site,
            "from": start.strftime("%Y-%m-%d"),
            "to": end.strftime("%Y-%m-%d"),
            "tz": "UTC",
            "key": key,
        },
        headers={"accept": "application/json"},
        timeout=30,
    )
    if r.status_code != 200:
        raise TideError(f"api-maree.fr {r.status_code} for {site}: {r.text[:160]}")
    days = r.json().get("data")
    if not isinstance(days, list):
        raise TideError(f"api-maree.fr: unexpected payload for {site}")

    out: list[dict] = []
    for day in days:
        for e in day.get("extrema", []):
            kind = {"PM": "high", "BM": "low"}.get(e.get("type"))
            if kind is None:
                raise TideError(
                    f"api-maree.fr: unknown extremum type {e.get('type')!r}"
                )
            coef = e.get("coef")
            out.append(
                {
                    "t": _parse_iso_utc(f"{day['date']}T{e['time']}"),
                    "h": round(float(e["height"]), 2),
                    "k": kind,
                    "c": int(coef) if coef is not None else None,
                }
            )
    out.sort(key=lambda e: e["t"])
    return out


# ----------------------------------------------------------------------------- accumulator
#
# Tides live at a shared, port-keyed root (specs/0008 §8.2):
#   tides/<port>/raw/extrema.csv     forward-growing high/low accumulator
#   tides/<port>/data/tides.parquet  published tier (t, h, k, c -- events only)


def _acc_path(tides_root: Path, port_id: str) -> Path:
    return tides_root / port_id / "raw" / "extrema.csv"


def _tier_path(tides_root: Path, port_id: str) -> Path:
    return tides_root / port_id / "data" / "tides.parquet"


def _load_acc(path: Path) -> pl.DataFrame:
    """Read the accumulator, adding `c` as nulls for files written before spec §11."""
    if not path.exists():
        return pl.DataFrame(schema=_ACC_SCHEMA)
    df = pl.read_csv(path, schema_overrides=_ACC_SCHEMA)
    if "c" not in df.columns:
        df = df.with_columns(pl.lit(None, dtype=pl.Int64).alias("c"))
    return df.select(*_ACC_SCHEMA)


def _write_tier(path: Path, acc: pl.DataFrame) -> int:
    """Write the published Parquet tier (events only: t, h, k, c). Returns the row count.

    Extrema are tiny (~1460/yr/port) -> a single row group is fine (unlike the wave tiers,
    this one isn't range-read). Snappy keeps it consistent with the columnar tiers; the
    webapp reads it via hyparquet like daily.parquet.
    """
    df = acc.sort("t").with_columns(
        pl.col("t").cast(pl.Int64),
        pl.col("h").round(2),
        pl.col("k").cast(pl.Utf8),
        pl.col("c").cast(pl.Int64),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(path, compression="snappy")
    return df.height


# ----------------------------------------------------------------------------------- run


def refresh_port(
    tides_root: Path, port_id: str, key: str | None, *, force: bool = False
) -> str:
    """Fetch (gated), coalesce the accumulator, and (re)emit the Parquet tier for a port.

    Returns a short status word for the run summary: `refreshed` / `republished` /
    `up to date` / `no key` / `unknown port` / `fetch failed`.
    """
    if port_id not in TIDE_PORTS:
        ui.detail(f"unknown port {port_id!r} → skip")
        return "unknown port"
    if not key:
        ui.detail(f"no {ENV_KEY} → skip (webapp shows the tide empty-state)")
        return "no key"

    acc = _load_acc(_acc_path(tides_root, port_id))
    tier = _tier_path(tides_root, port_id)
    now = time.time()
    horizon = acc["t"].max() if acc.height else None

    # Horizon gate: enough forecast in hand -> don't hammer the API. Still publish once if
    # the tier is somehow missing (e.g. first build off a pulled accumulator).
    if (
        not force
        and horizon is not None
        and horizon - now >= HORIZON_GATE_DAYS * 86_400
    ):
        if tier.exists():
            ui.detail(f"{port_id} +{(horizon - now) / 86_400:.0f} d ahead → skip fetch")
            return "up to date"
        ui.detail(f"{port_id} republishing {_write_tier(tier, acc)} events")
        return "republished"

    start = _day_midnight_utc(now) - timedelta(days=WINDOW_PAST_DAYS)
    end = _day_midnight_utc(now) + timedelta(days=WINDOW_FWD_DAYS)
    try:
        new_events = fetch_extrema(key, port_id, start, end)
        if not new_events:
            raise TideError("no extrema returned")
    except (httpx.HTTPError, TideError, KeyError, ValueError) as e:
        ui.warn(f"{port_id} fetch failed ({e}) → keep existing")
        if acc.height and not tier.exists():
            _write_tier(tier, acc)
        return "fetch failed"

    # Replace-window merge: keep old events outside the fetched window, replace inside with
    # fresh. `to` is an inclusive DATE, so the window runs to the END of the last day.
    win_start = int(start.timestamp())
    win_end = int((end + timedelta(days=1)).timestamp())
    new_df = pl.DataFrame(
        {
            "t": [round(e["t"]) for e in new_events],
            "h": [e["h"] for e in new_events],
            "k": [e["k"] for e in new_events],
            "c": [e["c"] for e in new_events],
        },
        schema=_ACC_SCHEMA,
    )
    kept = acc.filter((pl.col("t") < win_start) | (pl.col("t") > win_end))
    merged = pl.concat([kept, new_df]).unique(subset=["t"], keep="last").sort("t")

    _acc_path(tides_root, port_id).parent.mkdir(parents=True, exist_ok=True)
    merged.write_csv(_acc_path(tides_root, port_id))
    n = _write_tier(tier, merged)
    coefs = new_df["c"].drop_nulls()
    span = f", coef {coefs.min()}–{coefs.max()}" if coefs.len() else ", no coef"
    ui.detail(
        f"{port_id} {len(new_events)} fresh extrema{span}, {merged.height} total "
        f"→ tides.parquet ({n} events)"
    )
    return "refreshed"


def refresh_for_campaign(
    tides_root: Path, campaign: str, key: str | None, *, force: bool = False
) -> str | None:
    """Resolve a buoy's nearest port and refresh it. Returns the port id (None if too far)."""
    port = resolve_tide_port(campaign)
    if port is None:
        ui.detail(f"{campaign} has no port within range → skip")
        return None
    refresh_port(tides_root, port["id"], key, force=force)
    return port["id"]


def main() -> None:
    p = argparse.ArgumentParser(
        description="Fetch + derive tide extrema from api-maree.fr (per port)."
    )
    g = p.add_mutually_exclusive_group()
    g.add_argument(
        "--campaign",
        default=None,
        help="resolve this buoy's nearest port and refresh it (default: 06403)",
    )
    g.add_argument(
        "--port",
        default=None,
        help=f"refresh a port id directly (one of {list(TIDE_PORTS)})",
    )
    p.add_argument(
        "--tides-root",
        type=Path,
        default=Path("hfdata") / "tides",
        help="tides root dir (default: hfdata/tides)",
    )
    p.add_argument(
        "--force", action="store_true", help="fetch even if the horizon gate would skip"
    )
    args = p.parse_args()
    key = os.environ.get(ENV_KEY)
    ui.section(
        ui.ICON_TIDE,
        "tide",
        args.port or f"campaign {args.campaign or CAMPAIGN_ID}",
        style=ui.TIDE,
    )
    if args.port:
        refresh_port(args.tides_root, args.port, key, force=args.force)
    else:
        refresh_for_campaign(
            args.tides_root, args.campaign or CAMPAIGN_ID, key, force=args.force
        )


if __name__ == "__main__":
    main()

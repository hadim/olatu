"""Scrape the CANDHIS realtime table for buoy 06403 and grow the local realtime CSVs.

CANDHIS publishes the last ~48 h of realtime measurements -- including sea
temperature, which never appears in the archive export -- as a *server-rendered HTML
table* on `campagne.php`. There is no API and no download to fight: a single GET of

    https://candhis.cerema.fr/_public_/campagne.php?<base64("camp=06403")>

returns the full table in the HTML (no session priming, no "Valider"/"Telecharger"
form POST -- those buttons drive the Archives date-range CSV export, not realtime).
See specs/2026-06-27-0004-realtime-scraper.md.

We parse that table and MERGE its rows into a per-year realtime CSV under --src, in
the exact CANDHIS dialect `build.py` already reads (`Candhis_06403_<YEAR>_reel.csv`,
mirroring the archive's per-year files). Because each scrape overlaps the previous
48 h window, running this regularly (<= ~36 h apart) makes the union one continuous,
forward-growing series -- so **sea-temperature history accumulates from the first run**.

Design guarantees (the scraper is the loud gate; build.py trusts its input blindly):
  * Coalesce, never clobber: a newly-null cell never erases a previously-good value.
  * Validate before writing: a bad/partial/HTTP-200-error scrape aborts and keeps the
    last-good file (nonzero exit), instead of silently degrading history.
  * Never-shrink invariant: the merged file must cover the existing span and have
    >= as many rows, else abort.
  * Atomic write (tmp on the same filesystem + os.replace) under an exclusive lock.

Run via `pixi run scrape` (or `pixi run update` = scrape then ingest). See pixi.toml.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import fcntl
import glob
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import polars as pl
from lxml import html as lhtml

from .schema import CAMPAIGN_ID, REEL_MAP, SENTINEL_MIN

BASE_URL = "https://candhis.cerema.fr/_public_/campagne.php"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

DT = "datetime_utc"  # internal helper column for parsing/sorting
DATE_COL = "Date"  # CANDHIS realtime CSV timestamp column
VALUE_COLS = list(REEL_MAP)  # ["H1/3","Hmax","Th1/3","DirPic","EtalPic","TempMer"]
CSV_HEADER = [DATE_COL] + VALUE_COLS

# --- validation thresholds (a bad scrape must abort, never overwrite a good file) ---
MIN_ROWS = 40  # expect ~97 (48 h @ 30 min); far fewer => suspect, refuse to write
MAX_BAD_FRACTION = 0.20  # > this share of rows out of plausible range => format break
# plausible physical ranges; the 999.999 sentinel is allowed (build.py nulls it).
PLAUSIBLE = {
    "H1/3": (0.0, 25.0),
    "Hmax": (0.0, 25.0),
    "Th1/3": (0.0, 30.0),
    "DirPic": (0.0, 360.0),
    "EtalPic": (0.0, 180.0),
    "TempMer": (-2.0, 40.0),
}
FUTURE_TOLERANCE = timedelta(
    hours=3
)  # newest row this far past "now" => clock/tz fault


class ScrapeError(RuntimeError):
    """A scrape that must abort *without* writing (keep the last-good file)."""


# --------------------------------------------------------------------------- fetch


def realtime_url(campaign_id: str = CAMPAIGN_ID) -> str:
    """CANDHIS selects a campaign via a base64-encoded `camp=<id>` query string."""
    token = base64.b64encode(f"camp={campaign_id}".encode()).decode()
    return f"{BASE_URL}?{token}"


def fetch_html(url: str, *, retries: int = 3, timeout: float = 30.0) -> str:
    """GET the campaign page with retries/backoff. Raise on persistent failure."""
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "fr,en;q=0.8"}
    last_err: Exception | None = None
    with httpx.Client(headers=headers, follow_redirects=True, timeout=timeout) as c:
        for attempt in range(1, retries + 1):
            try:
                r = c.get(url)
                r.raise_for_status()
                return r.text
            except httpx.HTTPError as e:  # transient network / 5xx
                last_err = e
                if attempt < retries:
                    backoff = 2.0 * attempt
                    print(
                        f"  fetch attempt {attempt} failed ({e}); retry in {backoff}s"
                    )
                    time.sleep(backoff)
    raise ScrapeError(f"failed to fetch {url} after {retries} attempts: {last_err}")


# --------------------------------------------------------------------------- parse


def _classify_header(text: str) -> str | None:
    """Map a table header cell to a target column by *name* (order-independent)."""
    h = text.strip().upper()
    if "TH1/3" in h:
        return "Th1/3"
    if "HMAX" in h:
        return "Hmax"
    if "H1/3" in h:
        return "H1/3"
    if "DIR" in h:
        return "DirPic"
    if "ETAL" in h:
        return "EtalPic"
    if "TEMP" in h:
        return "TempMer"
    if "HEURE" in h:
        return "_heure"
    if h == "DATE":
        return "_date"
    return None


def _num(cell: str) -> float | None:
    """Parse a numeric cell; empty/'-' -> None. Garbage raises (caught upstream)."""
    s = (cell or "").strip().replace(",", ".")
    if s in ("", "-"):
        return None
    return float(s)


def parse_realtime_table(html_text: str) -> list[dict]:
    """Parse the realtime table into rows keyed by CANDHIS CSV column names.

    Fails loudly on any sign of a format change or an HTTP-200 error page, so a bad
    response can never silently overwrite a good file.
    """
    if "<table" not in html_text.lower() or len(html_text) < 5000:
        raise ScrapeError(
            "response is not a plausible HTML page (too short / no table)"
        )
    low = html_text.lower()
    for sig in ("fatal error", "parse error", "<b>warning</b>", "<b>notice</b>"):
        if sig in low:
            raise ScrapeError(f"response contains a PHP error signature: {sig!r}")
    if "veuillez sélectionner une campagne" in low:
        raise ScrapeError("campaign not selected (got the 'choose a campaign' page)")

    doc = lhtml.fromstring(html_text)
    tables = [
        t for t in doc.xpath("//table") if "TEMP" in " ".join(t.itertext()).upper()
    ]
    if len(tables) != 1:
        raise ScrapeError(f"expected exactly 1 realtime table, found {len(tables)}")
    table = tables[0]

    rows = table.xpath(".//tr")
    if not rows:
        raise ScrapeError("realtime table has no rows")

    # --- header: resolve every expected column by name, assert UTC time column ---
    header_cells = [c.text_content() for c in rows[0].xpath("./th|./td")]
    if len(header_cells) != 8:
        raise ScrapeError(
            f"expected 8 header columns, found {len(header_cells)}: {header_cells}"
        )
    idx: dict[str, int] = {}
    for i, cell in enumerate(header_cells):
        key = _classify_header(cell)
        if key is not None:
            idx[key] = i
    missing = {"_date", "_heure", *VALUE_COLS} - set(idx)
    if missing:
        raise ScrapeError(
            f"could not resolve header columns {missing} from {header_cells}"
        )
    if "TU" not in header_cells[idx["_heure"]].upper():
        raise ScrapeError(
            f"time column is no longer UTC ('Heure (TU)'): {header_cells[idx['_heure']]!r}"
        )

    # --- data rows ---
    out: list[dict] = []
    for tr in rows[1:]:
        cells = [c.text_content().strip() for c in tr.xpath("./th|./td")]
        if not any(cells):
            continue  # skip blank spacer rows
        if len(cells) != 8:
            raise ScrapeError(f"data row has {len(cells)} cells, expected 8: {cells}")
        d = cells[idx["_date"]]  # DD/MM/YYYY
        hm = cells[idx["_heure"]]  # HH:MM
        parts = d.split("/")
        if len(parts) != 3:
            raise ScrapeError(f"unexpected date format {d!r} (want DD/MM/YYYY)")
        dd, mm, yyyy = parts
        if not (1 <= int(mm) <= 12):  # catches a DD/MM <-> MM/DD locale flip
            raise ScrapeError(f"month out of range in {d!r}; locale flip?")
        rec = {DATE_COL: f"{yyyy}-{mm}-{dd} {hm}:00"}
        for col in VALUE_COLS:
            rec[col] = _num(cells[idx[col]])
        out.append(rec)
    return out


# ------------------------------------------------------------------------ validate


def _is_implausible(col: str, v: float | None) -> bool:
    if v is None or v >= SENTINEL_MIN:  # null or the 999.999 sentinel are fine
        return False
    lo, hi = PLAUSIBLE[col]
    return v < lo or v > hi


def validate_rows(rows: list[dict]) -> pl.DataFrame:
    """Turn parsed rows into a typed frame, asserting the scrape is trustworthy."""
    if len(rows) < MIN_ROWS:
        raise ScrapeError(
            f"only {len(rows)} rows scraped (< {MIN_ROWS}); refusing to write"
        )

    df = pl.DataFrame(
        rows,
        schema={DATE_COL: pl.Utf8, **{c: pl.Float64 for c in VALUE_COLS}},
    ).with_columns(
        pl.col(DATE_COL).str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S").alias(DT)
    )

    if df[DT].null_count():
        raise ScrapeError("some timestamps failed to parse")
    if df[DT].n_unique() != df.height:
        raise ScrapeError("duplicate timestamps in a single scrape")
    minute, second = df[DT].dt.minute(), df[DT].dt.second()
    if not (minute.is_in([0, 30]).all() and (second == 0).all()):
        raise ScrapeError("timestamps are not on the :00/:30 grid")

    newest = df[DT].max()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if newest > now + FUTURE_TOLERANCE:
        raise ScrapeError(
            f"newest row {newest} is in the future (now {now}); clock/tz fault?"
        )

    bad = sum(any(_is_implausible(c, r[c]) for c in VALUE_COLS) for r in rows)
    if bad / len(rows) > MAX_BAD_FRACTION:
        raise ScrapeError(
            f"{bad}/{len(rows)} rows out of plausible range; format break?"
        )

    return df.sort(DT, descending=True)


# --------------------------------------------------------------------------- merge


def _read_reel_csv(path: Path) -> pl.DataFrame:
    """Read an existing CANDHIS realtime CSV into the typed frame (Date + 6 floats)."""
    raw = pl.read_csv(path, separator=";", infer_schema_length=0)
    have = [c for c in CSV_HEADER if c in raw.columns]
    df = raw.select(have)
    df = df.with_columns(
        [
            pl.col(c).cast(pl.Float64, strict=False)
            for c in VALUE_COLS
            if c in df.columns
        ]
    )
    for c in CSV_HEADER:  # tolerate an older file missing a column
        if c not in df.columns:
            dtype = pl.Utf8 if c == DATE_COL else pl.Float64
            df = df.with_columns(pl.lit(None, dtype=dtype).alias(c))
    return df.select(CSV_HEADER).with_columns(
        pl.col(DATE_COL)
        .str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S", strict=False)
        .alias(DT)
    )


def coalesce_merge(
    scraped: pl.DataFrame, existing: pl.DataFrame | None
) -> pl.DataFrame:
    """Union scraped + existing, one row per timestamp; scraped wins *only when non-null*.

    A freshly-null cell therefore never clobbers a previously-good value -- crucial for
    sea temperature, whose only source is this feed.
    """
    if existing is None or existing.height == 0:
        return scraped.sort(DT, descending=True)
    # scraped first so `drop_nulls().first()` prefers it where present, else falls back.
    both = pl.concat([scraped, existing], how="vertical_relaxed")
    merged = both.group_by(DATE_COL, maintain_order=True).agg(
        [pl.col(c).drop_nulls().first().alias(c) for c in VALUE_COLS]
    )
    merged = merged.with_columns(
        pl.col(DATE_COL).str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S").alias(DT)
    )
    return merged.sort(DT, descending=True)


def _assert_never_shrinks(
    merged: pl.DataFrame, existing: pl.DataFrame, label: str
) -> None:
    if merged.height < existing.height:
        raise ScrapeError(
            f"{label}: merged has fewer rows ({merged.height} < {existing.height})"
        )
    if merged[DT].min() > existing[DT].min() or merged[DT].max() < existing[DT].max():
        raise ScrapeError(f"{label}: merged span does not cover the existing span")


def _format_value(v: float | None) -> str:
    return "" if v is None else f"{v:.4f}"


def _serialize(df: pl.DataFrame) -> str:
    """Render to the exact CANDHIS dialect: ';'-separated, 4-decimal floats, LF."""
    lines = [";".join(CSV_HEADER)]
    for row in df.sort(DT, descending=True).iter_rows(named=True):
        cells = [row[DATE_COL]] + [_format_value(row[c]) for c in VALUE_COLS]
        lines.append(";".join(cells))
    return "\n".join(lines) + "\n"


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + f".tmp.{os.getpid()}")  # same dir => same FS
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


@contextlib.contextmanager
def _lock(src: Path, campaign: str = CAMPAIGN_ID):
    """Exclusive, non-blocking lock so two overlapping runs can't race the merge."""
    src.mkdir(parents=True, exist_ok=True)
    lock_path = src / f".scrape_{campaign}.lock"
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as e:
            raise ScrapeError("another scrape is already running (lock held)") from e
        yield
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


# --------------------------------------------------------------------------- driver


def _year_of(dt_col: pl.Series) -> pl.Series:
    return dt_col.dt.year()


def scrape(src: Path, campaign_id: str = CAMPAIGN_ID) -> dict[int, int]:
    """Fetch, validate, and merge the realtime feed into per-year reel CSVs in `src`.

    Returns {year: row_count_written}. Raises ScrapeError on any unsafe condition,
    leaving every existing file untouched.
    """
    url = realtime_url(campaign_id)
    print(f"fetching {url}")
    scraped = validate_rows(parse_realtime_table(fetch_html(url)))
    print(
        f"  scraped {scraped.height} valid rows  span {scraped[DT].min()} -> {scraped[DT].max()}"
    )

    with _lock(src, campaign_id):
        # Plan every year's merge in memory first; only write once all pass validation,
        # so a failure mid-way never leaves a half-updated set on disk.
        plans: list[tuple[Path, pl.DataFrame, list[Path]]] = []
        for year in sorted({d.year for d in scraped[DT].to_list()}):
            target = src / f"Candhis_{campaign_id}_{year}_reel.csv"
            # Fold in the year accumulator plus any legacy dated snapshots for this year
            # (e.g. the original manual Candhis_06403_2026-06-27_reel.csv), then retire them.
            legacy = [
                Path(p)
                for p in sorted(
                    glob.glob(str(src / f"Candhis_{campaign_id}_{year}-*_reel.csv"))
                )
            ]
            existing_paths = ([target] if target.exists() else []) + legacy
            existing = (
                pl.concat(
                    [_read_reel_csv(p) for p in existing_paths], how="vertical_relaxed"
                )
                if existing_paths
                else None
            )
            year_scraped = scraped.filter(_year_of(pl.col(DT)) == year)
            merged = coalesce_merge(year_scraped, existing)
            if existing is not None and existing.height:
                # Compare against the de-duplicated existing union, not raw concat height.
                existing_u = existing.unique(subset=[DATE_COL]).with_columns(
                    pl.col(DATE_COL)
                    .str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S", strict=False)
                    .alias(DT)
                )
                _assert_never_shrinks(merged, existing_u, target.name)
                prev_newest = existing_u[DT].max()
                if merged[DT].max() <= prev_newest:
                    print(
                        f"  WARNING {target.name}: newest timestamp did not advance ({prev_newest}); feed may be stale"
                    )
            plans.append((target, merged, legacy))

        written: dict[int, int] = {}
        for target, merged, legacy in plans:
            _atomic_write(target, _serialize(merged))
            for old in legacy:  # retire migrated dated snapshots
                with contextlib.suppress(FileNotFoundError):
                    old.unlink()
                print(f"  migrated + removed legacy {old.name}")
            year = int(target.stem.split("_")[2])
            written[year] = merged.height
            print(f"  wrote {target.name}  rows={merged.height}")
    return written


def main() -> None:
    p = argparse.ArgumentParser(
        description="Scrape the CANDHIS realtime feed into per-year reel CSVs."
    )
    p.add_argument(
        "--src",
        type=Path,
        default=Path("/Users/hadim/Data/olatu"),
        help="Directory holding the CANDHIS CSVs (same as `ingest --src`); reel files are written here",
    )
    p.add_argument(
        "--campaign", default=CAMPAIGN_ID, help="CANDHIS campaign id (default: 06403)"
    )
    args = p.parse_args()
    try:
        scrape(args.src, args.campaign)
    except ScrapeError as e:
        print(f"scrape aborted: {e}", file=sys.stderr)
        sys.exit(1)
    print("done")


if __name__ == "__main__":
    main()

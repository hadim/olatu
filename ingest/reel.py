"""The realtime reel accumulator: validate CANDHIS realtime rows and merge them into the
per-year `Candhis_<campaign>_<YEAR>_reel.csv` files `build.py` reads (specs 0004 §4-5, 0022).

The rows come from the CANDHIS API (`ingest/candhis_api.py`). The reel is the only record
of sea temperature — the QC'd archive never carries it — so this module is the loud gate;
build.py trusts its input blindly:

  * Coalesce, never clobber: a newly-null cell never erases a previously-good value.
  * Validate before writing: a bad or partial payload aborts and keeps the last-good file
    (nonzero exit), instead of silently degrading history.
  * Never-shrink invariant: the merged file must cover the existing span and have >= as
    many rows, else abort.
  * Atomic write (tmp on the same filesystem + os.replace) under an exclusive lock.
"""

from __future__ import annotations

import contextlib
import fcntl
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import polars as pl

from . import ui
from .outage import Outage
from .schema import REEL_MAP, SENTINEL_MIN

DT = "datetime_utc"  # internal helper column for parsing/sorting
DATE_COL = "Date"  # CANDHIS realtime CSV timestamp column
VALUE_COLS = list(REEL_MAP)  # ["H1/3","Hmax","Th1/3","DirPic","EtalPic","TempMer"]
CSV_HEADER = [DATE_COL] + VALUE_COLS

# --- validation thresholds (a bad payload must abort, never overwrite a good file) ---
# Deliberately *no* minimum row count: a buoy that stopped transmitting legitimately
# returns a handful of rows (or none) and that is upstream reality, not a fault. See
# validate_rows().
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


class FeedError(RuntimeError):
    """A CANDHIS fetch or merge that must abort *without* writing (keep the last-good file)."""


class FeedUnavailable(FeedError, Outage):
    """CANDHIS did not serve the data at all — down, timing out, erroring, out of quota.

    Still a FeedError (every existing handler keeps working, and we still write nothing),
    but tagged as an `Outage` so CI can hold the alarm for a while instead of going red on
    every run through a cerema.fr outage — while a *format* change (a renamed column, a
    changed payload) stays a plain FeedError and fails now. See ingest/outage.py.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, service="CANDHIS API")


# ------------------------------------------------------------------------ validate


def _is_implausible(col: str, v: float | None) -> bool:
    if v is None or v >= SENTINEL_MIN:  # null or the 999.999 sentinel are fine
        return False
    lo, hi = PLAUSIBLE[col]
    return v < lo or v > hi


def validate_rows(rows: list[dict]) -> pl.DataFrame:
    """Turn parsed rows into a typed frame, asserting the payload is trustworthy.

    A *short* payload is not an error. A buoy that went silent returns only the rows
    around its outage, or none — we take what is published and can do nothing about the
    rest. Nor is it unsafe: the merge is an additive coalesce guarded by
    `_assert_never_shrinks`, so a short payload cannot truncate the accumulator. Only a
    *format* break may abort, and that is what the checks below (plus the API parser)
    catch.
    """
    if not rows:  # buoy silent across the whole window; caller skips the merge
        return pl.DataFrame(
            schema={
                DATE_COL: pl.Utf8,
                **{c: pl.Float64 for c in VALUE_COLS},
                DT: pl.Datetime,
            }
        )

    df = pl.DataFrame(
        rows,
        schema={DATE_COL: pl.Utf8, **{c: pl.Float64 for c in VALUE_COLS}},
    ).with_columns(
        pl.col(DATE_COL).str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S").alias(DT)
    )

    if df[DT].null_count():
        raise FeedError("some timestamps failed to parse")
    if df[DT].n_unique() != df.height:
        raise FeedError("duplicate timestamps in a single payload")
    minute, second = df[DT].dt.minute(), df[DT].dt.second()
    if not (minute.is_in([0, 30]).all() and (second == 0).all()):
        raise FeedError("timestamps are not on the :00/:30 grid")

    newest = df[DT].max()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if newest > now + FUTURE_TOLERANCE:
        raise FeedError(
            f"newest row {newest} is in the future (now {now}); clock/tz fault?"
        )

    bad = sum(any(_is_implausible(c, r[c]) for c in VALUE_COLS) for r in rows)
    if bad / len(rows) > MAX_BAD_FRACTION:
        raise FeedError(f"{bad}/{len(rows)} rows out of plausible range; format break?")

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


def coalesce_merge(fresh: pl.DataFrame, existing: pl.DataFrame | None) -> pl.DataFrame:
    """Union fresh + existing, one row per timestamp; fresh wins *only when non-null*.

    A freshly-null cell therefore never clobbers a previously-good value -- crucial for
    sea temperature, whose only source is this feed.
    """
    if existing is None or existing.height == 0:
        return fresh.sort(DT, descending=True)
    # fresh first so `drop_nulls().first()` prefers it where present, else falls back.
    both = pl.concat([fresh, existing], how="vertical_relaxed")
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
        raise FeedError(
            f"{label}: merged has fewer rows ({merged.height} < {existing.height})"
        )
    if merged[DT].min() > existing[DT].min() or merged[DT].max() < existing[DT].max():
        raise FeedError(f"{label}: merged span does not cover the existing span")


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
def _lock(src: Path, campaign: str):
    """Exclusive, non-blocking lock so two overlapping runs can't race the merge."""
    src.mkdir(parents=True, exist_ok=True)
    lock_path = src / f".reel_{campaign}.lock"
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as e:
            raise FeedError("another refresh is already running (lock held)") from e
        yield
    finally:
        with contextlib.suppress(OSError):
            fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def merge_rows(src: Path, fresh: pl.DataFrame, campaign: str) -> dict[int, int]:
    """Coalesce-merge a validated realtime frame into the per-year reel CSVs in `src`.

    Returns {year: row_count_written}. Raises FeedError on any unsafe condition, leaving
    every existing file untouched.
    """
    with _lock(src, campaign):
        # Plan every year's merge in memory first; only write once all pass validation,
        # so a failure mid-way never leaves a half-updated set on disk.
        plans: list[tuple[Path, pl.DataFrame]] = []
        for year in sorted(set(fresh[DT].dt.year().to_list())):
            target = src / f"Candhis_{campaign}_{year}_reel.csv"
            existing = (
                _read_reel_csv(target).unique(subset=[DATE_COL])
                if target.exists()
                else None
            )
            merged = coalesce_merge(
                fresh.filter(pl.col(DT).dt.year() == year), existing
            )
            if existing is not None and existing.height:
                _assert_never_shrinks(merged, existing, target.name)
                prev_newest = existing[DT].max()
                if merged[DT].max() <= prev_newest:
                    ui.warn(
                        f"{target.name}: newest timestamp did not advance ({prev_newest}); feed may be stale"
                    )
            plans.append((target, merged))

        written: dict[int, int] = {}
        for target, merged in plans:
            _atomic_write(target, _serialize(merged))
            written[int(target.stem.split("_")[2])] = merged.height
            ui.detail(f"wrote {target.name}  rows={merged.height}")
    return written

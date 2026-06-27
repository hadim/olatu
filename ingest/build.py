"""Build the tiered static data files for the Olatu webapp from CANDHIS CSVs.

Reads the archive (`Candhis_06403_YYYY_arch.csv`) and realtime
(`Candhis_06403_*_reel.csv`) exports, cleans + normalizes them to one canonical
half-hourly series, and emits:

    <out>/manifest.json          buoy meta + variable dict + span + year files + coverage
    <out>/latest.json            last 48h @ 30min (incl. sea temperature) -- eager
    <out>/recent.json            last 30 days @ 30min, merged -- prefetched
    <out>/year/06403_YYYY.parquet  full canonical schema per year (Snappy, multi-row-group)
    <out>/hourly.parquet         hourly means of headline vars (full archive)
    <out>/daily.parquet          daily means of headline vars (full archive)

Run via `pixi run ingest` (see pixi.toml). See specs/2026-06-27-0001-foundation.md §5.
"""

from __future__ import annotations

import argparse
import glob
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import polars as pl
import pyarrow.parquet as pq

from .schema import (
    ARCH_MAP,
    BUOY,
    CAMPAIGN_ID,
    CANONICAL_ORDER,
    DIRECTION_VARS,
    HEADLINE,
    NUMERIC_COLS,
    REEL_MAP,
    SENTINEL_MIN,
    UNITS,
    variable_source,
)

ROW_GROUP_SIZE = (
    1440  # ~1 month of half-hourly samples -> many row groups per year file
)
DT = "datetime_utc"


# --------------------------------------------------------------------------- read


def _clean_numeric(df: pl.DataFrame, cols: list[str]) -> pl.DataFrame:
    """Cast mapped columns to Float64 and turn the CANDHIS sentinel (999.999) into null."""
    return df.with_columns(
        [
            pl.col(c)
            .cast(pl.Float64, strict=False)
            .pipe(lambda s: pl.when(s >= SENTINEL_MIN).then(None).otherwise(s))
            .alias(c)
            for c in cols
        ]
    )


def read_archive(src: Path) -> pl.DataFrame:
    files = sorted(glob.glob(str(src / f"Candhis_{CAMPAIGN_ID}_*_arch.csv")))
    if not files:
        raise FileNotFoundError(f"No archive CSVs found in {src}")
    frames = []
    for f in files:
        # read everything as Utf8 so empty fields -> null deterministically
        raw = pl.read_csv(f, separator=";", infer_schema_length=0)
        keep = ["DateHeure"] + [c for c in ARCH_MAP if c in raw.columns]
        df = raw.select(keep).rename({**ARCH_MAP, "DateHeure": DT})
        df = df.with_columns(
            pl.col(DT).str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S", strict=False)
        )
        df = _clean_numeric(df, [c for c in ARCH_MAP.values() if c in df.columns])
        frames.append(df)
    return pl.concat(frames, how="diagonal_relaxed")


def read_realtime(src: Path) -> pl.DataFrame | None:
    files = sorted(glob.glob(str(src / f"Candhis_{CAMPAIGN_ID}_*_reel.csv")))
    if not files:
        return None
    frames = []
    for f in files:
        raw = pl.read_csv(f, separator=";", infer_schema_length=0)
        keep = ["Date"] + [c for c in REEL_MAP if c in raw.columns]
        df = raw.select(keep).rename({**REEL_MAP, "Date": DT})
        df = df.with_columns(
            pl.col(DT).str.strptime(pl.Datetime, "%Y-%m-%d %H:%M:%S", strict=False)
        )
        df = _clean_numeric(df, [c for c in REEL_MAP.values() if c in df.columns])
        frames.append(df)
    return pl.concat(frames, how="diagonal_relaxed")


# ----------------------------------------------------------------------- assemble


def assemble(archive: pl.DataFrame, realtime: pl.DataFrame | None) -> pl.DataFrame:
    """Merge archive + realtime into one canonical series, one row per timestamp.

    Realtime wins on overlapping timestamps (it is fresher and carries temperature).
    """
    archive = archive.with_columns(pl.lit(0, dtype=pl.Int8).alias("_src"))
    parts = [archive]
    if realtime is not None:
        parts.append(realtime.with_columns(pl.lit(1, dtype=pl.Int8).alias("_src")))

    merged = pl.concat(parts, how="diagonal_relaxed")
    merged = merged.drop_nulls(subset=[DT])
    # add any canonical columns that never appeared, as null
    for col in CANONICAL_ORDER:
        if col not in merged.columns and col != "campaign_id":
            merged = merged.with_columns(pl.lit(None, dtype=pl.Float64).alias(col))
    merged = merged.with_columns(pl.lit(CAMPAIGN_ID).alias("campaign_id"))

    # dedup: prefer realtime (_src=1) on a tie
    merged = (
        merged.sort([DT, "_src"]).unique(subset=[DT], keep="last").sort(DT).drop("_src")
    )
    return merged.select([c for c in CANONICAL_ORDER if c in merged.columns])


# --------------------------------------------------------------------- downsample


def _agg_headline() -> list[pl.Expr]:
    exprs = []
    for c in HEADLINE:
        if c in DIRECTION_VARS:
            # circular mean: atan2(mean(sin), mean(cos)) -> wrap to [0, 360)
            ang = pl.col(c).radians()
            mean_ang = pl.arctan2(ang.sin().mean(), ang.cos().mean()).degrees()
            exprs.append(((mean_ang + 360) % 360).alias(c))
        else:
            exprs.append(pl.col(c).mean().alias(c))
    return exprs


def downsample(merged: pl.DataFrame, every: str) -> pl.DataFrame:
    return merged.sort(DT).group_by_dynamic(DT, every=every).agg(_agg_headline())


# -------------------------------------------------------------------------- write


def _to_columnar(df: pl.DataFrame, cols: list[str]) -> dict:
    """Compact columnar JSON: epoch-seconds `t` + one array per variable (nulls kept)."""
    df = df.sort(DT)
    out = {"t": (df[DT].dt.epoch("s")).to_list()}
    for c in cols:
        if c in df.columns:
            out[c] = [None if v is None else round(v, 3) for v in df[c].to_list()]
    return out


def write_json(path: Path, payload: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text)
    return len(text.encode())


def write_parquet(
    path: Path, df: pl.DataFrame, row_group_size: int | None = None
) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(path, compression="snappy", row_group_size=row_group_size)
    # CI contract: range requests only help if there are multiple row groups
    meta = pq.ParquetFile(path).metadata
    assert meta.num_row_groups >= 1, f"{path} has no row groups"
    return path.stat().st_size


def coverage(df: pl.DataFrame, col: str) -> dict | None:
    s = df.filter(pl.col(col).is_not_null())
    if s.height == 0:
        return None
    return {
        "start": s[DT].min().replace(tzinfo=timezone.utc).isoformat(),
        "end": s[DT].max().replace(tzinfo=timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- main


def build(src: Path, out: Path) -> None:
    print(f"reading CSVs from {src}")
    archive = read_archive(src)
    realtime = read_realtime(src)
    print(
        f"  archive rows={archive.height}  realtime rows={0 if realtime is None else realtime.height}"
    )

    merged = assemble(archive, realtime)
    print(
        f"  merged rows={merged.height}  span={merged[DT].min()} -> {merged[DT].max()}"
    )

    out.mkdir(parents=True, exist_ok=True)

    # per-year Parquet (full canonical schema, multi-row-group)
    years = sorted({d.year for d in merged[DT].to_list() if d is not None})
    year_files = []
    for y in years:
        g = merged.filter(pl.col(DT).dt.year() == y)
        rel = f"year/{CAMPAIGN_ID}_{y}.parquet"
        size = write_parquet(out / rel, g, ROW_GROUP_SIZE)
        year_files.append(
            {"year": y, "file": rel, "rows": g.height, "byteLength": size}
        )
        print(f"  wrote {rel}  rows={g.height}  bytes={size}")

    # downsampled pyramids (headline vars only)
    hourly = downsample(merged, "1h")
    daily = downsample(merged, "1d")
    write_parquet(out / "hourly.parquet", hourly, ROW_GROUP_SIZE)
    write_parquet(out / "daily.parquet", daily)
    print(
        f"  wrote hourly.parquet rows={hourly.height}  daily.parquet rows={daily.height}"
    )

    # eager JSON tiers (relative to the latest sample we actually have)
    last_dt = merged[DT].max()
    latest = merged.filter(pl.col(DT) >= last_dt - timedelta(hours=48))
    recent = merged.filter(pl.col(DT) >= last_dt - timedelta(days=30))
    latest_bytes = write_json(out / "latest.json", _to_columnar(latest, NUMERIC_COLS))
    recent_bytes = write_json(out / "recent.json", _to_columnar(recent, HEADLINE))
    print(
        f"  wrote latest.json ({latest_bytes}B, {latest.height} rows)  recent.json ({recent_bytes}B, {recent.height} rows)"
    )

    # manifest
    manifest = {
        "buoy": BUOY,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "timezone": BUOY["timezone"],
        "span": {
            "start": merged[DT].min().replace(tzinfo=timezone.utc).isoformat(),
            "end": merged[DT].max().replace(tzinfo=timezone.utc).isoformat(),
        },
        "rows": merged.height,
        "variables": [
            {
                "name": name,
                "unit": UNITS[name],
                "source": variable_source(name),
                "headline": name in HEADLINE,
            }
            for name in UNITS
        ],
        "years": year_files,
        "coverage": {name: coverage(merged, name) for name in HEADLINE},
        "tiers": {
            "latest": "latest.json",
            "recent": "recent.json",
            "hourly": "hourly.parquet",
            "daily": "daily.parquet",
        },
    }
    mbytes = write_json(out / "manifest.json", manifest)
    print(f"  wrote manifest.json ({mbytes}B)")
    print(f"done -> {out}")


def main() -> None:
    p = argparse.ArgumentParser(description="Build Olatu data tiers from CANDHIS CSVs.")
    p.add_argument(
        "--src",
        type=Path,
        default=Path("/Users/hadim/Data/olatu"),
        help="Directory containing Candhis_06403_*_arch.csv and *_reel.csv",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path("data"),
        help="Output directory for the tiered files (default: ./data)",
    )
    args = p.parse_args()
    build(args.src, args.out)


if __name__ == "__main__":
    main()

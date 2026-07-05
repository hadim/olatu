"""Fetch tide predictions from api-maree.fr and derive high/low extrema.

See specs/2026-07-05-0008-tides.md. api-maree.fr serves a dense **water-level** series
(metres) computed from IFREMER / PREVIMER harmonic components (CC-BY); it has no high/low
or coefficient endpoint, so we reduce the series to extrema ourselves (a port of
wave-monitor's `sync-tides.ts findExtrema`). The key is **ingest-only** and never reaches
the webapp, which only ever reads the derived `tides.json`.

Per campaign, each run (gated -- see the horizon gate below):

  1. fetch `/water-levels` for the buoy's `tide_site` over J-30..J+30 at step=10 min, in
     10-day chunks (1440 pts < the 1500/req cap), tz=UTC (Olatu stores UTC),
  2. reduce to high/low extrema (windowed slope test + parabolic sub-sample + de-dup),
  3. replace-window coalesce into the forward-growing accumulator
     `raw/<campaign>_tides.csv` (keep old events outside the fetched window, replace inside),
  4. emit `data/tides.json` (the tier the webapp reads from the HF bucket).

A missing key / bad site / fetch failure is non-fatal: the step logs and falls back to the
existing accumulator so the rest of the refresh still runs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import polars as pl

from .schema import CAMPAIGN_ID, buoy

API_BASE = "https://api-maree.fr/water-levels"
ENV_KEY = "API_MAREE_KEY"

STEP_MINUTES = 10  # J+/-30 * 144 pts/day, chunked -> under the 1500 pts/request cap
CHUNK_DAYS = 10  # 10 d * 144 = 1440 pts/request < 1500
WINDOW_PAST_DAYS = 30  # J-30 (api-maree.fr free-tier floor)
WINDOW_FWD_DAYS = 30  # J+30 (api-maree.fr free-tier ceiling)
REQUEST_DELAY_S = 0.25  # polite spacing between chunk requests

# Extrema detection. A W-sample slope test (W=3 ~ 30 min at step=10) survives the API's
# 3-decimal plateaus near peaks where a strict b>a && b>c test fails; 30 min is well under
# a semi-diurnal quarter-period (~3 h). Consecutive extrema are >= 3 h apart, so two
# same-kind detections within 3 h are spurious (keep the more pronounced).
SLOPE_W = 3
MIN_SEPARATION_S = 3 * 3600

# Only fetch when the accumulator's forward horizon drops below this (stateless, quota-
# polite): a fetch restores +30 days, so it re-fires ~ every 10 days per buoy. The
# accumulator always still brackets "now", so the banner never goes empty between fetches.
HORIZON_GATE_DAYS = 20

# CC-BY attribution, required by the source (confirmed on api-maree.fr /mentions-legales:
# IFREMER / PREVIMER harmonic components referenced in Sextant). Re-check the CGU wording
# before launch. This travels inside tides.json so the webapp can surface it.
TIDE_SOURCE = {
    "provider": "api-maree.fr",
    "upstream": "IFREMER / PREVIMER",
    "license": "CC-BY",
    "credit": (
        "Hauteurs d'eau diffusées par api-maree.fr, calculées à partir de "
        "composantes harmoniques IFREMER / PREVIMER."
    ),
    "url": "https://api-maree.fr",
}

_ACC_SCHEMA = {"t": pl.Int64, "h": pl.Float64, "k": pl.Utf8}


class TideError(RuntimeError):
    """A tide fetch/parse failure that should be logged but not abort the whole refresh."""


# ------------------------------------------------------------------------- time helpers


def _naive_utc(dt: datetime) -> str:
    """api-maree.fr wants a naive 'YYYY-MM-DDTHH:MM'; we pair it with tz=UTC."""
    return dt.strftime("%Y-%m-%dT%H:%M")


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


def fetch_water_levels(
    key: str, site: str, start: datetime, end: datetime
) -> list[tuple[float, float]]:
    """Dense (epoch_s, height_m) series for `site` over [start, end), fetched in chunks."""
    pts: list[tuple[float, float]] = []
    last_t: float | None = None
    chunk_start = start
    while chunk_start < end:
        chunk_end = min(chunk_start + timedelta(days=CHUNK_DAYS), end)
        r = httpx.get(
            API_BASE,
            params={
                "site": site,
                "from": _naive_utc(chunk_start),
                "to": _naive_utc(chunk_end),
                "step": STEP_MINUTES,
                "tz": "UTC",
                "key": key,
            },
            headers={"accept": "application/json"},
            timeout=30,
        )
        if r.status_code != 200:
            raise TideError(f"api-maree.fr {r.status_code} for {site}: {r.text[:160]}")
        data = r.json().get("data")
        if not isinstance(data, list):
            raise TideError(f"api-maree.fr: unexpected payload for {site}")
        for p in data:
            t = _parse_iso_utc(p["time"])
            if (
                last_t is not None and t <= last_t
            ):  # drop the shared seam / non-monotonic
                continue
            pts.append((t, float(p["height"])))
            last_t = t
        chunk_start = chunk_end
        if chunk_start < end:
            time.sleep(REQUEST_DELAY_S)
    return pts


# ---------------------------------------------------------------------- extrema detection


def find_extrema(pts: list[tuple[float, float]]) -> list[dict]:
    """Reduce a dense water-level series to alternating high/low extrema.

    Port of wave-monitor `sync-tides.ts findExtrema`: W-sample slope test (plateau-robust),
    parabolic sub-sample of the exact time/height through the three neighbours, then a
    same-kind de-dup within 3 h (keep the more pronounced). Input must be time-sorted.
    """
    n = len(pts)
    if n < 2 * SLOPE_W + 1:
        return []
    out: list[dict] = []
    for i in range(SLOPE_W, n - SLOPE_W):
        slope_before = pts[i][1] - pts[i - SLOPE_W][1]
        slope_after = pts[i + SLOPE_W][1] - pts[i][1]
        if slope_before > 0 and slope_after < 0:
            kind = "high"
        elif slope_before < 0 and slope_after > 0:
            kind = "low"
        else:
            continue

        # Parabolic refinement through (i-1, i, i+1), assuming uniform spacing.
        a, b, c = pts[i - 1][1], pts[i][1], pts[i + 1][1]
        denom = a - 2 * b + c
        offset = (a - c) / (2 * denom) if denom != 0 else 0.0
        clamped = max(-0.5, min(0.5, offset))
        step_s = pts[i + 1][0] - pts[i][0]
        t_ref = pts[i][0] + clamped * step_s
        h = b - (a - c) * clamped / 4

        if out:
            last = out[-1]
            if t_ref - last["t"] < MIN_SEPARATION_S:
                if last["k"] == kind:
                    last_better = last["h"] >= h if kind == "high" else last["h"] <= h
                    if last_better:
                        continue
                    out.pop()
                else:
                    # Opposite kinds within 3 h is impossible for a real tide -> drop.
                    continue
        out.append({"t": t_ref, "h": round(h, 2), "k": kind})
    return out


# ----------------------------------------------------------------------------- accumulator


def _acc_path(raw: Path, campaign: str) -> Path:
    return raw / f"{campaign}_tides.csv"


def _load_acc(path: Path) -> pl.DataFrame:
    if not path.exists():
        return pl.DataFrame(schema=_ACC_SCHEMA)
    return pl.read_csv(path, schema_overrides=_ACC_SCHEMA)


def _write_tides_json(data: Path, meta: dict, acc: pl.DataFrame) -> int:
    events = [
        {"t": int(t), "h": round(float(h), 2), "k": k}
        for t, h, k in acc.sort("t").iter_rows()
    ]
    payload = {
        "site": meta.get("tide_site"),
        "site_label": meta.get("tide_site_label", meta.get("tide_site")),
        "timezone": meta["timezone"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "range_ref": meta.get("tide_range_ref"),
        "source": TIDE_SOURCE,
        "events": events,
    }
    data.mkdir(parents=True, exist_ok=True)
    (data / "tides.json").write_text(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    )
    return len(events)


# ----------------------------------------------------------------------------------- run


def refresh_tides(
    raw: Path, data: Path, campaign: str, key: str | None, *, force: bool = False
) -> None:
    """Fetch (gated), coalesce the accumulator, and (re)emit data/tides.json for a campaign."""
    meta = buoy(campaign)
    site = meta.get("tide_site")
    if not site:
        print(f"  tides: {campaign} has no tide_site -> skip")
        return
    if not key:
        print(f"  tides: no {ENV_KEY} -> skip (webapp shows the tide empty-state)")
        return

    acc = _load_acc(_acc_path(raw, campaign))
    tides_json = data / "tides.json"
    now = time.time()
    horizon = acc["t"].max() if acc.height else None

    # Horizon gate: enough forecast in hand -> don't hammer the API. Still publish once if
    # tides.json is somehow missing (e.g. first build off a pulled accumulator).
    if (
        not force
        and horizon is not None
        and horizon - now >= HORIZON_GATE_DAYS * 86_400
    ):
        if tides_json.exists():
            print(
                f"  tides: {campaign} +{(horizon - now) / 86_400:.0f} d ahead -> skip fetch"
            )
            return
        print(
            f"  tides: {campaign} republishing {_write_tides_json(data, meta, acc)} events"
        )
        return

    start = _day_midnight_utc(now) - timedelta(days=WINDOW_PAST_DAYS)
    end = _day_midnight_utc(now) + timedelta(days=WINDOW_FWD_DAYS)
    try:
        pts = fetch_water_levels(key, site, start, end)
        new_events = find_extrema(pts)
        if not new_events:
            raise TideError(f"no extrema from {len(pts)} points")
    except (httpx.HTTPError, TideError, KeyError, ValueError) as e:
        print(
            f"  tides: {campaign} fetch failed ({e}) -> keep existing", file=sys.stderr
        )
        if acc.height and not tides_json.exists():
            _write_tides_json(data, meta, acc)
        return

    # Replace-window merge: keep old events outside [start, end], replace inside with fresh.
    win_start, win_end = int(start.timestamp()), int(end.timestamp())
    new_df = pl.DataFrame(
        {
            "t": [int(round(e["t"])) for e in new_events],
            "h": [e["h"] for e in new_events],
            "k": [e["k"] for e in new_events],
        },
        schema=_ACC_SCHEMA,
    )
    kept = acc.filter((pl.col("t") < win_start) | (pl.col("t") > win_end))
    merged = pl.concat([kept, new_df]).unique(subset=["t"], keep="last").sort("t")

    _acc_path(raw, campaign).parent.mkdir(parents=True, exist_ok=True)
    merged.write_csv(_acc_path(raw, campaign))
    n = _write_tides_json(data, meta, merged)
    print(
        f"  tides: {campaign} {len(new_events)} fresh extrema, {merged.height} total -> tides.json ({n} events)"
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description="Fetch + derive tide extrema from api-maree.fr."
    )
    p.add_argument(
        "--campaign", default=CAMPAIGN_ID, help=f"campaign id (default: {CAMPAIGN_ID})"
    )
    p.add_argument(
        "--raw",
        type=Path,
        default=None,
        help="raw dir (default: hfdata/<campaign>/raw)",
    )
    p.add_argument(
        "--data",
        type=Path,
        default=None,
        help="data dir (default: hfdata/<campaign>/data)",
    )
    p.add_argument(
        "--force", action="store_true", help="fetch even if the horizon gate would skip"
    )
    args = p.parse_args()
    raw = args.raw or Path("hfdata") / args.campaign / "raw"
    data = args.data or Path("hfdata") / args.campaign / "data"
    refresh_tides(raw, data, args.campaign, os.environ.get(ENV_KEY), force=args.force)


if __name__ == "__main__":
    main()

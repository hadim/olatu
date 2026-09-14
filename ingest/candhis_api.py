"""Read CANDHIS through its REST API instead of scraping the HTML table (spec 0022).

Cerema granted Olatu a key to the CANDHIS API v1 on 2026-09-14
(https://candhis.cerema.fr/doc/04_Candhis_API_v1_Utilisateur.pdf). Two functions matter:

    GET https://candhis.cerema.fr/API/v1/getCampTR.php?camp=<id>&dateDeb=YYYY-MM-DD&dateFin=YYYY-MM-DD
    GET https://candhis.cerema.fr/API/v1/getCampTD.php?camp=<id>&dateDeb=YYYY-MM-DD&dateFin=YYYY-MM-DD
    Authorization: <key>

TR is the realtime quick-look, TD ("temps différé") the QC'd archive. Both answer
`{apiVer, success, message, nbLig, entete, results}` with every value a string. Probed by
hand on 2026-09-14:

  * TR rows are identical to the scraped reel CSV (0 value diffs over ~10 500 rows on the
    three buoys), so they go into the SAME `Candhis_<c>_<YEAR>_reel.csv` accumulator
    through `scrape.merge_rows` — build.py cannot tell which feed wrote a row. The only
    difference: the API leaves out the all-empty rows the HTML table lists for a silent
    half-hour.
  * TR is NOT a 48 h window. It serves the whole realtime history (since 2021-05/06 on
    all three buoys), sea temperature included — which the archive never carried.
  * TD rows are identical to the `*_arch.csv` export, except that `QUALITE` is filled and
    repeated as a trailing duplicate column (dropped here).
  * `dateFin` is EXCLUSIVE, one request covers at most 12 months, and "no data" is
    HTTP 200 + `success: true` + `nbLig: 0` (the PDF documents `success: false`).
  * The key has a daily request quota (150 when granted), shared by CI and every local
    run, and no response says what is left — so this module counts its calls and stops
    calling for the rest of the process after the first 429.

`update.py` calls `refresh` for the live tail and `refresh_archive` once a day; `pixi run
candhis` drives both by hand (history backfills, seeding a new buoy).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import polars as pl

from . import ui
from .outage import EXIT_OUTAGE, Outage
from .schema import ARCH_MAP, BUOYS, CAMPAIGN_ID
from .scrape import (
    DATE_COL,
    DT,
    VALUE_COLS,
    FeedUnavailable,
    ScrapeError,
    _atomic_write,
    _classify_header,
    _lock,
    _num,
    _read_reel_csv,
    merge_rows,
    validate_rows,
)

BASE_URL = "https://candhis.cerema.fr/API/v1/"
ENV_KEY = "CANDHIS_API_KEY"  # ingest-only, never shipped to the webapp
MAX_WINDOW_DAYS = 365  # "12 mois maxi par requête"
LIVE_LOOKBACK = timedelta(days=2)  # the HTML table's ~48 h, kept as a floor

ARCHIVE_DATE_COL = "DateHeure"
# Per-campaign state next to the raw CSVs (pulled + uploaded with them), so the archive is
# fetched once a UTC day however many runs there are: {"archive_checked": "YYYY-MM-DD"}.
ARCHIVE_STATE = "candhis_api.json"
# QC'd archive rows land weeks after the fact, so last year keeps changing into the new
# one: refresh it too through the end of February.
ARCHIVE_SETTLE_MONTHS = 2

# Every HTTP call this process made, retries included — the quota counts them all.
requests_made = 0
# Set by the first 429. The quota is per key, so once it is spent every other buoy in the
# run would only collect its own 429; stop asking instead.
quota_spent = False


class QuotaExhausted(FeedUnavailable):
    """HTTP 429: the key's daily quota is spent.

    An outage, not our bug, as far as the run is concerned: it heals at the day boundary,
    and the live window is gap-aware, so the next run that gets through refetches
    everything since the last reading we hold. A missed run costs latency, never data.
    """


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


# --------------------------------------------------------------------------- fetch


def api_get(
    func: str, params: dict, key: str, *, retries: int = 3, timeout: float = 60.0
) -> dict:
    """GET one API function and return its JSON body; raise on anything but a clean reply."""
    global requests_made, quota_spent
    if quota_spent:
        raise QuotaExhausted(
            f"{func}: not called, the daily quota was spent earlier in this run",
            service="CANDHIS API",
        )
    url = BASE_URL + func
    last = ""
    with httpx.Client(headers={"Authorization": key}, timeout=timeout) as client:
        for attempt in range(1, retries + 1):
            requests_made += 1
            try:
                r = client.get(url, params=params)
            except httpx.TransportError as e:
                last = f"{type(e).__name__}: {e}"
            else:
                if r.status_code < 500 and r.status_code != 408:
                    break
                last = f"HTTP {r.status_code}"
            if attempt < retries:
                ui.warn(
                    f"{func} attempt {attempt} failed ({last}); retry in {2 * attempt}s"
                )
                time.sleep(2 * attempt)
        else:
            raise FeedUnavailable(
                f"{func} failed after {retries} attempts: {last}",
                service="CANDHIS API",
            )

    try:
        body = r.json()
    except ValueError:
        # An HTML maintenance page or a PHP fatal in place of JSON: their side is down.
        raise FeedUnavailable(
            f"{func}: HTTP {r.status_code} with a non-JSON body ({r.text[:80]!r})",
            service="CANDHIS API",
        ) from None
    message = body.get("message") if isinstance(body, dict) else None
    if r.status_code == 429:
        quota_spent = True
        raise QuotaExhausted(
            f"{func}: daily request quota spent ({message})", service="CANDHIS API"
        )
    if r.status_code != 200:
        # 400 bad parameter, 401 bad key, 404 unknown function, 423 banned IP: all ours.
        raise ScrapeError(f"{func}: HTTP {r.status_code} ({message})")
    if not isinstance(body, dict) or not isinstance(body.get("nbLig"), int):
        raise ScrapeError(f"{func}: unexpected response shape {str(body)[:120]!r}")
    return body


def _is_no_data(body: dict) -> bool:
    return body["nbLig"] == 0 and str(body.get("message", "")).startswith("Pas de donn")


def _check_success(func: str, campaign: str, body: dict) -> None:
    if body.get("success") not in (True, "True", "true"):
        raise ScrapeError(f"{func} {campaign}: {body.get('message')!r}")


def _day_start(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time())


def fetch_realtime(campaign: str, start: date, end: date, key: str) -> list[dict]:
    """Realtime rows for [start, end) in the reel CSV dialect (`Date` + REEL_MAP columns).

    Fails loudly on a changed header or row shape, exactly like the HTML parser, so a
    format change can never be merged into the accumulator.
    """
    body = api_get(
        "getCampTR.php",
        {"camp": campaign, "dateDeb": start.isoformat(), "dateFin": end.isoformat()},
        key,
    )
    if _is_no_data(body):  # buoy silent across the whole window
        return []
    _check_success("getCampTR", campaign, body)

    header = body.get("entete") or []
    idx: dict[str, int] = {}
    for i, cell in enumerate(header):
        k = _classify_header(cell)
        if k is not None:
            idx[k] = i
    # The API folds date and time into one `Date` cell (the HTML table split them).
    missing = {"_date", *VALUE_COLS} - set(idx)
    if missing or len(header) != 1 + len(VALUE_COLS):
        raise ScrapeError(
            f"getCampTR {campaign}: unexpected header {header} (unresolved {missing})"
        )

    lo, hi = _day_start(start), _day_start(end)
    rows: list[dict] = []
    for rec in body.get("results") or []:
        if len(rec) != len(header):
            raise ScrapeError(f"getCampTR {campaign}: row {rec} has {len(rec)} cells")
        stamp = str(rec[idx["_date"]]).strip()
        try:
            # No timezone in the payload: it is UTC, like the reel CSV these rows match
            # exactly. Parse it as such, then drop the tz to match the naive polars frames.
            dt = datetime.strptime(f"{stamp} +0000", "%Y-%m-%d %H:%M %z").replace(
                tzinfo=None
            )
            values = {col: _num(str(rec[idx[col]])) for col in VALUE_COLS}
        except ValueError as e:
            raise ScrapeError(
                f"getCampTR {campaign}: unparseable row {rec}: {e}"
            ) from e
        if not lo <= dt < hi:
            # Catches the API changing its window semantics (e.g. an inclusive dateFin),
            # which would otherwise duplicate the boundary row across year windows.
            raise ScrapeError(f"getCampTR {campaign}: {stamp} outside [{start}, {end})")
        rows.append({DATE_COL: dt.strftime("%Y-%m-%d %H:%M:%S"), **values})
    if body["nbLig"] != len(rows):
        raise ScrapeError(
            f"getCampTR {campaign}: nbLig {body['nbLig']} but {len(rows)} rows"
        )
    return rows


def fetch_archive(campaign: str, start: date, end: date, key: str) -> pl.DataFrame:
    """Archive (TD) rows for [start, end) as an all-string frame in the `*_arch.csv` layout.

    Values stay the API's strings (`"0.48"`, not a re-printed float) so the merged CSV is
    byte-comparable with a manual export. Empty cells become null.
    """
    body = api_get(
        "getCampTD.php",
        {"camp": campaign, "dateDeb": start.isoformat(), "dateFin": end.isoformat()},
        key,
    )
    if _is_no_data(body):
        return pl.DataFrame(schema={ARCHIVE_DATE_COL: pl.Utf8})
    _check_success("getCampTD", campaign, body)

    header = [str(h) for h in body.get("entete") or []]
    missing = {ARCHIVE_DATE_COL, *ARCH_MAP} - set(header)
    if missing:
        raise ScrapeError(f"getCampTD {campaign}: header lacks {sorted(missing)}")
    results = body.get("results") or []
    if body["nbLig"] != len(results) or any(len(r) != len(header) for r in results):
        raise ScrapeError(
            f"getCampTD {campaign}: nbLig {body['nbLig']}, {len(results)} rows, "
            f"not all {len(header)} cells wide"
        )
    # The payload repeats `QUALITE` as its last column; the CSV export keeps one. Take
    # every name at its FIRST occurrence.
    first: dict[str, int] = {}
    for i, name in enumerate(header):
        first.setdefault(name, i)
    frame = pl.DataFrame(
        {
            name: [None if r[i] in ("", None) else str(r[i]) for r in results]
            for name, i in first.items()
        },
        schema={name: pl.Utf8 for name in first},
    )

    stamps = frame[ARCHIVE_DATE_COL].str.strptime(
        pl.Datetime, "%Y-%m-%d %H:%M:%S", strict=False
    )
    if stamps.null_count():
        raise ScrapeError(f"getCampTD {campaign}: unparseable {ARCHIVE_DATE_COL}")
    if stamps.min() < _day_start(start) or stamps.max() >= _day_start(end):
        raise ScrapeError(f"getCampTD {campaign}: rows outside [{start}, {end})")
    if stamps.n_unique() != frame.height:
        raise ScrapeError(f"getCampTD {campaign}: duplicate timestamps")
    return frame


# -------------------------------------------------------------------------- window


def year_windows(start: date, end: date) -> list[tuple[date, date]]:
    """Split [start, end) at calendar-year boundaries — each piece fits the 12-month cap."""
    out = []
    cur = start
    while cur < end:
        nxt = min(date(cur.year + 1, 1, 1), end)
        out.append((cur, nxt))
        cur = nxt
    return out


def newest_reading(src: Path, campaign: str) -> datetime | None:
    """The newest timestamp already in the reel accumulator (None when there is none)."""
    for f in sorted(src.glob(f"Candhis_{campaign}_*_reel.csv"), reverse=True):
        newest = _read_reel_csv(f)[DT].max()
        if newest is not None:
            return newest
    return None


def live_window(
    src: Path, campaign: str, now: datetime | None = None
) -> tuple[date, date]:
    """The window a routine refresh asks for: from the last reading we hold, through today.

    Gap-aware on purpose (LEARNINGS 2026-09-03): a fixed "last 48 h" turns every pipeline
    outage longer than that into a permanent hole. The HTML table forced it; the API does
    not, so one request refills any outage up to a year.
    """
    today = (now or datetime.now(timezone.utc)).date()
    start = today - LIVE_LOOKBACK
    newest = newest_reading(src, campaign)
    if newest is not None:
        start = min(start, newest.date())
    start = max(start, today - timedelta(days=MAX_WINDOW_DAYS - 1))
    return start, today + timedelta(days=1)


def archive_years(today: date) -> list[int]:
    """The archive years a daily refresh re-fetches: this one, plus last one until March."""
    if today.month <= ARCHIVE_SETTLE_MONTHS:
        return [today.year - 1, today.year]
    return [today.year]


def archive_due(src: Path, today: date | None = None) -> bool:
    """True unless this campaign's archive was already checked today (UTC)."""
    try:
        state = json.loads((src / ARCHIVE_STATE).read_text())
    except (OSError, ValueError):
        return True
    return state.get("archive_checked") != (today or _utc_today()).isoformat()


# --------------------------------------------------------------------------- merge


def merge_archive(
    src: Path, campaign: str, year: int, fetched: pl.DataFrame
) -> Path | None:
    """Coalesce fetched TD rows into `Candhis_<c>_<year>_arch.csv`; its path if it changed.

    The reel merge's rules: a fetched cell wins only when non-null, so the API can extend
    and correct the archive but never blank a value, and the union cannot shrink. The
    existing file's column order is kept, so the CSV stays diffable against an export.
    """
    target = src / f"Candhis_{campaign}_{year}_arch.csv"
    with _lock(src, campaign):
        existing = (
            pl.read_csv(target, separator=";", infer_schema_length=0)
            if target.exists() and target.stat().st_size
            else None
        )
        cols = existing.columns if existing is not None else fetched.columns
        fresh = fetched.select(
            [
                pl.col(c) if c in fetched.columns else pl.lit(None, pl.Utf8).alias(c)
                for c in cols
            ]
        )
        if existing is None:
            merged = fresh.sort(ARCHIVE_DATE_COL)
        else:
            existing = existing.sort(ARCHIVE_DATE_COL)
            merged = (
                pl.concat([fresh, existing], how="vertical")
                .group_by(ARCHIVE_DATE_COL, maintain_order=True)
                .agg(
                    [
                        pl.col(c).drop_nulls().first()
                        for c in cols
                        if c != ARCHIVE_DATE_COL
                    ]
                )
                .select(cols)
                .sort(ARCHIVE_DATE_COL)
            )
            if merged.height < existing.height:
                raise ScrapeError(f"{target.name}: merged archive would shrink")
            if merged.equals(existing):
                return None
        _atomic_write(
            target, merged.write_csv(separator=";", null_value="", line_terminator="\n")
        )
    return target


# --------------------------------------------------------------------------- driver


def refresh(
    src: Path,
    campaign: str,
    key: str,
    start: date | None = None,
    end: date | None = None,
) -> dict[int, int]:
    """Fetch realtime [start, end) (default: the live window) into the reel CSVs.

    Returns {year: row_count_written}. Raises ScrapeError (or its FeedUnavailable /
    QuotaExhausted outages) leaving every existing file untouched for the failing window.
    """
    if start is None or end is None:
        start, end = live_window(src, campaign)
    written: dict[int, int] = {}
    for a, b in year_windows(start, end):
        scraped = validate_rows(fetch_realtime(campaign, a, b, key))
        if not scraped.height:
            ui.detail(f"getCampTR {campaign} [{a}, {b}): no data")
            continue
        ui.detail(
            f"getCampTR {campaign} [{a}, {b}): {scraped.height} rows  "
            f"{scraped[DT].min()} → {scraped[DT].max()}"
        )
        written.update(merge_rows(src, scraped, campaign))
    return written


def refresh_archive(
    src: Path,
    campaign: str,
    key: str,
    years: list[int] | None = None,
    today: date | None = None,
) -> list[Path]:
    """Fetch the archive (TD) year by year and merge it; return the CSVs that changed.

    Records today in the campaign's state file only once every year went through, so a
    quota or outage failure leaves the refresh due for the next run.
    """
    today = today or _utc_today()
    changed: list[Path] = []
    for y in years or archive_years(today):
        start, end = date(y, 1, 1), min(date(y + 1, 1, 1), today + timedelta(days=1))
        if start >= end:
            continue
        fetched = fetch_archive(campaign, start, end, key)
        if not fetched.height:
            ui.detail(f"getCampTD {campaign} {y}: no data")
            continue
        path = merge_archive(src, campaign, y, fetched)
        ui.detail(
            f"getCampTD {campaign} {y}: {fetched.height} rows through "
            f"{fetched[ARCHIVE_DATE_COL].max()} → "
            + (f"updated {path.name}" if path else "unchanged")
        )
        if path is not None:
            changed.append(path)
    src.mkdir(parents=True, exist_ok=True)
    (src / ARCHIVE_STATE).write_text(
        json.dumps({"archive_checked": today.isoformat()}) + "\n"
    )
    return changed


def main() -> None:
    p = argparse.ArgumentParser(
        description="Fetch CANDHIS realtime (default) or archive data from the API into the raw CSVs."
    )
    p.add_argument(
        "-c",
        "--campaign",
        action="append",
        help=f"Campaign id; repeat for several (default: {CAMPAIGN_ID}).",
    )
    p.add_argument("--all", action="store_true", help="Every buoy in schema.BUOYS.")
    p.add_argument(
        "--work",
        type=Path,
        default=Path("hfdata"),
        help="Working mirror root; CSVs are merged into <work>/<campaign>/raw.",
    )
    p.add_argument(
        "--archive",
        action="store_true",
        help="Fetch the QC'd archive (TD) instead of the realtime feed (TR).",
    )
    p.add_argument(
        "--since",
        type=date.fromisoformat,
        help="Backfill from this date, one request per calendar year "
        "(default: the live window, or this year's archive with --archive).",
    )
    p.add_argument(
        "--until",
        type=date.fromisoformat,
        help="Backfill end, exclusive (default: tomorrow).",
    )
    args = p.parse_args()

    key = os.environ.get(ENV_KEY)
    if not key:
        ui.err(f"{ENV_KEY} is not set (pixi run does not read .env — export it first)")
        sys.exit(1)
    campaigns = list(BUOYS) if args.all else (args.campaign or [CAMPAIGN_ID])
    until = args.until or _utc_today() + timedelta(days=1)

    failures: list[Exception] = []
    for c in campaigns:
        src = args.work / c / "raw"
        ui.section(
            ui.ICON_SCRAPE,
            "candhis api",
            f"campaign {c} · {'TD' if args.archive else 'TR'}",
        )
        try:
            if args.archive:
                years = (
                    list(range(args.since.year, (until - timedelta(days=1)).year + 1))
                    if args.since
                    else None
                )
                changed = refresh_archive(src, c, key, years)
                ui.ok(f"{c}: " + (", ".join(p.name for p in changed) or "unchanged"))
            else:
                written = refresh(
                    src, c, key, args.since, until if args.since else None
                )
                ui.ok(
                    f"{c}: "
                    + (
                        ", ".join(f"{y}={n}" for y, n in sorted(written.items()))
                        or "nothing new"
                    )
                )
        except ScrapeError as e:
            ui.err(f"{c}: {e}")
            failures.append(e)
    ui.detail(f"{requests_made} API request(s) this run")
    if failures:
        sys.exit(1 if any(not isinstance(e, Outage) for e in failures) else EXIT_OUTAGE)


if __name__ == "__main__":
    main()

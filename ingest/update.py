"""End-to-end data refresh: pull → scrape → tides → wind → build → upload, with the HF
bucket as the single source of truth. Each run refreshes all three sources per buoy — the
CANDHIS buoy feed, the nearest port's tides (api-maree.fr), and the nearest station's wind
(Météo-France) — not just the buoy (specs 0008, 0012).

The data no longer lives in git. It lives in the Hugging Face **bucket**
`hadim/olatu`, nested under a `buoys/` root per campaign (spec 0009 — symmetric with the
port-keyed `tides/<port>/` root):

    buoys/<campaign>/raw/Candhis_<campaign>_<YEAR>_arch.csv   immutable archive (seeded once)
    buoys/<campaign>/raw/Candhis_<campaign>_<YEAR>_reel.csv   the growing realtime accumulator
    buoys/<campaign>/data/manifest.json | latest.json | recent.json | year/*.parquet | hourly/*.parquet | daily.parquet
                                                       the tiers the webapp fetches at runtime
    buoys/<campaign>/backup/<UTC-date>/*_reel.csv            daily reel snapshots (see snapshot_reel)

The local working mirror stays flat at `hfdata/<campaign>/{raw,data}`; only the bucket
layout nests under `buoys/`.

Why a bucket: the webapp is a static browser app and needs public HTTPS + CORS (+
range) to read the tiers. A *public* bucket's `…/buckets/<ns>/<name>/resolve/<key>`
URLs deliver exactly that — anonymous, CORS-enabled, range-capable, off the same CDN
as dataset repos — while the mutable overwrite-in-place model avoids the git-history
bloat the every-30-min refresh used to accrue. The trade-off: buckets are
non-versioned, so the forward-only reel has no rollback — hence snapshot_reel keeps
dated recovery points. See specs/2026-06-27-0004-realtime-scraper.md §6.

This orchestrator runs the same locally (`pixi run update`, your stored HF login) and
in CI (the HF_TOKEN secret, a bucket-scoped fine-grained token; without it, the
GitHub Actions OIDC trusted-publisher exchange — see resolve_token). Each run:

  1. pull the realtime accumulator (always) + archive (only if missing) from the bucket
     into a local working mirror (`./hfdata/<campaign>/raw`),
  2. scrape the live CANDHIS feed and coalesce-merge it into the accumulator,
  3. build the tiers into `./hfdata/<campaign>/data`,
  4. upload the tiers + the updated accumulator back to the bucket (+ a daily reel snapshot).

HF is canonical, so pulling before scraping means a local run can never regress the
forward-growing series the cron has already advanced.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Annotated

import httpx
import typer

from . import build as build_mod
from . import scrape as scrape_mod
from . import tides as tides_mod
from . import ui
from . import wind as wind_mod
from .schema import CAMPAIGN_ID, buoy, resolve_tide_port, resolve_wind_station

DEFAULT_REPO = "hadim/olatu"  # HF bucket id
HF_AUD = "https://huggingface.co"

# HF rate-limits bursts of OIDC token exchanges (the every-30-min cron occasionally
# trips a 429); unlike huggingface_hub's own calls, our raw httpx exchange has no
# retry, so a single transient blip aborts the whole run. Back off and retry.
_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})

# Backoff for the exchange: 3, 6, 12, 24, 48, 60, 60 s (~3.5 min over 8 attempts). The old
# 1-2-4-8 s schedule (15 s total) sat entirely inside HF's rate-limit window, so a 429 on
# the first call was a 429 on all five (2026-09-01); and on 2026-09-02 a degraded Hub
# aborted 5 exchanges in a row before the 6th landed, so 6 attempts was the bare minimum.
# Worst case (every attempt hitting the 30 s request timeout) stays under the 600 s
# `_net("auth", …)` watchdog and far under the job's 15-min cap.
_POST_ATTEMPTS = 8
_POST_BASE_DELAY_S = 3.0
_POST_MAX_DELAY_S = 60.0


def _hf_aborted(resp: httpx.Response) -> bool:
    """True when HF's token endpoint reports ITS OWN upstream timeout as a client error.

    On 2026-09-02 three consecutive crons died on
    `400 {"error":"invalid_grant","error_description":"This operation was aborted"}`.
    That is Node's AbortSignal message: the Hub gave up verifying our GitHub id_token
    (its own fetch timed out), not a bad grant — the next cron exchanged the very same
    kind of token fine. A status-only retry never fires on a 400, so match the body.
    """
    if resp.status_code != 400:
        return False
    try:
        body = resp.json()
    except ValueError:
        return False
    if not isinstance(body, dict):
        return False
    return "aborted" in str(body.get("error_description", "")).lower()


# A *transport* fault (reset, refused, timeout) is as transient as a 5xx and must retry the
# same way. It didn't: on 2026-07-13 HF dropped connections mid-handshake and the run died
# on the very first call with `ConnectError: Connection reset by peer`, before any buoy was
# touched. httpx.TransportError covers Connect/Read/Write/Pool errors + protocol resets;
# OSError catches the same faults when they surface from huggingface_hub's own stack.
_TRANSIENT = (httpx.TransportError, OSError)

# Upper bound on any single network step. HF stalling mid-read used to hang the run
# forever (see ui.watchdog); 10 min is ~20x a healthy full-archive pull. 0 disables.
NET_TIMEOUT_S = float(os.environ.get("OLATU_NET_TIMEOUT", "600"))

# Sentinel: lets update() resolve its own token (library use) while main() resolves
# once and shares it across campaigns (one OIDC exchange per run, not one per buoy).
_RESOLVE_TOKEN = object()


# ------------------------------------------------------------------------ auth


def _post_with_retry(
    url: str,
    *,
    attempts: int = _POST_ATTEMPTS,
    base_delay: float = _POST_BASE_DELAY_S,
    max_delay: float = _POST_MAX_DELAY_S,
    **kwargs,
) -> httpx.Response:
    """POST, retrying transient faults with backoff: 429/5xx, connection errors, *and*
    HF's "operation was aborted" 400 (see `_hf_aborted`).

    Retrying only status codes isn't enough: a reset peer raises instead of answering, and
    that exception used to escape and abort the whole refresh (2026-07-13). Both paths back
    off the same way; the status path honours Retry-After.
    """
    last: Exception | None = None
    for i in range(attempts):
        try:
            resp = httpx.post(url, **kwargs)
        except _TRANSIENT as e:
            last = e
            if i == attempts - 1:
                break
            delay = min(base_delay * 2**i, max_delay)
            ui.warn(f"HF unreachable ({type(e).__name__}); retrying in {delay:.0f}s")
            time.sleep(delay)
            continue
        aborted = _hf_aborted(resp)
        # Last attempt: hand the response back so the caller reports the real status.
        if (resp.status_code not in _RETRY_STATUS and not aborted) or i == attempts - 1:
            return resp
        retry_after = resp.headers.get("retry-after", "")
        delay = min(
            float(retry_after) if retry_after.isdigit() else base_delay * 2**i,
            max_delay,
        )
        why = (
            "aborted its own upstream call (400)"
            if aborted
            else f"returned {resp.status_code}"
        )
        ui.warn(f"HF {why}; retrying in {delay:.0f}s")
        time.sleep(delay)
    raise RuntimeError(f"HF unreachable after {attempts} attempts: {last!r}")


# --------------------------------------------------------------------- resilience


def _net(label: str, fn, *args, attempts: int = 3, **kwargs):
    """Run one HF network step under a watchdog, retrying transient transport faults.

    Every bucket call goes through here, so an outage produces a *named* failure ("pull
    06403 failed after 3 attempts: ConnectError…") instead of a bare traceback or, worse,
    silence. Retries raise RuntimeError on give-up, which main() catches per campaign — one
    buoy's blip no longer takes the other two down with it.
    """
    with ui.watchdog(NET_TIMEOUT_S, label):
        t0 = time.perf_counter()
        for i in range(attempts):
            try:
                out = fn(*args, **kwargs)
                break
            except _TRANSIENT as e:
                if i == attempts - 1:
                    raise RuntimeError(
                        f"{label} failed after {attempts} attempts: {type(e).__name__}: {e}"
                    ) from e
                delay = 2.0**i
                ui.warn(f"{label}: {type(e).__name__}: {e} — retrying in {delay:.0f}s")
                time.sleep(delay)
    # A step that's merely slow (rather than hung) is the early warning for the next
    # outage — surface it instead of letting it hide inside the phase total.
    elapsed = time.perf_counter() - t0
    if elapsed >= 30:
        ui.warn(f"{label} was slow: {elapsed:.0f}s")
    return out


def resolve_token(repo: str) -> str | None:
    """Return an HF token: explicit env, else a CI OIDC exchange, else None (local login).

    On GitHub Actions with `permissions: id-token: write`, exchange the job's OIDC
    identity for a short-lived, bucket-scoped Hub token (Trusted Publishers) — no
    stored secret. Locally, return None so huggingface_hub uses the cached `hf` login.
    """
    if os.environ.get("HF_TOKEN"):
        return os.environ["HF_TOKEN"]
    req_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
    req_tok = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not (req_url and req_tok):
        return None  # not in GitHub Actions → fall back to the local login
    resource = f"buckets/{repo}"
    id_token = (
        httpx.get(
            f"{req_url}&audience={HF_AUD}",
            headers={"Authorization": f"Bearer {req_tok}"},
            timeout=30,
        )
        .raise_for_status()
        .json()["value"]
    )
    resp = _post_with_retry(
        f"{HF_AUD}/oauth/token",
        timeout=30,
        json={
            "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
            "subject_token_type": "urn:ietf:params:oauth:token-type:id_token",
            "subject_token": id_token,
            "resource": resource,
        },
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"OIDC token exchange failed ({resp.status_code}): {resp.text}"
        )
    ui.detail(f"authenticated to {resource} via OIDC trusted publisher")
    return resp.json()["access_token"]


# --------------------------------------------------------------------- pull/push


def _raw_dir(work: Path, campaign: str) -> Path:
    return work / campaign / "raw"


def _data_dir(work: Path, campaign: str) -> Path:
    return work / campaign / "data"


def _tides_root(work: Path) -> Path:
    """Shared, port-keyed tide root: hfdata/tides/<port>/{raw,data} (specs/0008 §8.2)."""
    return work / "tides"


def _wind_root(work: Path) -> Path:
    """Shared, station-keyed wind root: hfdata/wind/<station>/{raw,data} (specs/0012 §2.4)."""
    return work / "wind"


def _buoy_prefix(campaign: str) -> str:
    """Bucket key prefix for a buoy's data: `buoys/<campaign>` (spec 0009) — symmetric with
    the port-keyed `tides/<port>` root. The local working mirror stays `hfdata/<campaign>`;
    only the bucket layout nests under `buoys/`."""
    return f"buoys/{campaign}"


def _truncated_archives(raw: Path) -> list[Path]:
    """Archive files a previous run left empty (0 bytes) — a pull killed mid-download.

    These used to be permanent: pull() skipped the archive sync whenever *any* *_arch.csv
    existed, so the empty file was never re-fetched, and every later run died in polars on
    a bare `NoDataError: empty CSV` naming neither the file nor the fix. Detect them so the
    mirror heals itself instead.
    """
    return [f for f in sorted(raw.glob("*_arch.csv")) if f.stat().st_size == 0]


def pull(work: Path, campaign: str, repo: str, token: str | None) -> None:
    """Mirror the bucket's raw inputs locally: reel always (small), archive if absent/damaged."""
    from huggingface_hub import sync_bucket

    raw = _raw_dir(work, campaign)
    raw.mkdir(parents=True, exist_ok=True)
    src = f"hf://buckets/{repo}/{_buoy_prefix(campaign)}/raw"
    # The forward-growing reel changes every run → always pull the freshest copy (HF
    # canonical) so a local run can't regress what the cron advanced.
    sync_bucket(src, str(raw), include=["*_reel.csv"], token=token, quiet=True)
    truncated = _truncated_archives(raw)
    for f in truncated:
        ui.warn(f"{f.name} is empty (truncated download) — re-fetching")
        f.unlink()
    # The archive is immutable → pull only if we don't already have it (CI caches it). But
    # re-sync whenever we just dropped a truncated file: "some *_arch.csv exists" is not
    # "the archive is complete", and skipping here would silently leave those years out of
    # the build — a *quieter* bug than the crash it replaced.
    if truncated or not list(raw.glob("*_arch.csv")):
        sync_bucket(src, str(raw), include=["*_arch.csv"], token=token, quiet=True)
    n_arch = len(list(raw.glob("*_arch.csv")))
    n_reel = len(list(raw.glob("*_reel.csv")))
    ui.detail(f"pulled raw: {n_arch} archive + {n_reel} reel file(s) → {raw}")


def pull_tides(work: Path, port_id: str, repo: str, token: str | None) -> None:
    """Mirror a port's forward-growing tide accumulator locally (freshest copy wins).

    First run for a port has no remote prefix yet → tolerate the miss and build from
    scratch (the refresh re-fetches J±30 anyway).
    """
    from huggingface_hub import sync_bucket

    dst = _tides_root(work) / port_id / "raw"
    dst.mkdir(parents=True, exist_ok=True)
    try:
        sync_bucket(
            f"hf://buckets/{repo}/tides/{port_id}/raw",
            str(dst),
            include=["extrema.csv"],
            token=token,
            quiet=True,
        )
    except Exception as e:  # noqa: BLE001 — missing prefix / transient: non-fatal
        ui.detail(f"no remote accumulator for {port_id} yet ({e})")


def upload(work: Path, campaign: str, repo: str, token: str | None) -> None:
    """Push the rebuilt tiers + the updated accumulator (sync diffs, only changed files).

    sync_bucket compares size+mtime, so the immutable year parquets and an unchanged
    reel are skipped — only modified files are sent. `include` restricts the sync to the
    tiers + the reel; the immutable *_arch.csv is never matched, and `delete` stays off
    so nothing else in the campaign prefix (archive, backups) is touched.
    """
    from huggingface_hub import sync_bucket

    sync_bucket(
        str(work / campaign),
        f"hf://buckets/{repo}/{_buoy_prefix(campaign)}",
        include=["data/**", "raw/*_reel.csv"],  # never the immutable archive
        token=token,
        quiet=True,
    )
    ui.detail(
        f"uploaded {_buoy_prefix(campaign)}/{{data, raw/*_reel.csv}} → buckets/{repo}"
    )


def upload_tides(work: Path, port_id: str, repo: str, token: str | None) -> None:
    """Push a port's tide tier + accumulator to the shared tides/<port>/ prefix."""
    from huggingface_hub import sync_bucket

    sync_bucket(
        str(_tides_root(work) / port_id),
        f"hf://buckets/{repo}/tides/{port_id}",
        include=["data/**", "raw/extrema.csv"],
        token=token,
        quiet=True,
    )
    ui.detail(f"uploaded tides/{port_id}/data + raw/extrema.csv → buckets/{repo}")


# Buckets are non-versioned (overwrite-in-place), so a buggy run that corrupts the
# forward-only reel has no rollback. Keep a bounded set of dated recovery points.
REEL_BACKUP_RETENTION_DAYS = 14


def snapshot_reel(work: Path, campaign: str, repo: str, token: str | None) -> None:
    """Once per UTC day, copy the current reel to a dated backup key; prune old ones.

    Gives point-in-time recovery for the forward-only accumulator that an overwrite-in-
    place bucket can't otherwise provide. Backups live under `<campaign>/backup/<date>/`
    and are pruned beyond REEL_BACKUP_RETENTION_DAYS (lexicographic date compare).
    """
    from datetime import datetime, timedelta, timezone

    from huggingface_hub import HfFileSystem, batch_bucket_files

    reels = sorted(_raw_dir(work, campaign).glob("*_reel.csv"))
    if not reels:
        return
    prefix = f"{_buoy_prefix(campaign)}/backup"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    fs = HfFileSystem(token=token)

    def dates() -> list[str]:
        try:
            return [
                p.rsplit("/", 1)[-1]
                for p in fs.ls(f"buckets/{repo}/{prefix}", detail=False, refresh=True)
            ]
        except FileNotFoundError:
            return []

    if today not in dates():
        batch_bucket_files(
            repo,
            add=[(str(r), f"{prefix}/{today}/{r.name}") for r in reels],
            token=token,
        )
        ui.detail(f"snapshot {campaign} reel → {prefix}/{today}/")

    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=REEL_BACKUP_RETENTION_DAYS)
    ).strftime("%Y-%m-%d")
    stale = [d for d in dates() if d < cutoff]
    victims: list[str] = []
    for d in stale:
        try:
            victims += [
                f"{prefix}/{d}/{p.rsplit('/', 1)[-1]}"
                for p in fs.ls(
                    f"buckets/{repo}/{prefix}/{d}", detail=False, refresh=True
                )
            ]
        except FileNotFoundError:
            pass
    if victims:
        batch_bucket_files(repo, delete=victims, token=token)
        ui.detail(
            f"pruned {len(stale)} reel snapshot(s) older than {REEL_BACKUP_RETENTION_DAYS}d"
        )


# --------------------------------------------------------------------------- run


def update(
    campaign: str = CAMPAIGN_ID,
    repo: str = DEFAULT_REPO,
    work: Path = Path("hfdata"),
    *,
    do_pull: bool = True,
    do_scrape: bool = True,
    do_tides: bool = True,
    force_tides: bool = False,
    do_wind: bool = True,
    do_upload: bool = True,
    seed_src: Path | None = None,
    token=_RESOLVE_TOKEN,
) -> dict:
    """Refresh one buoy. Returns a small summary dict (for the end-of-run tables)."""
    raw = _raw_dir(work, campaign)
    data = _data_dir(work, campaign)
    if token is _RESOLVE_TOKEN:
        token = resolve_token(repo) if (do_pull or do_upload) else None

    meta = buoy(campaign)
    # Resolve this buoy's nearest tide port once (shared, port-keyed storage — specs/0008
    # §8.2). None → the buoy has no port within range → build writes tide: null.
    tide_port = resolve_tide_port(campaign) if do_tides else None
    # Resolve this buoy's nearest wind station (shared, station-keyed storage -- specs/0012
    # §2.4). None -> the buoy has no station within range -> the wind step is skipped.
    wind_station = resolve_wind_station(campaign) if do_wind else None
    result: dict = {
        "campaign": campaign,
        "name": meta["name"],
        "rows": None,
        "through": "—",
        "uploaded": do_upload,
        "tide": None,
        "wind": None,
    }

    # Each buoy is its own titled section; buoy steps read cyan, the tide step reads blue,
    # so the two kinds of work never blur together (spec 0009).
    with ui.phase(ui.ICON_BUOY, meta["name"], f"campaign {campaign}", style=ui.BUOY):
        # --- input: seed once, else pull the accumulator from the bucket ---
        if seed_src is not None:
            import shutil

            ui.step(ui.ICON_SEED, "seed")
            raw.mkdir(parents=True, exist_ok=True)
            for csv in sorted(Path(seed_src).glob(f"Candhis_{campaign}_*.csv")):
                shutil.copy2(csv, raw / csv.name)
            ui.detail(
                f"seeded {len(list(raw.glob('*.csv')))} raw file(s) from {seed_src}"
            )
        elif do_pull:
            ui.step(ui.ICON_PULL, "pull")
            _net(f"pull {campaign}", pull, work, campaign, repo, token)

        # --- scrape the live CANDHIS feed into the reel accumulator ---
        if do_scrape:
            ui.step(ui.ICON_SCRAPE, "scrape")
            scrape_mod.scrape(raw, campaign)

        # --- tides (distinct blue step): refresh the buoy's nearest port ---
        if do_tides and tide_port is not None:
            ui.step(ui.ICON_TIDE, f"tide · {tide_port['id']}", style=ui.TIDE)
            # Ingest-only: the key never reaches the webapp, which reads the derived
            # tides.parquet. A failure is non-fatal (logged, existing accumulator kept).
            if do_pull:
                _net(
                    f"pull tides {tide_port['id']}",
                    pull_tides,
                    work,
                    tide_port["id"],
                    repo,
                    token,
                )
            status = tides_mod.refresh_port(
                _tides_root(work),
                tide_port["id"],
                os.environ.get(tides_mod.ENV_KEY),
                force=force_tides,
            )
            result["tide"] = {
                "port": tide_port["id"],
                "distance": tide_port["distance_km"],
                "status": status,
            }
        elif do_tides:
            ui.step(ui.ICON_TIDE, "tide", style=ui.TIDE)
            ui.detail(f"{campaign} has no port within range → skip", style=ui.TIDE)
            result["tide"] = {
                "port": None,
                "distance": None,
                "status": "no port in range",
            }

        # --- wind (distinct magenta step): scrape the 6-min feed → append → rebuild tiers ---
        # The hourly history is a one-shot seed (`pixi run wind --seed`); from then on the record
        # grows only from the 6-min live feed, so the cron just scrapes + rebuilds — no bulk
        # re-download. Non-fatal like the tide step. (specs/0012 §3)
        if do_wind and wind_station is not None:
            sid = wind_station["id"]
            ui.step(ui.ICON_WIND, f"wind · {sid}", style=ui.WIND)
            wroot = _wind_root(work)
            key = os.environ.get(wind_mod.ENV_KEY)
            try:
                if do_pull:
                    wind_mod.pull_wind(wroot, sid, repo, token)
                if key:
                    # Not just "the last few minutes": the scrape re-probes the fresh tail AND
                    # refills any 6-min hole left in the last 24 h, so a pipeline outage that
                    # ends before DPObs drops those points self-heals (specs/0012 §3.1).
                    n_live, n_heal = wind_mod.scrape_live(wroot, sid, key)
                    status = f"live +{n_live}" + (
                        f" ·healed {n_heal}" if n_heal else ""
                    )
                else:
                    ui.detail(
                        f"no {wind_mod.ENV_KEY} → 6-min live skipped", style=ui.WIND
                    )
                    status = "no key"
                wind_mod.build_station(wroot, sid)
            except (wind_mod.WindError, RuntimeError) as e:
                ui.warn(f"wind failed ({e}) → keep existing")
                status = "failed"
            result["wind"] = {
                "station": sid,
                "distance": wind_station["distance_km"],
                "status": status,
            }
        elif do_wind:
            ui.step(ui.ICON_WIND, "wind", style=ui.WIND)
            ui.detail(f"{campaign} has no station within range → skip", style=ui.WIND)
            result["wind"] = {
                "station": None,
                "distance": None,
                "status": "no station in range",
            }

        # --- build the tiered Parquet/JSON the webapp reads ---
        ui.step(ui.ICON_BUILD, "build")
        build_mod.build(raw, data, campaign)

        # --- upload the tiers + accumulator back to the bucket ---
        if do_upload:
            ui.step(ui.ICON_UPLOAD, "upload")
            # When seeding, push the archive too (first time only); otherwise reel-only.
            if seed_src is not None:
                from huggingface_hub import sync_bucket

                _net(
                    f"seed {campaign}/raw",
                    sync_bucket,
                    str(raw),
                    f"hf://buckets/{repo}/{_buoy_prefix(campaign)}/raw",
                    token=token,
                    quiet=True,
                )
                ui.detail(
                    f"seeded {_buoy_prefix(campaign)}/raw (archive + reel) → buckets/{repo}"
                )
            _net(f"upload {campaign}", upload, work, campaign, repo, token)
            if tide_port is not None:
                _net(
                    f"upload tides {tide_port['id']}",
                    upload_tides,
                    work,
                    tide_port["id"],
                    repo,
                    token,
                )
            if do_wind and wind_station is not None:
                _net(
                    f"upload wind {wind_station['id']}",
                    wind_mod.upload_wind,
                    _wind_root(work),
                    wind_station["id"],
                    repo,
                    token,
                )
            _net(f"snapshot {campaign}", snapshot_reel, work, campaign, repo, token)

    # Summary facts, read back from the freshly-written manifest (decoupled from build()).
    try:
        mf = json.loads((data / "manifest.json").read_text())
        result["rows"] = mf.get("rows")
        end = (mf.get("span") or {}).get("end", "")
        result["through"] = end[:10] if end else "—"
    except (OSError, ValueError):
        pass
    return result


def _summaries(results: list[dict]) -> None:
    """Buoy, tide and wind end-of-run tables, kept visually separate (specs 0009/0012)."""
    ui.summary_table(
        "Buoys",
        ["campaign", "buoy", "rows", "through", "uploaded"],
        [
            [
                r["campaign"],
                r["name"],
                f"{r['rows']:,}" if r["rows"] is not None else "—",
                r["through"],
                "✓" if r["uploaded"] else "—",
            ]
            for r in results
        ],
        style=ui.BUOY,
    )
    ui.summary_table(
        "Tides",
        ["port", "buoy", "distance", "status"],
        [
            [
                r["tide"]["port"] or "—",
                r["name"],
                f"{r['tide']['distance']} km"
                if r["tide"]["distance"] is not None
                else "—",
                r["tide"]["status"],
            ]
            for r in results
            if r["tide"]
        ],
        style=ui.TIDE,
    )
    ui.summary_table(
        "Wind",
        ["station", "buoy", "distance", "status"],
        [
            [
                r["wind"]["station"] or "—",
                r["name"],
                f"{r['wind']['distance']} km"
                if r["wind"]["distance"] is not None
                else "—",
                r["wind"]["status"],
            ]
            for r in results
            if r["wind"]
        ],
        style=ui.WIND,
    )


def main(
    campaign: Annotated[
        list[str] | None,
        typer.Option(
            "--campaign",
            "-c",
            help="CANDHIS campaign id(s). Repeat to refresh several buoys in one run "
            "(one shared OIDC exchange), e.g. -c 06403 -c 06402. Default: 06403.",
        ),
    ] = None,
    repo: Annotated[str, typer.Option(help="HF bucket id.")] = DEFAULT_REPO,
    work: Annotated[Path, typer.Option(help="Local working mirror.")] = Path("hfdata"),
    no_pull: Annotated[
        bool, typer.Option("--no-pull", help="Skip pulling raw inputs from the bucket.")
    ] = False,
    no_scrape: Annotated[
        bool,
        typer.Option(
            "--no-scrape", help="Skip the live scrape (just rebuild + upload)."
        ),
    ] = False,
    no_tides: Annotated[
        bool, typer.Option("--no-tides", help="Skip the tide refresh (api-maree.fr).")
    ] = False,
    force_tides: Annotated[
        bool,
        typer.Option(
            "--force-tides",
            help="Fetch tides even if the horizon gate would skip (tier schema changes).",
        ),
    ] = False,
    no_wind: Annotated[
        bool,
        typer.Option("--no-wind", help="Skip the wind refresh (Météo-France)."),
    ] = False,
    no_upload: Annotated[
        bool, typer.Option("--no-upload", help="Build locally without uploading.")
    ] = False,
    seed_src: Annotated[
        Path | None,
        typer.Option(
            "--seed-src",
            help="One-time: take raw CSVs from this local dir and upload the archive too.",
        ),
    ] = None,
) -> None:
    """Refresh Olatu data: pull → scrape → tides → wind → build → upload to the HF bucket."""
    campaigns = campaign or [CAMPAIGN_ID]
    do_pull, do_upload = not no_pull, not no_upload

    ui.banner(
        f"pull → scrape → tides → wind → build → upload   ·   {', '.join(campaigns)}"
    )

    # Resolve the HF token ONCE and share it across campaigns: every buoy is a path in
    # the same bucket, so one OIDC exchange authorizes them all (the every-30-min cron
    # otherwise made 3 exchanges/run and occasionally tripped HF's 429 rate limit).
    try:
        token = _net("auth", resolve_token, repo) if (do_pull or do_upload) else None
    except RuntimeError as e:
        ui.err(f"update aborted: {e}")
        raise typer.Exit(1)

    # One grep-able line of run context. When a refresh misbehaves this is the first thing
    # you want from the log: which client talked to which bucket, with which credential,
    # under which timeout — so an HF-side outage can't be mistaken for a code change.
    import huggingface_hub as hf

    auth = (
        "HF_TOKEN env"
        if os.environ.get("HF_TOKEN")
        else "OIDC"
        if token
        else "local hf login"
    )
    tide_key = "set" if os.environ.get(tides_mod.ENV_KEY) else "MISSING"
    wind_key = "set" if os.environ.get(wind_mod.ENV_KEY) else "MISSING"
    ui.detail(
        f"bucket {repo} · huggingface_hub {hf.__version__} · auth {auth} · "
        f"{tides_mod.ENV_KEY} {tide_key} · {wind_mod.ENV_KEY} {wind_key} · "
        f"net timeout {NET_TIMEOUT_S:.0f}s"
    )

    # Refresh each buoy independently: one buoy's failure (e.g. its CANDHIS feed is
    # down) must not skip the others, but the run as a whole still reports failure.
    results: list[dict] = []
    failed: list[str] = []
    for c in campaigns:
        try:
            results.append(
                update(
                    campaign=c,
                    repo=repo,
                    work=work,
                    do_pull=do_pull,
                    do_scrape=not no_scrape,
                    do_tides=not no_tides,
                    force_tides=force_tides,
                    do_wind=not no_wind,
                    do_upload=do_upload,
                    seed_src=seed_src,
                    token=token,
                )
            )
        except (scrape_mod.ScrapeError, RuntimeError) as e:
            ui.err(f"{c}: {e}")
            failed.append(c)

    _summaries(results)

    if failed:
        ui.err(f"done with failures: {', '.join(failed)}")
        raise typer.Exit(1)
    ui.ok("all done")


if __name__ == "__main__":
    typer.run(main)

"""End-to-end data refresh: pull → scrape → build → upload, with the HF bucket as
the single source of truth.

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
in CI (GitHub Actions OIDC trusted publisher — no stored token). Each run:

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
from .schema import CAMPAIGN_ID, buoy, resolve_tide_port

DEFAULT_REPO = "hadim/olatu"  # HF bucket id
HF_AUD = "https://huggingface.co"

# HF rate-limits bursts of OIDC token exchanges (the every-30-min cron occasionally
# trips a 429); unlike huggingface_hub's own calls, our raw httpx exchange has no
# retry, so a single transient blip aborts the whole run. Back off and retry.
_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})

# Sentinel: lets update() resolve its own token (library use) while main() resolves
# once and shares it across campaigns (one OIDC exchange per run, not one per buoy).
_RESOLVE_TOKEN = object()


# ------------------------------------------------------------------------ auth


def _post_with_retry(url: str, *, attempts: int = 5, **kwargs) -> httpx.Response:
    """POST, retrying transient 429/5xx with Retry-After-aware exponential backoff."""
    resp = httpx.post(url, **kwargs)
    for i in range(attempts - 1):
        if resp.status_code not in _RETRY_STATUS:
            return resp
        retry_after = resp.headers.get("retry-after", "")
        delay = float(retry_after) if retry_after.isdigit() else 2.0**i
        ui.warn(f"HF returned {resp.status_code}; retrying in {delay:.0f}s")
        time.sleep(delay)
        resp = httpx.post(url, **kwargs)
    return resp


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


def _buoy_prefix(campaign: str) -> str:
    """Bucket key prefix for a buoy's data: `buoys/<campaign>` (spec 0009) — symmetric with
    the port-keyed `tides/<port>` root. The local working mirror stays `hfdata/<campaign>`;
    only the bucket layout nests under `buoys/`."""
    return f"buoys/{campaign}"


def pull(work: Path, campaign: str, repo: str, token: str | None) -> None:
    """Mirror the bucket's raw inputs locally: reel always (small), archive if absent."""
    from huggingface_hub import sync_bucket

    raw = _raw_dir(work, campaign)
    raw.mkdir(parents=True, exist_ok=True)
    src = f"hf://buckets/{repo}/{_buoy_prefix(campaign)}/raw"
    # The forward-growing reel changes every run → always pull the freshest copy (HF
    # canonical) so a local run can't regress what the cron advanced.
    sync_bucket(src, str(raw), include=["*_reel.csv"], token=token, quiet=True)
    # The archive is immutable → pull only if we don't already have it (CI caches it).
    if not list(raw.glob("*_arch.csv")):
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
    result: dict = {
        "campaign": campaign,
        "name": meta["name"],
        "rows": None,
        "through": "—",
        "uploaded": do_upload,
        "tide": None,
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
            pull(work, campaign, repo, token)

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
                pull_tides(work, tide_port["id"], repo, token)
            status = tides_mod.refresh_port(
                _tides_root(work), tide_port["id"], os.environ.get(tides_mod.ENV_KEY)
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

        # --- build the tiered Parquet/JSON the webapp reads ---
        ui.step(ui.ICON_BUILD, "build")
        build_mod.build(raw, data, campaign)

        # --- upload the tiers + accumulator back to the bucket ---
        if do_upload:
            ui.step(ui.ICON_UPLOAD, "upload")
            # When seeding, push the archive too (first time only); otherwise reel-only.
            if seed_src is not None:
                from huggingface_hub import sync_bucket

                sync_bucket(
                    str(raw),
                    f"hf://buckets/{repo}/{_buoy_prefix(campaign)}/raw",
                    token=token,
                    quiet=True,
                )
                ui.detail(
                    f"seeded {_buoy_prefix(campaign)}/raw (archive + reel) → buckets/{repo}"
                )
            upload(work, campaign, repo, token)
            if tide_port is not None:
                upload_tides(work, tide_port["id"], repo, token)
            snapshot_reel(work, campaign, repo, token)

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
    """Two end-of-run tables, buoys and tides kept separate (spec 0009)."""
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
    """Refresh Olatu data: pull → scrape → tides → build → upload to the HF bucket."""
    campaigns = campaign or [CAMPAIGN_ID]
    do_pull, do_upload = not no_pull, not no_upload

    ui.banner(f"pull → scrape → tides → build → upload   ·   {', '.join(campaigns)}")

    # Resolve the HF token ONCE and share it across campaigns: every buoy is a path in
    # the same bucket, so one OIDC exchange authorizes them all (the every-30-min cron
    # otherwise made 3 exchanges/run and occasionally tripped HF's 429 rate limit).
    try:
        token = resolve_token(repo) if (do_pull or do_upload) else None
    except RuntimeError as e:
        ui.err(f"update aborted: {e}")
        raise typer.Exit(1)

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

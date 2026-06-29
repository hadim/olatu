"""End-to-end data refresh: pull → scrape → build → upload, with the HF dataset as
the single source of truth.

The data no longer lives in git. It lives in the Hugging Face **dataset**
`hadim/olatu`, laid out per campaign so it is multi-buoy ready:

    <campaign>/raw/Candhis_<campaign>_<YEAR>_arch.csv   immutable archive (seeded once)
    <campaign>/raw/Candhis_<campaign>_<YEAR>_reel.csv   the growing realtime accumulator
    <campaign>/data/manifest.json | latest.json | recent.json | year/*.parquet | hourly/daily.parquet
                                                       the tiers the webapp fetches at runtime

Why a dataset (not a bucket): the webapp is a static browser app and needs public
HTTPS + CORS (+ range) to read the tiers; dataset `resolve/main/...` URLs provide
that, buckets do not (yet). See specs/2026-06-27-0004-realtime-scraper.md §6.

This orchestrator runs the same locally (`pixi run update`, your stored HF login) and
in CI (GitHub Actions OIDC trusted publisher — no stored token). Each run:

  1. pull the realtime accumulator (always) + archive (only if missing) from the dataset
     into a local working mirror (`./hfdata/<campaign>/raw`),
  2. scrape the live CANDHIS feed and coalesce-merge it into the accumulator,
  3. build the tiers into `./hfdata/<campaign>/data`,
  4. upload the tiers + the updated accumulator back to the dataset.

HF is canonical, so pulling before scraping means a local run can never regress the
forward-growing series the cron has already advanced.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import httpx

from . import build as build_mod
from . import scrape as scrape_mod
from .schema import CAMPAIGN_ID

DEFAULT_REPO = "hadim/olatu"  # HF dataset id
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
        print(
            f"  HF returned {resp.status_code}; retrying in {delay:.0f}s",
            file=sys.stderr,
        )
        time.sleep(delay)
        resp = httpx.post(url, **kwargs)
    return resp


def resolve_token(repo: str) -> str | None:
    """Return an HF token: explicit env, else a CI OIDC exchange, else None (local login).

    On GitHub Actions with `permissions: id-token: write`, exchange the job's OIDC
    identity for a short-lived, dataset-scoped Hub token (Trusted Publishers) — no
    stored secret. Locally, return None so huggingface_hub uses the cached `hf` login.
    """
    if os.environ.get("HF_TOKEN"):
        return os.environ["HF_TOKEN"]
    req_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
    req_tok = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not (req_url and req_tok):
        return None  # not in GitHub Actions → fall back to the local login
    resource = f"datasets/{repo}"
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
    print(f"  authenticated to {resource} via OIDC trusted publisher")
    return resp.json()["access_token"]


# --------------------------------------------------------------------- pull/push


def _raw_dir(work: Path, campaign: str) -> Path:
    return work / campaign / "raw"


def _data_dir(work: Path, campaign: str) -> Path:
    return work / campaign / "data"


def pull(work: Path, campaign: str, repo: str, token: str | None) -> None:
    """Mirror the dataset's raw inputs locally: reel always (small), archive if absent."""
    from huggingface_hub import snapshot_download

    raw = _raw_dir(work, campaign)
    raw.mkdir(parents=True, exist_ok=True)
    # The accumulator changes every run → always pull the freshest copy (HF canonical).
    snapshot_download(
        repo_id=repo,
        repo_type="dataset",
        allow_patterns=[f"{campaign}/raw/*_reel.csv"],
        local_dir=str(work),
        token=token,
    )
    # The archive is immutable → pull only if we don't already have it (CI caches it).
    if not list(raw.glob("*_arch.csv")):
        snapshot_download(
            repo_id=repo,
            repo_type="dataset",
            allow_patterns=[f"{campaign}/raw/*_arch.csv"],
            local_dir=str(work),
            token=token,
        )
    n_arch = len(list(raw.glob("*_arch.csv")))
    n_reel = len(list(raw.glob("*_reel.csv")))
    print(f"  pulled raw: {n_arch} archive + {n_reel} reel file(s) -> {raw}")


def upload(work: Path, campaign: str, repo: str, token: str | None) -> None:
    """Push the rebuilt tiers + the updated accumulator back in ONE commit per campaign.

    upload_folder diffs against the remote, so the immutable year parquets and an
    unchanged reel are skipped (only modified files are sent). Uploading data/ and
    raw/*_reel.csv together — instead of two separate upload_folder calls — halves the
    HF commits/round-trips per buoy. The immutable *_arch.csv is never matched.
    """
    from huggingface_hub import HfApi

    HfApi(token=token).upload_folder(
        repo_id=repo,
        repo_type="dataset",
        folder_path=str(work / campaign),
        path_in_repo=campaign,
        allow_patterns=["data/**", "raw/*_reel.csv"],  # never the immutable archive
        commit_message=f"data: refresh {campaign} (tiers + realtime tail)",
    )
    print(f"  uploaded {campaign}/data + {campaign}/raw/*_reel.csv to datasets/{repo}")


# --------------------------------------------------------------------------- run


def update(
    campaign: str = CAMPAIGN_ID,
    repo: str = DEFAULT_REPO,
    work: Path = Path("hfdata"),
    *,
    do_pull: bool = True,
    do_scrape: bool = True,
    do_upload: bool = True,
    seed_src: Path | None = None,
    token=_RESOLVE_TOKEN,
) -> None:
    raw = _raw_dir(work, campaign)
    data = _data_dir(work, campaign)
    if token is _RESOLVE_TOKEN:
        token = resolve_token(repo) if (do_pull or do_upload) else None

    if seed_src is not None:
        # One-time seed: take raw inputs from a local directory instead of HF.
        import shutil

        raw.mkdir(parents=True, exist_ok=True)
        for csv in sorted(Path(seed_src).glob(f"Candhis_{campaign}_*.csv")):
            shutil.copy2(csv, raw / csv.name)
        print(f"  seeded {len(list(raw.glob('*.csv')))} raw file(s) from {seed_src}")
    elif do_pull:
        pull(work, campaign, repo, token)

    if do_scrape:
        scrape_mod.scrape(raw, campaign)

    build_mod.build(raw, data, campaign)

    if do_upload:
        # When seeding, push the archive too (first time only); otherwise reel-only.
        if seed_src is not None:
            from huggingface_hub import HfApi

            HfApi(token=token).upload_folder(
                repo_id=repo,
                repo_type="dataset",
                folder_path=str(raw),
                path_in_repo=f"{campaign}/raw",
                commit_message=f"data: seed {campaign} raw (archive + reel)",
            )
            print(f"  seeded {campaign}/raw (archive + reel) to datasets/{repo}")
        upload(work, campaign, repo, token)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Refresh Olatu data: pull → scrape → build → upload to the HF dataset."
    )
    p.add_argument(
        "--campaign",
        nargs="+",
        default=[CAMPAIGN_ID],
        help="CANDHIS campaign id(s); pass several to refresh every buoy in one run "
        "(one shared OIDC exchange). Default: 06403",
    )
    p.add_argument(
        "--repo", default=DEFAULT_REPO, help="HF dataset id (default: hadim/olatu)"
    )
    p.add_argument(
        "--work",
        type=Path,
        default=Path("hfdata"),
        help="Local working mirror (default: ./hfdata)",
    )
    p.add_argument(
        "--no-pull",
        action="store_true",
        help="Skip pulling raw inputs from the dataset",
    )
    p.add_argument(
        "--no-scrape",
        action="store_true",
        help="Skip the live scrape (just rebuild + upload)",
    )
    p.add_argument(
        "--no-upload", action="store_true", help="Build locally without uploading"
    )
    p.add_argument(
        "--seed-src",
        type=Path,
        default=None,
        help="One-time: take raw CSVs from this local dir (e.g. /Users/hadim/Data/olatu/06403) and upload the archive too",
    )
    args = p.parse_args()
    do_pull, do_upload = not args.no_pull, not args.no_upload

    # Resolve the HF token ONCE and share it across campaigns: every buoy is a path in
    # the same dataset, so one OIDC exchange authorizes them all (the every-30-min cron
    # otherwise made 3 exchanges/run and occasionally tripped HF's 429 rate limit).
    try:
        token = resolve_token(args.repo) if (do_pull or do_upload) else None
    except RuntimeError as e:
        print(f"update aborted: {e}", file=sys.stderr)
        sys.exit(1)

    # Refresh each buoy independently: one buoy's failure (e.g. its CANDHIS feed is
    # down) must not skip the others, but the run as a whole still reports failure.
    failed: list[str] = []
    for campaign in args.campaign:
        try:
            update(
                campaign=campaign,
                repo=args.repo,
                work=args.work,
                do_pull=do_pull,
                do_scrape=not args.no_scrape,
                do_upload=do_upload,
                seed_src=args.seed_src,
                token=token,
            )
        except (scrape_mod.ScrapeError, RuntimeError) as e:
            print(f"update aborted for {campaign}: {e}", file=sys.stderr)
            failed.append(campaign)

    if failed:
        print(f"done with failures: {', '.join(failed)}", file=sys.stderr)
        sys.exit(1)
    print("done")


if __name__ == "__main__":
    main()

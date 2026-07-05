"""One-shot: migrate the bucket buoy layout from `<campaign>/` to `buoys/<campaign>/` (spec 0009).

Buoy data moves off the bucket root (`06403/`, `06402/`, `03302/`) under a `buoys/` root so it
is symmetric with the already-nested, port-keyed `tides/<port>/` root. Two-phase and
**non-destructive by default** so the live site never breaks mid-flight:

    pixi run migrate copy      download each old <campaign>/ prefix and re-upload it to
                               buoys/<campaign>/ (raw + data + backup). The OLD prefix is
                               left untouched, so the currently-deployed webapp keeps
                               reading it until it redeploys to read buoys/.
    pixi run migrate delete    AFTER the redeployed site is confirmed reading buoys/, remove
                   --yes       the old root prefixes. Without --yes it's a dry-run listing.

Sequence: `copy` → flip code (already done) → deploy → verify the live site on buoys/ →
`delete --yes`. Uses your local `hf` login (or HF_TOKEN). `copy` is idempotent — re-running
just re-syncs. The `tides/` root is never touched.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

from . import ui
from .schema import BUOYS
from .update import DEFAULT_REPO, resolve_token

app = typer.Typer(add_completion=False, help=__doc__)

_WORK = Path(
    "hfdata/.migrate"
)  # scratch mirror for the download→upload copy (gitignored)


@app.command()
def copy(
    campaign: Annotated[
        list[str] | None,
        typer.Option("--campaign", "-c", help="Campaign id(s); default: all buoys."),
    ] = None,
    repo: Annotated[str, typer.Option(help="HF bucket id.")] = DEFAULT_REPO,
) -> None:
    """Copy each old `<campaign>/` prefix to `buoys/<campaign>/` (non-destructive)."""
    from huggingface_hub import sync_bucket

    campaigns = campaign or list(BUOYS)
    token = resolve_token(repo)
    ui.banner(
        f"migrate layout · copy <campaign>/ → buoys/<campaign>/   ·   {', '.join(campaigns)}"
    )

    for c in campaigns:
        with ui.phase(ui.ICON_BUOY, c, "copy → buoys/"):
            local = _WORK / c
            local.mkdir(parents=True, exist_ok=True)
            ui.step(ui.ICON_PULL, "download old prefix")
            sync_bucket(f"hf://buckets/{repo}/{c}", str(local), token=token, quiet=True)
            n = sum(1 for p in local.rglob("*") if p.is_file())
            ui.detail(f"{n} files mirrored → {local}")
            if n == 0:
                ui.warn(f"nothing under {c}/ on the bucket — skipping upload")
                continue
            ui.step(ui.ICON_UPLOAD, "upload to buoys/")
            sync_bucket(
                str(local), f"hf://buckets/{repo}/buoys/{c}", token=token, quiet=True
            )
            ui.detail(f"→ buckets/{repo}/buoys/{c}")

    ui.ok(
        "copy done — old prefixes untouched. Deploy, verify the site on buoys/, then `delete --yes`."
    )


@app.command()
def delete(
    campaign: Annotated[
        list[str] | None,
        typer.Option("--campaign", "-c", help="Campaign id(s); default: all buoys."),
    ] = None,
    repo: Annotated[str, typer.Option(help="HF bucket id.")] = DEFAULT_REPO,
    yes: Annotated[
        bool, typer.Option("--yes", help="Actually delete (default: dry-run listing).")
    ] = False,
) -> None:
    """Delete the OLD root `<campaign>/` prefixes (run only after the site reads buoys/)."""
    from huggingface_hub import HfFileSystem

    campaigns = campaign or list(BUOYS)
    token = resolve_token(repo)
    fs = HfFileSystem(token=token)
    ui.banner(
        f"migrate layout · delete old <campaign>/ prefixes   ·   {', '.join(campaigns)}"
    )

    for c in campaigns:
        base = f"buckets/{repo}/{c}"  # root-level, never buoys/… or tides/…
        with ui.phase(ui.ICON_BACKUP, c, "delete old prefix", style=ui.TIDE):
            if not fs.exists(base):
                ui.detail(f"{c}/ not present → nothing to delete")
                continue
            files = fs.find(base)
            ui.detail(f"{len(files)} object(s) under {c}/")
            if not yes:
                ui.warn("dry-run — pass --yes to delete")
                continue
            fs.rm(base, recursive=True)
            ui.detail(f"deleted {base}")

    ui.ok("delete done" if yes else "dry-run complete — re-run with --yes to delete")


if __name__ == "__main__":
    app()

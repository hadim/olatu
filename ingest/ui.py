"""Shared Rich console + small styled-output helpers for the ingest CLIs.

One `console` instance and a handful of semantic helpers (`section`, `step`, `detail`,
`ok`/`warn`/`err`, `summary_table`) give the whole data pipeline a consistent, legible
look — colours + icons so you can *see what's happening*, with **buoy** work and **tide**
work visually distinct (buoys in cyan, tides in blue). Dynamic values are passed as plain
text with a `style=` param (never inline `[markup]`), so a stray `[` in a path or list can
never be mis-parsed as markup.

Rich degrades gracefully with no TTY (GitHub Actions logs): colours drop to plain text,
nothing animates, output stays readable. Import as `from . import ui`.
"""

from __future__ import annotations

import faulthandler
import os
import sys
import threading
import time
from contextlib import contextmanager

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

# A single shared console. In a real terminal it renders colour + emoji; with no TTY (a
# GitHub Actions log, a pipe) Rich auto-drops colour and animation, leaving plain, grep-able
# text. We emit line output with soft_wrap=True (see helpers) so long paths/spans are never
# hard-wrapped at the non-terminal default 80 cols.
console = Console(highlight=False)


def _line(msg: str, style: str) -> None:
    """Emit one styled, non-wrapping log line (CI-safe)."""
    console.print(Text(msg, style=style), soft_wrap=True)


# Palette — buoys read cyan, tides read blue, wind reads magenta, so the kinds of work
# never blur together.
BUOY = "cyan"
TIDE = "blue"
WIND = "magenta"
_OK = "green"
_WARN = "yellow"
_ERR = "red"
_DIM = "grey50"

# Icons per concept (emoji degrade to their text in a plain terminal).
ICON_REFRESH = "🌊"
ICON_BUOY = "🛟"
ICON_TIDE = "🌙"
ICON_WIND = "💨"
ICON_PULL = "↓"
ICON_SCRAPE = "⟳"
ICON_BUILD = "⚙"
ICON_UPLOAD = "↑"
ICON_SEED = "🌱"
ICON_BACKUP = "🗄"


def banner(subtitle: str) -> None:
    """Top-of-run title card."""
    body = Text()
    body.append(f"{ICON_REFRESH}  ", style=TIDE)
    body.append("Olatu", style=f"bold {BUOY}")
    body.append("  ·  data refresh\n", style="bold")
    body.append(subtitle, style=_DIM)
    console.print(Panel(body, border_style=BUOY, expand=False, padding=(0, 2)))


def section(
    icon: str, title: str, subtitle: str | None = None, *, style: str = BUOY
) -> None:
    """A left-aligned rule opening a per-campaign (or per-port) section."""
    label = Text()
    label.append(f"{icon}  ", style=style)
    label.append(title, style=f"bold {style}")
    if subtitle:
        label.append(f"   {subtitle}", style=_DIM)
    console.print()
    console.rule(label, style=style, align="left")


def step(icon: str, label: str, *, style: str = BUOY) -> None:
    """A step header (pull / scrape / tide / build / upload); details follow via detail()."""
    line = Text()
    line.append(f"  {icon} ", style=style)
    line.append(label, style=f"bold {style}")
    console.print(line, soft_wrap=True)


def detail(msg: str, *, style: str = _DIM) -> None:
    """An indented detail line under the current step."""
    _line(f"      {msg}", style)


def ok(msg: str) -> None:
    _line(f"  ✓ {msg}", _OK)


def warn(msg: str) -> None:
    _line(f"  ! {msg}", _WARN)


def err(msg: str) -> None:
    _line(f"  ✗ {msg}", _ERR)


@contextmanager
def phase(icon: str, title: str, subtitle: str | None = None, *, style: str = BUOY):
    """Wrap a campaign: open a section, then close with a green ✓ + elapsed (or red ✗)."""
    section(icon, title, subtitle, style=style)
    t0 = time.perf_counter()
    try:
        yield
    except BaseException:
        console.print(Text(f"  ✗ {title} failed", style=_ERR))
        raise
    else:
        ok(f"{title} · done in {time.perf_counter() - t0:.1f}s")


@contextmanager
def watchdog(seconds: float, label: str):
    """Turn a silent hang into a diagnosable crash: dump every thread's stack and abort.

    A stalled network read (a half-open HF connection, a Xet CAS bridge that accepts the
    socket and never answers) blocks forever: the log just *stops*, with no clue which
    call is stuck. That is what wedged the 2026-07-13 refresh for 20+ min — and since the
    cron's `concurrency` group is `cancel-in-progress: false`, every later run queued
    behind it. So bound each network step: if it makes no progress within `seconds`, print
    the label, dump all stacks to stderr (the top frame names the exact stuck call), and
    hard-exit. A hang you can read beats a hang you can only guess at.

    Exits via os._exit because the point is that the process is *stuck* — a normal raise
    can't unwind a thread blocked in a C-level socket read. Set OLATU_NET_TIMEOUT=0 to
    disable (e.g. when seeding a bucket from scratch, which legitimately takes minutes).
    """
    if seconds <= 0:
        yield
        return

    def fire() -> None:
        err(f"{label}: no progress for {seconds:.0f}s — hung, aborting")
        detail("thread stacks follow; the top frame is the call that stalled")
        console.file.flush()
        faulthandler.dump_traceback()
        sys.stderr.flush()
        os._exit(75)  # EX_TEMPFAIL: a stuck peer, not a bug in our logic

    timer = threading.Timer(seconds, fire)
    timer.daemon = True
    timer.start()
    try:
        yield
    finally:
        timer.cancel()


def summary_table(
    title: str, columns: list[str], rows: list[list[str]], *, style: str = BUOY
) -> None:
    """Render a compact end-of-run summary table (skips silently if there are no rows)."""
    if not rows:
        return
    table = Table(
        title=title,
        title_style=f"bold {style}",
        title_justify="left",
        border_style=_DIM,
        header_style=_DIM,
        expand=False,
    )
    for c in columns:
        table.add_column(c)
    for r in rows:
        table.add_row(*r)
    console.print()
    console.print(table)

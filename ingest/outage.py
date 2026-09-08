"""Outages: the failures that are provably *not* Olatu's fault.

The refresh reads four services this project does not own — CANDHIS (buoys), the
Hugging Face bucket (storage), api-maree.fr (tides) and Météo-France (wind). All four
go dark for an hour or two now and then and come back on their own, and the every-30-min
cron turns each of those into a wall of red runs and notifications for something nobody
can act on. Marking those failures `Outage` lets CI hold the alarm until the outage has
lasted long enough to actually need a human (see `.github/scripts/outage-gate.sh`).

⚠️ Raise `Outage` **only where the other side is provably at fault**: a transport fault,
a timeout, a 5xx/429, an upstream error page. Never for "the payload wasn't what we
expect" — a changed HTML table, a renamed column, a schema drift is *our* bug and must
go red on the spot, because a silent six-hour grace period is exactly the wrong answer
to it. When in doubt, don't: a hard failure costs a notification, a wrong grace costs
six hours of unnoticed breakage.
"""

from __future__ import annotations

# sysexits.h EX_TEMPFAIL — the conventional "transient failure, try again later". The
# refresh exits with this (instead of 1) when *every* failure in the run was an Outage,
# which is the single bit .github/workflows/refresh-data.yml reads to decide whether the
# grace window applies. Anything else stays exit 1 = red now.
EXIT_OUTAGE = 75


class Outage(RuntimeError):
    """An external service is unavailable — the run failed, nothing here is broken.

    Subclasses `RuntimeError` so every existing `except RuntimeError` boundary keeps
    catching it; `service` names the culprit for the log line and the CI annotation.
    """

    def __init__(self, message: str, *, service: str) -> None:
        super().__init__(message)
        self.service = service

    def __str__(self) -> str:  # "CANDHIS unavailable: <what happened>"
        return f"{self.service} unavailable: {super().__str__()}"

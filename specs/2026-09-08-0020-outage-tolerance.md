# 0020 — Outage tolerance: don't cry wolf for somebody else's downtime

**Status:** Accepted
**Date:** 2026-09-08
**Supersedes / relates:** changes the failure policy of the refresh cron defined in
[0004 — Realtime scraper](2026-06-27-0004-realtime-scraper.md) §6 and extended by
[0008 — Tides](2026-07-05-0008-tides.md) and [0012 — Wind](2026-07-24-0012-wind.md).
Complements the resilience work logged in [LEARNINGS](LEARNINGS.md) (2026-07-13 watchdog +
transport retries, 2026-09-02 HF OIDC outage).

## 1. Why

`refresh-data.yml` runs every 30 min and reads **four services this project does not own**:

| source | what breaks | seen |
|---|---|---|
| CANDHIS (`candhis.cerema.fr`) | TLS handshake timeouts, PHP error pages | **2026-09-08, ~2.5 h+** |
| Hugging Face bucket | `invalid_grant`/aborted OIDC exchange, mid-handshake resets | 2026-09-02 → 09-03 (~24 h), 2026-07-13 |
| api-maree.fr | 5xx | non-fatal already |
| Météo-France DPObs | 429 | non-fatal already |

Every hour of an outage produced **two red runs and two notifications**, all of them saying
the same thing about something nobody can act on. On 2026-09-08 that was six red runs in
two hours while cerema.fr's TLS handshake timed out — a pure alarm-fatigue generator, and
the exact mechanism by which a *real* failure gets ignored.

The retries already in place (`fetch_html`, `_post_with_retry`, `_net`) cover the
**seconds-to-minutes** faults. Nothing covered the **hours** ones, which are the noisy kind.

## 2. Decision

**A failure that is provably an external service being down does not turn the workflow red
until the outage has lasted `OUTAGE_GRACE_HOURS` (default 6).** Everything else fails on the
spot, exactly as before.

Two independent halves, because the classification and the timing are different problems:

### 2.1 The pipeline classifies its own failures (`ingest/outage.py`)

A new `Outage(RuntimeError)` carries the name of the service that is down. It is raised
**only where the other side is provably at fault**:

- `scrape.FeedUnavailable(ScrapeError, Outage)` — a transport fault, a timeout, a 5xx/408/429,
  a PHP error signature, a body that is not a plausible page.
- `update._net` / `_post_with_retry` give-up, the GitHub id_token request, and an OIDC
  exchange that answers 429/5xx or HF's own `aborted` 400.

⚠️ **Never for "the payload wasn't what we expect".** A 4xx (a moved page, a blocked
User-Agent), a table that changed shape, a missing column, a failed timestamp parse: those
are *ours* and stay hard failures. A wrong grace period costs six hours of unnoticed
breakage; a wrong hard failure costs one notification.

`update.main()` then exits with a **classification, not just a verdict**:

| exit | meaning |
|---|---|
| `0` | clean |
| `75` (`EX_TEMPFAIL`) | every problem this run was an external service being down |
| `1` | at least one failure pointed at this repo |

### 2.2 An external feed outage degrades a buoy, it no longer abandons it

A `FeedUnavailable` from the CANDHIS scrape used to abort the whole campaign **before**
tides, wind, build and upload. So a cerema.fr outage also froze the Air realm and the
marée — for no reason at all: those have their own feeds, and the buoy tiers can be rebuilt
from the last-good reel. The scrape step now catches it, marks the buoy `feed: unavailable`
(a new column in the run's Buoys table — `through` is a date, so a few missing hours don't
show there) and carries on. The run still exits 75.

### 2.3 CI times the outage (`.github/scripts/outage-gate.sh`)

The refresh step captures its exit code instead of failing; a gate step turns it into a
verdict. On exit 75 it asks **"how long since a refresh actually worked?"** and holds the
alarm below the window, raising a `::warning::` + a job summary instead of a failure.

**The clock cannot be the run conclusion.** A held run is green *by design*, so "time since
the last green run" would reset itself every 30 min and the alarm would never fire. The
clock is a **marker step** (`Data refreshed`) that runs only after a clean refresh:
`success` on a healthy run, `skipped` on a held one. Runs predating the marker fall back to
their conclusion, so the first outage after shipping this still measures correctly.

Once the window is exhausted the run goes red and the window **re-arms**: the next runs are
held again until another `OUTAGE_GRACE_HOURS` has passed. A 24 h outage costs four
notifications, not forty-eight — going red every 30 min after hour six would rebuild exactly
the wall of noise this exists to remove.

If the GitHub API can't answer, the gate **fails loudly** — an unmeasurable outage is not a
tolerable one. But an API that answers with an **empty run history** is a different case and
holds: the listing really did come back empty for one run right after the push that first added
the gate, and a workflow with no past runs cannot be six hours into an outage.

## 3. Configuration

| knob | where | default |
|---|---|---|
| `OUTAGE_GRACE_HOURS` | repo variable (Settings → Secrets and variables → Actions → Variables) | `6` |
| `grace_hours` | `workflow_dispatch` input, one run only | the variable |
| `0` | either of the above | restores the old behaviour: every failure red, immediately |

The same number is the **re-alarm interval**: an outage that outlives the window goes red,
then goes quiet for another window before the next red run.

Six hours ≈ 12 missed refreshes. It is comfortably longer than every outage this project
has ridden out on its own, and short enough that a day-long one (2026-09-02) still gets
flagged the same morning.

## 4. What this deliberately does not do

- **No retry-until-it-works.** A held run is a *failed* run; it just doesn't shout. The data
  is stale and the site says so on its own (per-realm freshness badges, spec 0015 §7).
- **No grace for the rest of the job.** A checkout, a pixi solve or a job timeout failing is
  red on the first occurrence — those are ours.
- **No new state anywhere.** The clock is the workflow's own run history; nothing is written
  to the bucket or the repo, so the mechanism can't itself break the pipeline.

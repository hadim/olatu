#!/usr/bin/env bash
#
# Decide whether a failed data refresh turns this run red *now*, or is held as somebody
# else's service being down for a while.
#
# Why: the refresh cron runs every 30 min and reads four services this project does not
# own (CANDHIS, Hugging Face, api-maree.fr, Météo-France). Each of their outages used to
# produce a red run + a notification every half hour for hours, none of them actionable —
# and they nearly always fix themselves. But an outage that is STILL going after a few
# hours is worth a human look, so the alarm is delayed, never cancelled.
#
# Contract (see ingest/outage.py):
#   CODE = 0   the refresh was clean                        -> green, nothing to do
#   CODE = 75  every failure was an external service down   -> grace window applies
#   CODE = *   at least one failure pointed at this repo    -> red now
#
# The clock is "how long since the last refresh that actually worked", read from this
# workflow's own run history. It cannot be the run *conclusion* — a held run is green by
# design, so that clock would reset itself and never fire. It is the MARKER step instead,
# which runs only after a clean refresh: `success` on a healthy run, `skipped` on a held
# one. Runs older than the marker (i.e. from before this file existed) fall back to their
# conclusion, so the very first outage after deploying this still measures correctly.
#
# Once the window is exhausted the run goes red — and the window then RE-ARMS: the next
# runs are held again until another GRACE_HOURS has passed. A 24 h outage should cost four
# notifications, not forty-eight; going red every 30 min after hour six would rebuild
# exactly the wall of noise this exists to remove.
#
# Env: CODE, GRACE_HOURS (integer; 0 disables the grace entirely), MARKER, GH_TOKEN.

set -euo pipefail

MARKER=${MARKER:-Data refreshed}
GRACE_HOURS=${GRACE_HOURS:-6}
CODE=${CODE:-0}

summary() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >>"$GITHUB_STEP_SUMMARY"; return 0; }

if [ "$CODE" = "0" ]; then
  echo "refresh clean"
  exit 0
fi

if [ "$CODE" != "75" ]; then
  echo "::error::Data refresh failed with exit $CODE — not an external outage, so this is ours to fix. No grace applies."
  summary "### ❌ Data refresh failed (exit \`$CODE\`)"
  summary "Not classified as an external outage — see the refresh step's log."
  exit 1
fi

# ---------------------------------------------------------------- the outage clock
if [ "$GRACE_HOURS" -le 0 ]; then
  echo "::error::External outage and the grace window is disabled (OUTAGE_GRACE_HOURS=$GRACE_HOURS)."
  exit 1
fi

now=$(date -u +%s)
grace_s=$((GRACE_HOURS * 3600))
# `owner/repo/.github/workflows/refresh-data.yml@refs/heads/main` -> `refresh-data.yml`.
# Drop the `@ref` FIRST: it contains slashes of its own, so taking the basename before it
# yields `main`.
wf=${GITHUB_WORKFLOW_REF%%@*}
wf=${wf##*/}

if ! runs=$(gh api --method GET "repos/$GITHUB_REPOSITORY/actions/workflows/$wf/runs" \
  -f status=completed -f "branch=$GITHUB_REF_NAME" -F per_page=100 \
  --jq '.workflow_runs[] | "\(.id) \(.created_at | fromdateiso8601) \(.conclusion) \(.created_at)"' </dev/null); then
  echo "::error::External outage, but the GitHub API would not answer — cannot tell how long it has lasted, so failing loudly."
  exit 1
fi

echo "gate: workflow=$wf branch=$GITHUB_REF_NAME grace=${GRACE_HOURS}h now=$now"
echo "gate: listed $(printf '%s' "$runs" | grep -c . || true) previous run(s)"
printf '%s\n' "$runs" | head -3 | sed 's/^/gate:   /'

last_ok=""
last_ok_ts=0
last_red=""  # the most recent run in the window that already raised the alarm
scanned=0
# Fields: id, created_at as epoch seconds (jq does the parsing — `date -d` is GNU-only
# and this script should stay runnable on a laptop), conclusion, created_at as text.
while read -r id ts conclusion created; do
  [ -n "$id" ] || continue
  [ "$id" = "${GITHUB_RUN_ID:-}" ] && continue
  # Older than the window: whatever happened there can no longer keep us green.
  if [ $((now - ts)) -gt "$grace_s" ]; then break; fi
  scanned=$((scanned + 1))
  [ "$conclusion" = "failure" ] && [ -z "$last_red" ] && last_red=$created
  marker=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id/jobs" \
    --jq "[.jobs[].steps[]? | select(.name == \"$MARKER\") | .conclusion] | join(\",\")" </dev/null || echo "")
  if [ -z "$marker" ]; then
    # A run from before the marker existed: its conclusion is trustworthy, because a
    # held-green run could not exist yet.
    [ "$conclusion" = "success" ] && { last_ok=$created; last_ok_ts=$ts; break; }
  elif [[ ",$marker," == *,success,* ]]; then
    last_ok=$created
    last_ok_ts=$ts
    break
  fi
done <<<"$runs"

if [ -z "$last_ok" ]; then
  # Nothing worked inside the window. Raise the alarm — unless it was already raised in
  # this window, in which case hold until the NEXT one so a day-long outage stays four
  # notifications instead of forty-eight.
  if [ -n "$last_red" ]; then
    echo "::warning::External outage ongoing (>${GRACE_HOURS}h); already reported at $last_red, next alarm in up to ${GRACE_HOURS}h."
    summary "### ⚠️ External outage still ongoing"
    summary "Longer than **${GRACE_HOURS}h**, and already reported at \`$last_red\` — holding until the next window rather than failing every 30 min."
    exit 0
  fi
  echo "::error::External outage still going after more than ${GRACE_HOURS}h (no successful refresh in the last $scanned run(s)). Time to look at it."
  summary "### ❌ External outage — grace window exhausted"
  summary "No successful data refresh in the last **${GRACE_HOURS}h**. See the refresh step's log for which service is down."
  exit 1
fi

down_s=$((now - last_ok_ts))
down=$(printf '%dh%02dm' $((down_s / 3600)) $((down_s % 3600 / 60)))
echo "::warning::External service unavailable — last successful refresh $down ago, holding the alarm until ${GRACE_HOURS}h."
summary "### ⚠️ External outage — alarm held"
summary "Last successful refresh: **$down ago** (\`$last_ok\`). This run is kept green until the outage passes **${GRACE_HOURS}h**; the data on olatu.io is that old, but nothing here is broken."
exit 0

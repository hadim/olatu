# 0021 — The chart x-axis is a clock, not the buoy's last point

**Status:** Accepted
**Date:** 2026-09-12
**Supersedes / relates:** revises the x-window rules of
[0003 — UX refinement](2026-06-27-0003-ux-refinement.md) (time navigation) and
[0019 — Instant load & cache](2026-08-25-0019-instant-load-cache.md) §8 (the `TN`-follow
effect). Extends the per-realm freshness vocabulary of
[0015 — Current Conditions density](2026-08-07-0015-current-conditions-density.md) §7–§8 to
the chart stack, and is the webapp-side counterpart of
[0020 — Outage tolerance](2026-09-08-0020-outage-tolerance.md): 0020 stopped an upstream
outage from crying wolf in CI, this one stops it from lying on screen.

## 1. Why

On **2026-09-12** all three buoys were frozen at **2026-09-08T12:00Z** — four days — while
the three wind stations were reporting normally (Socoa 14:06Z, ~25 min old). Verified
upstream: CANDHIS's own realtime table for 06403 stopped on 08/09 too, so the freeze is
theirs and the pipeline is healthy.

The chart stack pinned its right edge to `TN = max(last daily point, buoy manifest.span.end)`
and *clamped all navigation to it*. Three consequences, in descending order of severity:

1. **Live data became unreachable.** Four days of 6-min wind sat in the tier, off the axis,
   with no gesture able to reach them — the preset chips, `panBy`, the date picker and a
   drag-zoom all clamp to `TN`.
2. **The outage was invisible.** A dead feed draws exactly like a live one: the curve touches
   the right edge either way. Only the axis label betrayed it. Worse, the page contradicted
   itself — Current Conditions said *dormant* (0015 §8), the tide strip showed the tide at
   this minute, and the charts directly below looked perfectly current.
3. **The axis had no stable meaning.** Switching buoy or station moved what "the right edge"
   was. An axis whose zero point depends on which feed happens to be healthiest cannot be
   read across panels.

Two silent bugs fell out of the same investigation, both of which froze the charts *within a
session* independently of the outage:

- the per-year tile caches are dropped only when the **buoy** `TN` advances, so a frozen buoy
  also froze the wind tiles (spec 0019 §8 wired the invalidation to one realm);
- the 5-min poll refreshes the wind **`latest`** but never the wind **manifest**, so
  `windYearFiles` keeps its identity and the wind year tile is never refetched.

## 2. Decision

**The x-axis is a clock. Its right edge is `now`, for every panel, always.** The chart no
longer asks a feed where time ends; it asks the clock, and then *shows* what each feed did or
did not deliver up to that point.

The empty space this creates during an outage is not a defect to hide — it is the finding.
The design work is to make it read as information (§3.3) instead of as a blank.

Rejected alternatives, recorded so they don't come back:

- **Right edge = the freshest reading across realms** (`max(sea, air)`). One line of code and
  it unblocks the wind, but it fixes only consequence 1: the Mer curve still stops short with
  no explanation, and when *every* feed freezes it rewinds the axis silently — a chart of last
  Tuesday presented as a chart of now. It moves the arbitrary anchor rather than removing it.
- **Hybrid** (now while any realm is fresh, rewind to the last reading when all are stale).
  Never an empty plot, but the right edge changes meaning depending on the state of the feeds
  — two modes to learn, two to test, and the rewind is exactly the lie above.
- **A future margin so the tide panel shows the next PM/BM.** Deferred (§4).
- **Per-realm x-axes.** Rejected outright: 0013's whole premise is that the station shares the
  buoy's x-axis, which is what makes "buoy vs station" comparable.

## 3. The rules

### 3.1 Four bounds, never conflated

| bound | what it is | what it drives |
|---|---|---|
| `seaTN` | freshest buoy reading (`max(last daily point, manifest.span.end)`) | the Mer silence band |
| `airTN` | freshest station reading (`latest.json` tail, else the station manifest span) | the Air silence band |
| `dataTN` | `max(seaTN, airTN)` | **per-year tile-cache invalidation** (0019 §8), the empty-window test |
| `TN` (axis) | `max(now, dataTN)` | the x domain: presets, clamping, `atEnd`, the year list, the date picker |

Splitting these is not tidiness, it is the load-bearing part. Wiring the cache invalidation to
a *clock* would drop and refetch the current year's tile on every tick; wiring the axis to the
*data* is the bug this spec exists to fix. `dataTN` takes the max over **both** realms, which
is also what unfreezes the wind tiles when the buoy stalls.

### 3.2 Following the edge: data immediately, the clock lazily

A window sitting at the right edge follows it; a window the reader panned to stays where they
put it (0019 §8, unchanged). What changes is *when* the follow fires, because a rebuild
destroys and re-creates every uPlot:

- **New data** (`dataTN` advanced) → slide **immediately**, as before. The data is the point.
- **Clock only** (an outage: nothing is arriving, the edge just drifts) → slide once the
  pending shift exceeds `max(5 min, 2 % of the window)`, capped at a day. Nothing new is being
  withheld by waiting, and it keeps a 2-hour window from rebuilding every minute; the cap is
  there so a multi-year window doesn't call itself "at the end" a week short of it.

The **"now" rule itself is exempt** from that gate: it is repositioned on a 60 s tick through a
handle held by the render effect, with no rebuild — so the marker glides while the panels stay
put. `atEnd` (the ` › ` button, the "was it parked?" test) uses the same tolerance as the gate,
or it would read as "not at the end" for the whole interval between slides.

### 3.3 Making the hole legible

Three layers, deliberately ordered from quietest to loudest, and keyed to the **same freshness
vocabulary the badges already use** (`lib/format.freshness`: fresh ≤ 2 h, aging ≤ 6 h, stale
beyond) so the page tells one story:

1. **The "now" rule** — one thin vertical line across the whole stack, in the shared day-line
   overlay so it reads as a single continuous mark through every panel and the gaps between
   them, captioned `maintenant` on its left (the right side is only the 4 % scale pad). Always
   drawn. It is what gives the trailing space a meaning at every zoom, not just during an
   outage.
2. **A silence band, per realm, from `aging`** (> 2 h) — a hatched band from that realm's
   freshest reading to the right edge, on every one of its panels. Texture only, no words.
   Below 2 h nothing is drawn: the buoy's normal 30–45 min lag is not a defect and decorating
   it would put hatching on a quarter of a 2-hour window for no reason.
3. **A label, per realm, from `stale`** (> 6 h) — centred in the band on the topmost affected
   panel only. One statement per realm, not one per panel: ten chips would be noise. It shrinks
   rather than clips, longest wording that fits: `Mer · dernier relevé il y a 4 jours` →
   `Mer · il y a 4 jours` (a ~220 px phone band) → texture alone. The arrow rows are skipped as
   label carriers — a line-tall panel holds the texture but not the words, so the caption falls
   through to the next panel of that realm.

The staleness test reads each realm's **freshest reading overall**, never the plotted tier —
otherwise the band would appear and disappear as the daily/hourly/30-min tiers swap under a
zoom. The tide panel is never banded: it is a prediction and is complete by construction.

### 3.4 Never a silently empty chart, never a silent rewind

If the chosen window contains no measured data at all (`range.min > dataTN` — only reachable
when the outage is longer than the window), the stack shows a notice above it:
*"No data in this window · last reading 8 Sept 14:00"* with a **`Y aller` / `Go there`** button
that moves the window, at its current width, to end on the last reading.

One tap, and no magic: the window never rewinds itself. Auto-rewinding would show the reader a
6-hour window from four days ago in the place where they asked for the last six hours, which is
the same lie as anchoring to a dead feed — with the added twist that it only happens when
things are broken.

## 4. Deliberately not done

- **A future margin for the tide panel** (right edge at `now + ~10 %`, tide prediction drawn
  into a shaded *à venir* zone). Attractive, but the banner tide strip already answers
  "when is the next high tide", and it would make *every* measured curve stop short of the
  right edge permanently — reintroducing, by construction, the visual the rest of this spec
  removes. Revisit only if the tide panel gains a reason of its own.
- Anything on the ingest side. This is a webapp-only change; the tiers are unchanged.

## 5. Implementation notes

`webapp/src/components/TimeSeries.tsx`, plus a little plumbing in `App.tsx`.

- **Do not put `nowSec` in the render effect's dependency array.** The hatch geometry does not
  need it (the band runs from a frozen realm `TN` to the plot's right edge), and neither does
  the label's precision. Depend on the *derived* `seaSilentAt` / `airSilentAt`, which are
  `null` while a realm is healthy and a frozen timestamp once it is not — stable either way.
  The relative age in the label is read from `Date.now()` inside the effect.
- **`windLastT` comes from `latest.json`, not the wind manifest** — the 5-min poll refreshes
  the former and (before this spec) not the latter. The poll now refreshes the wind manifest
  too, which is also what makes `windYearFiles` change identity so the wind year tile is
  actually refetched during a session.
- The heat ribbon takes an explicit `tn` so its track ends where the axis does; without it the
  right drag handle sits past 100 % and is clipped away by `overflow-hidden`.
- The now line gets its own host-wide layer beside the day overlay — same `--ts-pad` insets, but
  `z-1` (above the canvases: it is a reference mark, not background) and, unlike the day
  separators, no span guard, so it draws at every zoom. Host-wide and **not** per canvas, for the
  reason the day separators are: a per-panel line breaks at every heading.

## 6. Acceptance

1. With a buoy frozen four days and its station live, the wind curve reaches the right edge and
   the Mer panels carry a hatched band with one `dernier relevé il y a 4 jours` label.
2. With **both** realms silent (the station's data forced away), a window shorter than the
   outage shows the notice + a working `Y aller`, not a blank stack. With only the buoy silent
   there is no notice — the window is not empty, the Air panels are in it.
3. In the healthy case nothing is hatched, and the trailing gap is the feed's normal lag.
4. Switching buoy or station does not move the right edge.
5. A window the reader panned to does not move on its own; a window at the edge follows new
   data immediately.
6. A wide window (`1Y`, `All`) does not rebuild its panels on the clock tick.

Checked in a browser against the live 2026-09-12 outage: 1–5 in light and dark at 1280 px and at
400 px (no horizontal overflow, caption falling back to `Mer · il y a 4 jours`), the now rule's
position measured against the day separators (974.5 px → 16:54 Paris = 14:54 UTC, exact), and 2
with `airTN` forced to 0.

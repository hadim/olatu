# Learnings log

Running, append-only record of significant findings made while building Olatu —
things that were non-obvious, cost real debugging time, or invalidate an assumption
in the specs. Newest first. When a finding changes a decision, also fix the relevant
spec and link it here.

Format per entry: **date — title** · what we found · why it matters · resolution · refs.


**Update 2026-09-03.** Still live, and now pinned down. The bogus-JWT probe returns the same body
at **10.15 s, 3/3**, while GitHub's OIDC discovery + JWKS answer in ~0.32 s from the same laptop —
so the abort is HF-side, not upstream. The *same* 10 s constant turns up on
`POST /api/buckets/…/settings/trusted-publishers`, which 500s **6/6 at 10.15-10.20 s** on a payload
that had succeeded 40 min earlier: one timeout, two endpoints, two different (wrong) status codes.
Separately, the bucket's trusted publisher had simply **vanished** — the list came back empty,
which is what "no trusted publisher matching" was literally telling us. Recreating it did not fix
the exchange. Reported as [hub-docs#2757](https://github.com/huggingface/hub-docs/issues/2757).

**Update 2026-09-04 — resolved, and the lesson is the escape hatch, not the diagnosis.** The owner
re-added the repo as a Trusted Publisher and the exchange came back: **first attempt, ~2 s**, where
the day before all 8 retries died. Nothing on our side changed between the two — which is the whole
point. What made a two-day HF-side outage a non-event was that `resolve_token` reads `HF_TOKEN`
*before* trying OIDC, so switching credentials was **adding a secret, then deleting it** (both
verified in CI with `-f keyless=true` first), with no code, no deploy and no spec change either
way. Keep that ordering, and keep `permissions.id-token: write` on while a token is in use — the
cost of the fallback is one `if` and it is the only reason the cron kept running. Two caveats on
the way back: recreating a publisher can silently *narrow* it (ours came back with `repository`
only, no `workflow_ref` prefix), and the old fine-grained token has to be revoked HF-side —
deleting the GitHub secret does not. Refs: `ingest/update.py`,
[HISTORY](../docs/HISTORY.md#2026-09-04--back-to-keyless-the-oidc-exchange-recovered-the-hf_token-secret-is-gone).

---

## 2026-09-03 — A "last N minutes" poll turns any outage into a permanent hole

**What we found.** The 2026-09-02 HF outage failed every refresh from 10:19 to 16:36 UTC. When it
recovered, the **buoy** series had no gap and the **wind** series had a ~6 h one (Socoa 09:36 →
15:33 UTC; hours 10-14 held *zero* of their 10 six-minute points). The two feeds are not equally
forgiving, and nothing in the code said so:

- **CANDHIS republishes the last ~48 h on every fetch.** The scraper coalesce-merges the whole
  window, so it is *accidentally* self-healing — any outage shorter than 48 h costs nothing.
- **DPObs serves exactly one observation per call**, addressed by timestamp. Our refresh asked for
  a fixed 66-minute window (`LIVE_LOOKBACK_MIN`). Every point the cron was down for was simply
  never asked for again.

Two checks settled it in a minute, and both are worth repeating before assuming data is lost:
requesting an hour inside the hole returned **10/10 points** (so the hole was ours, not upstream),
and bisecting `date=` backwards found DPObs still serving **~96 h** of history (so it was still
repairable — barely).

**Why it matters.** The buoy feed's forgiveness masked the wind feed's fragility for six weeks:
both pipelines "worked", both were monitored the same way, and the run that dropped the data
reported success. Any per-timestamp API polled over a fixed recent window has this bug latent in
it — and widening the window (the obvious fix, "take 24 h instead of 66 min") only moves the cliff
and pays for the whole window on every healthy run.

**Resolution.** The request set is derived from **what the accumulator holds**, not from the clock
(`wind.live_targets`, spec [0012 §3.1](2026-07-24-0012-wind.md)): re-probe the 66-minute tail
unconditionally, plus any 6-min slot missing from the last 24 h, newest first, **capped at 60 per
station per run** so a long outage can't wedge the 30-min cron — successive runs chew backwards.
A healthy run costs exactly what it did before (a full window contributes zero extra calls), and
nothing older than the measured 96 h retention is ever requested, because that is the one place a
hole is now genuinely permanent. `pixi run wind --backfill` lifts the cap for a manual repair.

**Refs.** `ingest/wind.py` (`live_targets`, `Targets`, `_dpobs_gate`), spec 0012 §3.1.

---

## 2026-09-02 — HF reports its own timeout as a `400 invalid_grant`; a status-only retry never fires

**What we found.** Three consecutive `*/30` refreshes (04:42, 05:19, 05:40 UTC) died 10 s in,
before touching any buoy, on the OIDC exchange:
`400 {"error":"invalid_grant","error_description":"This operation was aborted"}`. Nothing
changed on our side — the run before and the run after exchanged the very same kind of GitHub
id_token. "This operation was aborted" is Node's `AbortSignal` message: the Hub's token endpoint
timed out on **its own** upstream call (verifying our JWT against GitHub's keys) and surfaced
that as a *client* error. **Ten-second diagnosis:** POST a *bogus* JWT (any `iss:
https://token.actions.githubusercontent.com` payload, garbage signature) to
`https://huggingface.co/oauth/token` from a laptop — during the incident it answered the same
`aborted` body after exactly ~10 s every time, where a healthy Hub rejects the signature at
once. Same answer from outside CI = HF-wide, not our claims, not the trusted-publisher
config, not GitHub. The status page showed everything operational throughout. The night
before, a separate run died on a `429` whose HTML body carried no `Retry-After`: our 1-2-4-8 s
schedule (15 s in total) sat entirely inside HF's rate-limit window, so all five attempts got
the same answer.

**Why it matters.** The exchange is the run's *first* network call, so any blip there takes
all three buoys down at once and the site's freshness badge goes grey for 30 min per miss.
The 2026-07-13 fix made `_post_with_retry` retry 429/5xx *and* transport faults — but a
transient dressed as a `400` is invisible to a status-code allow-list, and a backoff shorter
than the rate-limit window is no backoff at all. Both are the same lesson as July: classify
by *what happened*, not by the code the other side chose.

**Resolution.** `update._hf_aborted` recognises the aborted-upstream body and
`_post_with_retry` treats it as transient alongside 429/5xx; a genuine `400` (bad claims,
mis-configured trusted publisher) still returns at once so the log names the real cause.
Backoff is now 3-6-12-24-48-60-60 s over 8 attempts (~3.5 min, under the 600 s auth
watchdog and the job's 15-min cap) — the first run with the fix needed **all six** of the
original attempts before one exchange landed, so six was the floor, not a margin. Refs:
`ingest/update.py`, [HISTORY](../docs/HISTORY.md#2026-09-02--the-oidc-exchange-rides-out-hfs-own-timeouts).

---

## 2026-08-27 — a cache moves your mount into the past, and everything seeded at mount with it

**What we found.** Painting from the local tier cache (spec 0019) broke the charts in a way the
cache work never touched: the x-axis stopped reaching "now", while Current Conditions stayed
correct. Nothing in the caching layer was wrong. `TimeSeries` seeds its x-window from `TN` (the
latest reading) in a `useState` initializer, and that mount used to happen **on fresh data** because
the charts simply didn't exist until the network answered. With a cache, the same mount happens on
data as old as your last visit — and nothing ever revisited it. The in-memory per-year tile caches
had the same shape: filled once, never invalidated, so even a window that did advance plotted a line
that stopped where the previous visit did. Current Conditions escaped only because it is derived
from `latest` on every render.

A second, independent bug in the same report: `swrBuffer` reports "unchanged" as soon as the hashes
match, but the stale *decode* it handed to `onStale` is async. On a fast network the unchanged
sentinel resolved first, so the caller was told to keep a copy it had not been given — it kept
nothing, and the charts fell back to the coarse daily tier. That path is taken whenever you reload
inside one 30-min build window, i.e. constantly.

**Why it matters.** Both are the same class of mistake, and it is the one a cache invites: *a cache
changes WHEN your code first runs, not just how fast*. Any value seeded once "because by then the
data is fresh" is now seeded on stale data, and every "you already have this" answer is a claim
about the caller's state that the caller may not have reached yet. Neither is visible online without
a cache — the network won every race — so both survived the review that shipped 0019.

**Resolution.** `TimeSeries` watches `TN`: when it advances it drops the tile caches for the year(s)
crossed and slides the window forward, but **only** when the window was sitting on the latest reading
— a window the user navigated to is left alone (and `⟲ Reset` follows the window, not the pin).
`loadParquetTierFrom`/`loadTidesForManifest` await the stale paint before returning the unchanged
sentinel. Callers tolerate a tile that resolves to nothing rather than caching or merging the hole.

Verified by rewinding `manifest.span.end` 3 h on the first load and releasing it on the next
refresh, then re-running the same script against the unpatched code — a test that passes both ways
proves nothing.

**Refs.** [spec 0019 §8](2026-08-25-0019-instant-load-cache.md), `webapp/src/components/TimeSeries.tsx`,
`webapp/src/lib/parquet.ts`, `webapp/src/lib/data.ts`.

---

## 2026-08-25 — a fast failure beats your cache: `Promise.all` blanked the page offline

**What we found.** With the new local tier cache (spec 0019) the offline case still rendered
*nothing*, even though every tier was stored on the device. The cause is an ordering nobody plans
for: **failing is faster than reading IndexedDB.** A 503 (or a dead connection) answers in a
fraction of a millisecond, while opening IndexedDB and reading an entry takes a few. The eager
tiers were loaded with `Promise.all`, so the first rejection settled the group *before* the cached
copies had been read — the app took the rejection, saw "nothing painted", and showed the fatal
error over a cache full of perfectly good data.

The same shape bit a second time one layer down: the stale *decode* of a cached parquet tier is
async, and a `settled` flag set in a `.finally()` suppressed the stale paint on the **failure** path
too — so the charts stayed empty offline while Current Conditions came back.

**Why it matters.** Both bugs are invisible online: the network wins every race when it works, so
the cache path is only ever exercised in the exact conditions where these orderings flip. A cache
that silently does nothing when the network is down is worse than no cache, because you believe you
have one.

**Resolution.** `loadEager`/`loadWindEager` use `Promise.allSettled` and rethrow after everything
has settled (so every cached copy got its chance to paint), and the "don't paint stale" flag is set
**only when a fresh copy is actually being returned** — never on failure, never on an unchanged
tier. Test the cache path by making the backend fail, not by making it slow.

**Refs.** [spec 0019 §4](2026-08-25-0019-instant-load-cache.md), `webapp/src/lib/swr.ts`,
`webapp/src/lib/parquet.ts`, `webapp/src/lib/data.ts`.

---

## 2026-08-24 — an accumulation is not a state: rain broke every rule the schema assumed

**What we found.** `precipitation_mm` sat in a schema where every other variable is a *state* read
at an instant, and it inherited all three of that schema's assumptions — each one wrong for a
cumulative depth:

1. **One column, one meaning.** False: the hourly bulk feed gives `RR1` (1 h) and the DPObs 6-min
   feed gives `rr_per` (6 min). A mixed-cadence source silently made the column mean two different
   things, with a 10x step at the seam — the *same* class of bug as the gap-break cadence guess
   (2026-07-25 entry). Mixed cadence keeps costing us; assume it, don't discover it.
2. **Down-sampling is a mean.** False, and expensively so: `mean()` over a daily bucket divided the
   rain by 24 (by ~240 in the 6-min era). Socoa took 51.2 mm on 2026-02-16 and the "years" view
   announced 2.1 mm. **Nothing surfaced this** — rain's normal value is 0, so a wrong rain series
   looks exactly like a right one. It was found by asking what the number meant, not by looking.
3. **The stamp is the instant of the reading.** False: an accumulation is stamped at the **end** of
   its window. Both feeds do this.

**Why it matters.** Point 3 is the one you cannot look up. Météo-France's own field descriptor says
only *"RR1 : quantité de précipitation tombée en 1 heure"* — it never states which hour, though it
does bother to call `T` *"température sous abri **instantanée**"*. Guessing wrong is a silent
one-hour shift that no chart will ever reveal.

**Resolution.** Probe, don't assume: cross-check the hourly feed against the 6-min feed over a rainy
hour. On 2026-08-23 at Socoa, `(H-1h, H]` matched `rr1` exactly on all seven hours and `[H, H+1h)`
on none. That single test settled the convention and the aggregation bucket
(`closed='right', label='left'`) falls straight out of it. The general rule: **before aggregating a
cumulative variable, prove its window and its stamp against a second, finer feed.**

Also: `sum()` of an all-null bucket is `0.0` in polars, not null — for rain that turns "no
measurement" into "it stayed dry", and it is invisible. Guard every accumulation aggregate.

**Refs:** [0018 — Precipitation window & aggregation](2026-08-24-0018-precipitation-window.md),
`ingest/wind.py` (`_downsample`, `_trailing_hour_accum`, `_sum_keep_null`), `schema.WIND_ACCUM_VARS`.

---

## 2026-08-16 — the tide coefficient is not a marnage: don't compute it, and don't trust just any site to check it

**Finding.** Adding the French *coefficient de marée* ([spec 0008 §11](2026-07-05-0008-tides.md))
started from "it's just `100 × marnage / (2 × 3.05 m)` at Brest, we already have extrema". Three things
turned up while checking that:

1. **api-maree.fr grew a `/tide-extrema` endpoint** that returns PM/BM **with the coefficient** — the
   spec 0008 premise ("no high/low or coefficient endpoint → we derive extrema ourselves") was simply
   out of date. It also does in **one** request what `/water-levels` needed six chunked ones for.
   *Re-read an upstream API's docs before porting a workaround forward.*
2. **The naive formula drifts, and not by a constant.** Recomputing from our own Brest extrema gave
   ±2 against the published values at spring but ran ~2 low at neap; the coefficient is an
   *astronomical* index (a smoothed semi-diurnal amplitude), while a marnage also carries the
   shallow-water and long-period terms. The reduction near neap is real water, not an error — the
   two quantities genuinely diverge, so a marnage can never be converted into a coefficient by a
   fixed factor.
3. **Reference sites disagree by more than our own error.** Checked against two: `maree.info`'s Brest
   calendar and `horaire-maree.fr`. The API matched maree.info within **±1** over 11 days (95/90,
   84/78, 71/64, 30, 27/26, 63/68) but was up to **−6** against horaire-maree.fr, which is offset on
   the whole waning half of the cycle. Had we validated against the second source alone, we would have
   "fixed" a correct implementation with a bogus calibration.

**Why it matters.** The coefficient is the number French users cross-check against their own app, so a
2-unit bias is noticeable — and the temptation to derive it locally is strong because the marnage is
right there. It is a **Brest-referenced national index**: identical at every French port (verified —
`brest`, `saint-jean-de-luz` and `cap-ferret` return the same series), and therefore *not* a statement
about the water at this buoy. That is exactly why the marnage in metres stays the primary metric.

**Resolution.** Read `coef` from `/tide-extrema` and store it as a nullable `c` column on high-tide rows;
never recompute it, never derive it from a local marnage, and never let it drive the neap↔spring gauge.
When validating a public-data number, check **two independent sources** before concluding your own is
wrong. Refs: `ingest/tides.py`, [spec 0008 §11](2026-07-05-0008-tides.md).

## 2026-08-10 — two silent layout lies on a phone: `clientWidth` includes padding, and `sr-only` doesn't hide a `<table>`

**Finding.** Measuring the 390 px layout for [spec 0017](2026-08-10-0017-mobile-layout.md) turned up two
long-standing bugs that were invisible because both failure modes are *quiet*:

1. **Every chart panel was built too wide.** `new uPlot({ width: host.clientWidth })` — but `clientWidth`
   is content **+ padding**, so each plot was `2 × --ts-pad` wider than the box it sits in (34 px at the
   old `px-4`). The surplus hung off the right and was clipped by the wrapper's `overflow-hidden`, so
   there was no scrollbar, no console warning and no visible break — just a permanently amputated right
   edge on the x-axis, on desktop as well as mobile.
2. **The visually-hidden summary table was 420 px wide.** `class="sr-only"` sets `width: 1px` +
   `overflow: hidden`, which works on a `<div>` and **not** on a `<table>`: a table's `width` is a
   *minimum*, and the clip doesn't apply to the table box. The accessible per-window summary therefore
   laid out at full width and gave a 390 px phone 27 px of phantom horizontal scroll — visible only as
   "the page wobbles sideways", with no element on screen to blame.

**Why it matters.** Neither shows up in a screenshot or a test that asserts on the DOM; both were found
only by comparing `document.documentElement.scrollWidth` against `innerWidth` and each plot's rect against
its wrapper's. That comparison is now the cheapest mobile smoke test we have — run it before trusting a
layout at a new width.

**Resolution.** uPlot is sized from the host's **content** width
(`clientWidth − paddingLeft − paddingRight`, via a `plotWidth()` helper used by the build *and* the
ResizeObserver), and `sr-only` moved onto a wrapper `<div>` around the `<table>`. General rules:
**never pass `clientWidth` to something that draws inside the padding box**, and **never put `sr-only` on
a `<table>` (or any element whose width is a minimum rather than a used value)**. Refs:
`webapp/src/components/TimeSeries.tsx`, [spec 0017 §2 / §6](2026-08-10-0017-mobile-layout.md).

## 2026-07-27 — a minimum row count turns an upstream buoy outage into a red cron, and guards nothing

**Finding.** The refresh cron went red every 30 min with
`✗ 03302: only 11 rows scraped (< 40); refusing to write`. Nothing was broken on our side: Cap Ferret
stopped transmitting on 2026-07-25 13:30 UTC and resumed on 2026-07-27 08:30 UTC. Since CANDHIS serves a
rolling **~48 h window**, that window straddled the outage and legitimately held 11 rows instead of ~97,
which tripped `scrape.MIN_ROWS = 40`. The tell is in the *last green* run: it scraped 96 rows spanning
`07-23 13:30 → 07-25 13:30` with a `newest timestamp did not advance` warning — the window was still
entirely pre-outage. The moment the buoy resumed, the window slid onto the gap and the count collapsed.

**Why it matters.** Three costs, none of them offset by a benefit. (1) The failure is **self-inflicted and
recurring**: nothing recovers it but the buoy transmitting for 20 h straight, so the cron stays red for
most of a day and real failures hide in the noise. (2) It **discards good data** — each run scraped the
handful of fresh rows and threw them away rather than merging them. (3) The guard was **redundant**: the
merge is an additive coalesce with a never-shrink invariant, so a short scrape *cannot* truncate the
accumulator, and every genuine format break is already caught by the structural checks (one table,
8 columns, 8 cells/row, `TU` header, `DD/MM` locale flip, `:00`/`:30` grid, 20 % plausible-range rule).
A row count adds no signal those miss — it only conflates "the page is broken" with "the sea gave us
nothing", and only the first is ours to act on.

**Resolution.** Dropped `MIN_ROWS` entirely; an empty table returns an empty typed frame and `scrape()`
logs a warning and no-ops instead of raising (also removes a latent `ZeroDivisionError` in the
plausible-range ratio). General rule for this pipeline: **validate the shape of the response, never the
volume of the data** — volume is upstream reality. Refs: `ingest/scrape.py`,
[spec 0004 §5](2026-06-27-0004-realtime-scraper.md).

## 2026-07-25 — rebuilding a canvas stack scrolls the page to the top, and restoring the offset too early is clamped away

**Finding.** Reordering or hiding a chart panel yanked the page back near the top. The `TimeSeries`
render effect rebuilds the whole stack (`host.innerHTML = ''` + a fresh uPlot per panel), so for an
instant the host is ~0 px tall, the document shrinks by its full height, and the browser **clamps** the
scroll offset to the new maximum. Two further traps hid the fix: (1) the collapse happens in the effect's
**cleanup** (`uPlot.destroy()` removes each canvas), which React runs *before* the new effect body — so
measuring the height at the top of the body is already too late; (2) after the rebuild the panels are
**not yet laid out** (offsetHeight was 427 px where the stack is 1600 px), so both clearing a height pin
and issuing `window.scrollTo(prevScroll)` in that same tick land against the short layout — the scrollTo
is silently clamped and does nothing.

**Why it matters.** It made an otherwise-working reorder feel broken, and it hunts like a scroll-anchoring
or focus bug: `overflow-anchor: none` changes nothing, `focus({preventScroll: true})` is not the cause,
and instrumenting `scrollTo`/`scrollIntoView`/`scrollTop` shows **no** call doing the damage — the browser
clamp leaves no trace. The give-away is reading `document.scrollHeight` *at the moment of the restore*.

**Resolution.** Pin the height in the **cleanup**, before the plots are destroyed
(`host.style.minHeight = host.offsetHeight + 'px'`), and release it in a **`requestAnimationFrame`** at the
end of the rebuild, restoring `prevScroll` there if it still moved. Same pattern for any imperative
canvas/DOM stack rebuilt inside an effect. Refs: `webapp/src/components/TimeSeries.tsx`,
[spec 0013 §7](2026-07-24-0013-wind-webapp-ux.md).

## 2026-07-25 — a mixed-cadence series shatters a line chart when the gap threshold keys off the global-min

**Finding.** "At the 1-year window I see the wind data, but when I zoom into a few days I see
nothing." The wind line (and air-temp, humidity, pressure — anything drawn as a *line*) broke into
invisible isolated dots on the fine tier, while the wind-**direction** arrows and the tide curve were
fine. Root cause was the chart's `gapAware` (webapp `TimeSeries.tsx`) computing its "break the line
across an outage" threshold as **4 × the global-minimum delta**. The current-year wind file appends a
**6-min live tail to an hourly history** (spec 0012), so the global min collapsed to ~360 s and the
threshold to ~24 min — and *every* hourly history step (3600 s) got flagged as a gap and null-broken.
At 1Y the uniform hourly-**means** tier loads (no fast tail), which is why it looked fine there; the
fine per-year tier is where the mixed cadence bites. Direction survived because glyphs are drawn
per-point (no line to break); the buoy never hit it (uniform 30-min cadence).

**Why it matters.** The comment *said* "median cadence" but the code used the **minimum** — fine while
every series was single-cadence, quietly wrong the moment one wasn't. It reads as a data outage
(nothing there) when the data is complete. Column projection / parquet were all correct; only the
render heuristic was wrong, so it survived typecheck, build, and a casual look at recent windows.

**Resolution.** Estimate the cadence **causally with an EWMA of the normal (non-gap) deltas**, not the
global min: `cadence ← 0.15·d + 0.85·cadence`, skip folding a flagged gap into it, break when
`d > 4·cadence`. Because the coarse history always **precedes** the fine live tail chronologically, a
causal EWMA stays coarse through all of the history and only sharpens in the tail — so neither regime
is ever shattered, and it stays correct as the live feed grows past the history in volume. Verified by
sampling the canvas' non-transparent pixels before/after across old + recent windows. Refs:
`webapp/src/components/TimeSeries.tsx` (`gapAware`), [spec 0013 §6](2026-07-24-0013-wind-webapp-ux.md).

## 2026-07-24 — Météo-France DPObs: a swallowed 429 silently drops data, and its units aren't the bulk files'

**Finding.** Two gotchas surfaced building the wind layer (spec 0012). **(1) Rate limit.** The
DPObs 6-min endpoint serves one observation per `(station, date)` call, so backfilling a window
means N calls; the account caps at **100 req/min**. Seeding 3 stations × 60 points = 180 rapid
calls, and the first cut treated *any* non-200 as "no data" (`return None`) — so the 429s from
the burst were **silently swallowed**: Socoa (first) got 60 points, Biarritz 43, Cap-Ferret
(last) **0**, and an all-null station looked like "no 6-min data here" when it was pure
throttling (Cap-Ferret returns 29/30 when asked calmly). **(2) Units.** The DPObs 6-min CSV is
**not** in the same units as the hourly bulk files: `t` is **Kelvin** (297.55 → 24.4 °C), `pmer`
/`pres` are **Pascals** (101260 → 1012.6 hPa), and the gust is `raf10`/`ddraf10` (10-min max),
not the hourly `FXI`. Taking them at face value would show 297° "air temperature".

**Why it matters.** A silently-swallowed 429 is the quiet-failure trap the 2026-07-13 entry
warns about, one API up: no error, just missing rows that read as a real data gap. And mixing a
Kelvin/Pascal live feed into a °C/hPa schema corrupts the tier without any parse error.

**Resolution.** `_dpobs_row` now **retries 429/5xx with backoff** (honours `Retry-After`) and
only maps 200→rows / 204→None / 401-403→raise; a 0.1 s pace between calls keeps bursts clear of
the cap. `_canon6` converts K→°C and Pa→hPa on the way in. Auth is the **`apikey` header** (the
swagger says OAuth2 implicit, but the portal accepts the application key directly). Refs:
`ingest/wind.py`, [spec 0012](2026-07-24-0012-wind.md) §2.1/§2.3.

## 2026-07-13 — an HF Xet outage hung the refresh; a hang with no stack is the real bug

**Finding.** The `*/30` refresh failed, then **hung for 20+ min** (CI and locally). It looked
like our code; it wasn't. Hugging Face's **Xet CAS bridge** (`cas-bridge.xethub.hf.co`, where
every `…/resolve/<key>` 302-redirects) started refusing public content with **`403
AccessDenied`** — control test: a parquet in the public `rajpurkar/squad` dataset 403'd too,
while its non-Xet `README.md` still served `200`. Our bucket was `private: false` throughout,
and even *authenticated* reads 403'd. During the same window `huggingface.co` reset
connections mid-handshake. Note the asymmetry that made this confusing: the **Python client
kept working** (it speaks the Xet protocol directly, not the CAS-bridge redirect), so ingest
could still pull and push while **the webapp read path was dead** — olatu.io served no data.

**Why it matters.** Three latent weaknesses turned an upstream blip into a stopped pipeline:
(1) `_post_with_retry` retried *status codes* only, so the reset raised straight out of the
first call (the OIDC exchange) and killed all three buoys before any work started;
(2) nothing bounded a network step, so a stalled read hung **forever** — and since the cron's
`concurrency` group is `cancel-in-progress: false`, that one wedged run **queued every
subsequent refresh behind it**, silently stopping the data pipeline (the GH job's 6h default
timeout is no backstop at a 30-min cadence);
(3) the interrupted pull left **0-byte archive CSVs**, which `pull()` could never repair —
it skipped the archive sync whenever *any* `*_arch.csv` existed — so every later run died in
polars on a bare `NoDataError: empty CSV` naming neither the file nor the fix.

The deeper lesson is (2): a crash tells you where it broke, **a hang tells you nothing**. The
log simply stopped at `↓ pull`, which is why this cost hours instead of minutes.

**Resolution.** Retry transport faults (reset/timeout), not just 5xx — see
`update._post_with_retry` and `update._net`, which wraps *every* bucket call in a named
retry + a watchdog. `ui.watchdog` bounds each network step (`OLATU_NET_TIMEOUT`, default
600s) and, on expiry, **dumps every thread's stack and aborts** — the top frame names the
stuck call, so the next outage is readable straight from the log. `timeout-minutes: 15` on
the CI job keeps a hang from wedging the queue. `pull()` now deletes and re-fetches truncated
archives (careful: deleting without forcing the re-sync silently drops those years from the
build — a *quieter* bug than the crash it replaced), and `build._read_raw_csv` names the file
and the remedy. Nothing corrupt reached the bucket: the run hung before `build`.

---

## 2026-06-30 — public HF **buckets** now serve the browser too (CORS + range); store moved bucket-ward

**Finding.** The 2026-06-28 entry below concluded buckets had "no public browser URL".
That is now obsolete: HF shipped **S3-compatible Storage Buckets**, and a *public* bucket
exposes `https://huggingface.co/buckets/<ns>/<name>/resolve/<key>` — verified empirically
against the GH Pages origin: anonymous GET `200`, `Range` → `206` with `content-range`,
`access-control-allow-origin: *`, a working CORS preflight, and a 302 to the same
`*.cdn.hf.co` edge as dataset repos. The S3 *API* (`s3.hf.co`) still needs SigV4
(anonymous GET → `403 "Signature is required"`), so it is write-only for us; reads are a
plain `fetch` of the resolve URL — no S3 client.

**Why it matters.** It removes the only reason the data was a dataset repo. Buckets are
mutable (overwrite-in-place), so the `*/30` refresh no longer bloats git history with
every parquet version. The trade-off is buckets are **non-versioned** — no rollback for
the forward-only reel — so `update.snapshot_reel` keeps dated daily reel backups (14-day
retention). OIDC Trusted Publishers support buckets, so CI auth only changes its exchange
`resource` (`datasets/…` → `buckets/…`).

**Resolution.** Store → bucket `hadim/olatu` (same per-campaign layout); existing data
carried over server-side (`HfApi.copy_files`, reels verified byte-for-byte); ingest
pull/upload now use the `huggingface_hub` bucket API (`sync_bucket`/`batch_bucket_files`);
webapp `DATA_ROOT` drops the `datasets/…/main` prefix for `buckets/…/resolve/`. Supersedes
the 2026-06-28 finding below. See [0004](2026-06-27-0004-realtime-scraper.md) Revision 2026-06-30.

---

## 2026-06-28 — Paraglide lowercases message keys; use snake_case from the start

**Finding.** Migrating i18n to **Paraglide JS v2** (spec 0006), the first pass kept the
old dot-keys naively snaked to camelCase (`cc.waveHeight` → `cc_waveHeight`). The
messageFormat plugin **lowercases identifiers** and de-duplicates collisions by appending
numeric suffixes — so `picker.mapLabel`/`picker.mapHint` compiled to
`picker_maplabel1`/`picker_maphint1`, and only **56 of 90** message files survived
(camelCase keys collided when lowercased and silently overwrote each other). Export names
became unpredictable, breaking `m.cc_waveHeight()` call sites.

**Why it matters.** Silent message loss + non-deterministic export names would have
shipped missing/empty strings. The fix is to author keys as **lowercase snake_case**
(`cc_wave_height`), which is Paraglide's own convention — then export name === JSON key,
deterministically (verified: 90 files, exact match).

**Resolution.** Regenerated `messages/{en,fr,es}.json` with a `camelCase→snake_case`
transform + a build-time collision assert. Static calls use `m.cc_wave_height()`; the
few dynamic keys use `m[`cc_${fresh}_help` as MessageKey]()`. The generated
`src/paraglide/` is gitignored and recompiled by the Vite plugin (and `npm run paraglide`
for standalone `tsc`). Refs: [0006](2026-06-28-0006-stack-migration-a11y.md) §5.

## 2026-06-28 — Tailwind v4 `@theme inline` keeps runtime theme-switching working

**Finding.** The canvas charts, inline SVG tints, MapLibre markers and `iconSvg()` read
the **raw CSS variables** (`--accent`, `--c-height`, `--text-3`…) and switch via
`[data-theme]`. A naive Tailwind v4 `@theme { --color-bg: #… }` would freeze those at
build time and break the dark/light toggle for utility-styled markup. Using
**`@theme inline { --color-bg: var(--bg) }`** makes utilities emit `var(--bg)` (a
reference, not a copy), so `bg-surface` stays theme-aware and the canvas keeps reading the
same raw vars. Consequence: components almost never need a `dark:` variant — the *token*
is theme-aware, so the whole dual-theme behaviour lives in ~40 lines of token defs.

**AA contrast.** The faint token `--text-3` failed WCAG AA for normal text (≈3.2–4.1 on
both themes). Nudged to `#7593a3` (dark) / `#566b78` (light) to clear 4.5 on every
surface, keeping it visibly secondary. The brand `--accent` (spec-chosen) is used for
large numbers / dots / borders (AA-large/UI thresholds) and is left as-is. Refs:
[0006](2026-06-28-0006-stack-migration-a11y.md) §3/§6.

## 2026-06-28 — HF **datasets** serve the browser (CORS + range); **buckets** don't (yet)

> **Superseded 2026-06-30** — public buckets now serve the browser too (CORS + range);
> the store moved to a bucket. See the 2026-06-30 entry above. Kept for the history.

**Finding.** To get the churning data off git (a 30-min refresh would otherwise bloat
history with binary parquets), we moved all data to Hugging Face. The owner's instinct
was a **bucket** (`hadim/olatu`). But buckets are *working storage*: access is only via
`hf://`/mount/CLI/Python — "S3 API not supported", **no public browser URL**. A static
webapp needs a public HTTPS URL with **CORS** (hyparquet also wants range). Verified
empirically that a **dataset** `resolve/main/...` URL returns `200/206` with
`access-control-allow-origin` echoing the GH Pages origin and `accept-ranges: bytes` —
so datasets are browser-fetchable, buckets are not. HF's own docs say exactly this:
"promote final artifacts to a dataset for consumers." Trusted-publisher **OIDC supports
both** (`resource: datasets/…` or `buckets/…`), so CI auth doesn't force the choice.

**Why it matters.** It flips the data-ops design: the webapp reads tiers **at runtime**
from the dataset, so the every-30-min job is Python-only (pull → scrape → build →
upload) and **never rebuilds/redeploys the site**. The repo becomes code-only; foundation
§5.3's git-churn risk is dissolved. Keyless via OIDC — no `HF_TOKEN` secret.

**Resolution.** Data → dataset `hadim/olatu`, campaign-prefixed (`06403/raw`, `06403/data`).
`ingest/update.py` orchestrates it (OIDC token exchange for CI); webapp `DATA_BASE`
points at the dataset; `.github/workflows/refresh-data.yml` runs `*/30`. Switch `raw/`
to a bucket if/when bucket browser access lands. See [0004](2026-06-27-0004-realtime-scraper.md) §3/§6.

**Refs.** `ingest/update.py`; `webapp/src/lib/data.ts` (`DATA_BASE`); `.github/workflows/refresh-data.yml`.

---

## 2026-06-27 — The CANDHIS realtime "browser table" *is* the API (one GET, no Valider/POST)

**Finding.** `campagne.php` looks hostile to automate — PHP, a campaign must be
"selected", and the UI tells you to click **Valider** then **Télécharger**. None of
that is needed for realtime. Reverse-engineered live with a browser + a cold `httpx`
client: (1) the campaign is chosen by a **base64 query string**, not a session POST —
`campagne.php?Y2FtcD0wNjQwMw==` is literally `base64("camp=06403")`; (2) that single GET
**server-renders the full last-~48 h realtime table in the HTML** (≈97 rows incl.
`Temp. mer`), with no cookies/session priming; (3) the `Valider`→`Télécharger` dance
belongs to the *Archives* date-range CSV export (`?datA=YYYY-MM-DD+YYYY-MM-DD`), and the
form's `BtnTeleReel`/`BtnTeleArch` buttons have no JS — a bare POST just re-renders the
page; (4) the HTML values are **lossless** vs. the CSV (realtime is quantized — H 0.1 m,
period 0.1 s, dir 1°, temp 0.1 °C — so `0.6` == `0.6000`).

**Why it matters.** The whole "live-growing tail" (0001 §2.4) — and therefore *all*
sea-temperature history — hinges on automating this page. It turns out to be a trivial
`GET` + table parse, not a fragile multi-step form/session scrape.

**Resolution.** Built `ingest/scrape.py` (`pixi run scrape` / `pixi run update`): GET the
base64 URL → parse the HTML table → coalesce-merge into per-year `Candhis_06403_<YEAR>_reel.csv`.
Also hardened `build.py assemble()` from realtime-last-wins to **archive-preferred
column coalesce**, so accumulated realtime never clobbers the archive's rich/QC'd columns
once they overlap. Full design + safety rules in
[0004 — Realtime scraper](2026-06-27-0004-realtime-scraper.md).

**Refs.** `ingest/scrape.py`; `ingest/build.py` (`assemble`); spec 0004.

---

## 2026-06-27 — uPlot places ticks in the *browser's* timezone unless you set `tzDate`

**Finding.** Our axis tick labels are formatted via `Intl.DateTimeFormat({timeZone:
'Europe/Paris'})`, but uPlot chooses *where* to put ticks (the split instants) using
the **browser's** local timezone by default. For a viewer already in Paris (or in our
test env) the two agree and labels look round (`00:00`, `06:00`). For a viewer in
another zone, ticks land on *their* local midnights but get *labelled* in Paris time →
non-round labels (`01:30`, `07:30`).

**Why it matters.** Times across the app are deliberately shown in the buoy's local
zone (Europe/Paris), not the visitor's. The axis is the one place where uPlot's own
split logic could leak the visitor's zone and desync from our labels.

**Resolution.** Set `opts.tzDate = (ts) => uPlot.tzDate(new Date(ts * 1000), tz)` so
uPlot computes splits in Europe/Paris for everyone. Also added a small `◷ Europe/Paris`
label on the hover card so the display zone is explicit. (Decision confirmed with the
owner: keep buoy-local time, not the visitor's.)

**Refs.** `webapp/src/components/TimeSeries.tsx` (uPlot opts `tzDate`).

---

## 2026-06-27 — Realtime CSV `Date` column is UTC (verified empirically)

**Finding.** The CANDHIS realtime export (`Candhis_06403_YYYY-MM-DD_reel.csv`) has a
single combined `Date` column (`2026-06-27 16:00:00`), **not** a separate `Heure (TU)`
field as the data dictionary claimed. Its values are **UTC**: a file downloaded at
18:34 CEST (16:34 UTC) had its newest row at `16:00:00` — ~34 min old in UTC, whereas
a local-Paris reading would have made the newest row ~2.5 h stale, which a live
"rolling 48 h" feed never is. Cross-checked in the app: a December daily bucket
(`00:00 UTC`) renders as `01:00` in the hover card (Europe/Paris = CET = UTC+1).

**Why it matters.** If the realtime `Date` were misread as local time, every live
reading + the staleness/age + the merged tail would be shifted +1/+2 h. The owner
flagged the doubt; confirming it closes a whole class of silent tz bugs.

**Resolution.** No code change — `REEL_MAP` already maps `Date → datetime_utc` as-is
and the frontend renders Europe/Paris via `Intl`. Corrected the wrong "splits Date +
`Heure (TU)`" note in [0002 §4.1](2026-06-27-0002-data-dictionary.md).

**Refs.** `ingest/schema.py` (`REEL_MAP`); `webapp/src/lib/format.ts`.

---

## 2026-06-27 — GitHub Pages gzips `.parquet`, which breaks HTTP range requests

**Finding.** GitHub Pages (Fastly) compresses `application/octet-stream` responses
with gzip when the browser sends `Accept-Encoding: gzip` (browsers always do), and
serves byte-ranges **against the compressed stream**. A ranged GET returns `206` with
`content-encoding: gzip` and a `content-range` total equal to the *gzipped* size
(e.g. `…/183086`) rather than the raw size (`221437`). `curl` without the header sees
no gzip, which is why a naive check looks fine.

**Why it matters.** hyparquet's `asyncBufferFromUrl` computes row-group/footer offsets
against the *raw* file and fetches them via ranges. Against gzipped ranges those
offsets are wrong → `parquet file invalid (footer != PAR1)` → the charts hung on
"loading". It worked locally because `vite preview` doesn't gzip. **This defeats the
whole "multi-row-group + range requests + column projection" optimization on GH
Pages** — you cannot control Pages' content-encoding.

**Resolution.** Fetch the **whole** Parquet file as an `ArrayBuffer`
(`fetch().arrayBuffer()` — the browser transparently decompresses gzip) and hand it
to hyparquet, which reads from memory. Column projection still applies in-memory (CPU,
not network). Tiers are sized to make this cheap (daily/hourly small; per-year ~1.5 MB,
gzipped in transit + browser-cached). Reproduced both failure (range) and fix
(whole-file) against the live URL before deploying.

**Spec impact.** Supersedes the range-request parts of
[0001 §5.1/§5.2](2026-06-27-0001-foundation.md#5-data-pipeline--storage-strategy):
keep Snappy + multi-row-group (harmless, good file hygiene) but **do not** rely on
range requests for loading; always fetch whole files. Revisit only if we put a CDN
(e.g. Cloudflare) in front that lets us disable gzip on `.parquet`.

**Refs.** `webapp/src/lib/parquet.ts`; commit `fdbd4a3`.

---

## 2026-06-27 — `vite-plugin-static-copy` v4 changed glob semantics; serve data from `public/`

**Finding.** After bumping `vite-plugin-static-copy` 3 → 4, copying `../data/*` into
the build produced a nested `dist/data/data/` and silently dropped the `year/`
subdirectory (only 5 of 6 items copied).

**Why it matters.** The per-year Parquet files were missing from the build with no
error — a silent data loss that only shows up at runtime.

**Resolution.** Dropped the plugin entirely and moved the generated tiers to
`webapp/public/data/`, which Vite serves natively in both dev and build (no plugin,
works under the `/olatu/` base). Ingest `--out` default updated accordingly.

**Spec impact.** Matches the `webapp/public/data` path already specified in
[0001 §5.1](2026-06-27-0001-foundation.md). **Refs.** `webapp/vite.config.js`; commit `746ee7a`.

---

## 2026-06-27 — `.gitignore`'s Python `lib/` pattern hid `webapp/src/lib/`

**Finding.** The inherited Python `.gitignore` had a generic `lib/` rule, which
matched the new frontend `webapp/src/lib/` and excluded the entire i18n/theme/data
layer from commits (no warning).

**Why it matters.** A whole code directory would have been missing from the repo /
deploy. Caught via `git status` showing the components but not `lib/`.

**Resolution.** Removed the stale `lib/` and `lib64/` Python-packaging patterns.
**Refs.** commit `440a7b6`.

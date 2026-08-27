# History — what's shipped

Reverse-chronological log of shipped milestones (newest first). Each entry summarizes
**what a spec became in the code** and the few implementation facts worth remembering later.

**This file is the append target, not CLAUDE.md.** When you ship something, add a dated
entry here — keep CLAUDE.md a stable operating manual. Intent & decisions live in
[`specs/`](../specs/); non-obvious findings in [`specs/LEARNINGS.md`](../specs/LEARNINGS.md).

---

## 2026-08-27 — The charts follow the clock again (spec 0019 §8)

Owner report: *"quand la page démarre sur l'ancien data et s'update, ça met bien à jour les data
actuel mais pas les time series — l'heure actuelle n'est pas le point x le plus à droite des plots"*.

A side effect of painting from the cache. `TimeSeries` seeds its x-window from `TN` (the latest
reading) **at mount** — which used to mean "on fresh data", and now means "on data as old as your
last visit". Nothing reacted when `TN` advanced afterwards, so the window, and the in-memory
per-year tile caches behind it, stayed pinned to the instant the stack was mounted with. Current
Conditions was right because it is re-derived from `latest` on every render.

- **The window follows the latest reading** when it was sitting on it, and only then — a window the
  user panned to stays exactly where they put it, and `⟲ Reset` keeps pointing at the window it was
  pointing at rather than the one it was pinned to.
- **The current year's tile cache is dropped when `TN` crosses it**, so the finer tier actually
  refetches. Older years never grow, so they are kept. Without this the axis reached "now" over a
  line that stopped where the last visit did.
- **`swrBuffer` may not say "unchanged, keep what you have" before the caller has it.** The stale
  parquet decode is async while the hash comparison is instant, so a fast network resolved the
  unchanged sentinel first and the caller kept *nothing* — the charts fell back to the coarse daily
  tier. `loadParquetTierFrom` and `loadTidesForManifest` now await the stale paint before returning
  it. This fired on the most ordinary action there is: reloading twice inside one build window.

Verified in Chromium against the live bucket by rewinding `manifest.span.end` 3 h on the first load
and releasing it on the next refresh: the window advances by exactly 3 h and both year tiles
refetch; parked on an older window it does not move; without the fix neither happens.

---

## 2026-08-25 — Instant load: local tier cache + visible progress (spec 0019)

Owner report: *"quand je charge la page, il y a toujours un petit temps d'attente avant de voir les
données"* — plus the question behind it: why re-fetch what the browser already had?

**Stale-while-revalidate over an IndexedDB byte cache.** Every tier body is stored keyed by its URL
(`webapp/src/lib/cache.ts`); on load the cached copy paints immediately while the network copy is
fetched in parallel (`lib/swr.ts`), then replaces it in place — or, when the bytes are identical
(the usual case between two 30-min refreshes), **nothing re-renders at all**. Bytes, not parsed
arrays: the parse costs milliseconds, and byte-comparability is what makes the "unchanged → don't
rebuild every uPlot" shortcut possible.

Measured against a local mock bucket at 600 ms/tier: real data on screen at **~250 ms warm** vs
~900 ms cold, with Current Conditions *and* seven plots already drawn at +250 ms. With the backend
returning 503 the page still comes up complete, from the cache.

**One widget for the wait** (`components/DataStatus.tsx`, fed by the `lib/progress.ts` store every
fetch registers with): a 3 px rail across the top plus a pill — determinate *"Loading data… 45 %"*
on a cold load, a discreet *"Refreshing…"* (delayed 500 ms) on a warm one, *"Data updated"* for
2.2 s only when a refresh that started with data on screen actually changed something, and
*"Could not refresh — showing your saved data"* when the network fails with a page already painted.
`error` (nothing to show) and `refreshError` (showing saved data) are now different states.

Three ordering rules cost real debugging and are written into the spec: an offline 503 answers
*before* IndexedDB does, so the eager group uses `allSettled` (with `Promise.all` the rejection beat
the cached paint and blanked the page in exactly the case the cache exists for); a late stale
*decode* may only be suppressed when a fresh copy actually replaces it; and a partially-cached set
never paints (an old manifest with a new `latest` is worse than waiting).

The Workbox NetworkFirst policy for the tiers (spec 0010) is unchanged — it is invisible to the app,
so the app owns its own cache. See [0019](../specs/2026-08-25-0019-instant-load-cache.md).

---

## 2026-08-24 — Precipitation: window & aggregation (spec 0018)

Owner question: *"la pluie en mm correspond à des cumuls sur quelle fenêtre ?"* — the honest answer
was **two windows, and neither was aggregated correctly**.

`precipitation_mm` is the only **accumulation** in an otherwise all-*state* schema, and it had been
ingested as if it were a state:

- **Two windows in one column.** History = `RR1` (hourly bulk, 1 h); live = `rr_per` (DPObs 6-min,
  **6 min**). The series dropped ~10x at the 2026-07-24 seam for no meteorological reason, and the
  Current Conditions tile printed the rain of *the last 6 minutes* labelled "mm" — which is why it
  read 0,0 almost always.
- **`_downsample` averaged a total.** Measured on Socoa: 2026-02-16 took **51.2 mm** and
  `daily.parquet` said **2.13 mm** (÷24); in the live era 0.80 mm became 0.0034 mm (÷236). The
  divisor changed at the seam, so even relative comparisons were false.

**The stamping convention was probed, not assumed.** Météo-France's field descriptor says only
*"RR1 : quantité de précipitation tombée en 1 heure"* (while `T` is explicitly *"instantanée"*) and
never says which hour. Cross-checking the hourly feed against the 6-min feed over a rainy evening at
Socoa (2026-08-23) matched `(H-1h, H]` **exactly on all seven hours** and `[H, H+1h)` on none:
both feeds are **end-stamped**.

**The fix** (`ingest/wind.py`, `schema.WIND_ACCUM_VARS`):

- Rain **sums**; states keep mean / circular mean. The accumulation bucket is **right-closed,
  left-labelled** (`(t, t+every]` labelled `t`) — given end-stamping that is *exact* for both
  layers, verified against the raw: 49.4 mm for 2026-02-16 (the end-stamped day), 0.6 mm for the
  22:00 hour of 2026-08-14, and the hourly bucket at `t` equals the `RR1` stamped `t+1h`.
- The **native tier carries a trailing-hour total**, computed **per layer before the coalesce** (a
  window spanning the seam would hold an hourly `RR1` *and* the 6-min readings it already contains).
  In the history era the window holds exactly one row, so the value is unchanged; in the live era it
  is the ten-reading sum. Native and hourly now agree exactly at `:00` — 6.9 / 12.1 / 2.7 mm on
  2026-08-09 — so zooming never moves the rain.
- `sum()` of nothing is `0.0` in polars, which would print "0 mm, it stayed dry" over a gap. Both
  the bucket sum and the rolling sum keep an **all-null window null**.
- **Unit is tier-aware** (spec 0018 §3.3): **mm/h** on Current Conditions + the native/hourly panel,
  **mm/24h** on the daily one. `mm/24h` rather than a localised "mm/j" — same string in EN/FR/ES,
  and it says the window out loud. Glossary (`def_rain`) now names the window instead of the useless
  "over the interval".

`build_station` re-emits every tier from the immutable `raw/` accumulators, so `pixi run wind --all`
was enough — no history re-fetch. Daily rain values change by ~24x; that is the fix, not a
regression.

---

## 2026-08-21 — Freshness per realm (spec 0015 §7)

Reported by the owner: "la bouée de Anglet et Saint Jean donne plus de news depuis 5 heures — c'est
bien la bouée elle-même et pas le site ?"

**It was upstream.** CANDHIS froze at 2026-08-21 01:00 UTC on **all three** buoys at once (06403,
06402, 03302 — 300 km apart, same minute), so the buoys were fine and so were we: the 05:44 UTC
cron ran green, scraped 97 valid rows, and printed its own alarm, `newest timestamp did not
advance (2026-08-21 01:00:00); feed may be stale`. `campagne.php` still served a complete 48 h
window with no holes in it; the window just stopped moving. The scraper's never-shrink + coalesce
guarantees meant there was nothing to fix or replay.

**What the incident did expose was a UI bug.** With the buoy 5 h behind and the Socoa station 14 min
behind, the card showed one badge (buoy-fed) reading "5 hours ago" over both zones, and fired
`saturate-[0.55]` on the *card*, greying out the Air zone as well — with no timestamp of its own to
argue back. The freshest data on the page rendered as the deadest.

- **The badge moved into each `ZoneHeader`.** Mer reads `latestTimestamp(latest)`, Air reads
  `latestTimestamp(wind.latest)`; the header row keeps identity + the offshore/onshore verdict and
  loses its badge. Since 0012/0013 this card has shown two unrelated feeds (CANDHIS 30 min via HTML
  scrape, Météo-France 6 min via DPObs) that fail independently — one badge could only ever be
  right about one of them.
- **Desaturation is per zone.** A frozen buoy no longer makes a healthy station look dead.
- **Thresholds unchanged (2 h / 6 h), explanations split.** `cc_{fresh,aging,stale}_help` went
  source-agnostic and a new `cc_cadence_{sea,air}` line carries the rhythm that makes an age
  legible. Both badges are realm-qualified for screen readers (`Reading freshness · Air`).
- `ZoneHeader`'s badge slot uses `min-[720px]:ml-auto`, not `ml-auto` — below 720 px the header
  centres (0017) and an auto margin would break it; the badge wraps to its own centred line.

Display-only: both timestamps were already loaded, so no tier, manifest or ingest change.

## 2026-08-16 — Tide coefficient, beside the marnage (spec 0008 §11)

Owner request: keep the marnage as the primary amplitude metric, but print the French *coefficient
de marée* next to it — "y a des users qui aiment bien l'avoir". Spec 0008 decision 2 had ruled it
out; the premise expired.

- **We don't compute it — api-maree.fr now serves it.** The API grew a `/tide-extrema` endpoint
  returning PM/BM *with* the coefficient on each high tide. It also does in **one** request what
  `/water-levels` needed six chunked 1440-point ones for, so the ingest step switched over wholesale:
  `fetch_water_levels` + `find_extrema` (the slope-test/parabolic peak detection ported from
  `wave-monitor`) are gone — same heights, times within ±2 min, a sixth of the quota.
- **Validated ±1 against maree.info's Brest calendar** over 11 days, and identical across `brest`,
  `saint-jean-de-luz` and `cap-ferret` — as a Brest-referenced *national* index must be. A second
  site (horaire-maree.fr) is off by up to 6; see LEARNINGS before "fixing" a coefficient.
- **Secondary by construction.** The tier gained a nullable `c` on high-tide rows; the banner prints
  `Marnage 3,5 m · coef. 90` (small, muted, with a popover explaining the Brest reference) and the
  calendar puts it on the day summary + against each PM, tide-table style. It never drives the
  neap↔spring gauge, the hue or the magnitude word — metres measure the water *here*.
- **Nulls are normal:** BM rows, and every accumulator row older than the API's rolling J±30 window
  (they can't be backfilled). The webapp reads the tier **without a column projection** so a tier
  ingest hasn't republished yet still renders.
- **`pixi run update --force-tides`** (new) fetches past the horizon gate — a stateless "how far
  ahead are we" check that would otherwise delay a tier *schema* change by ~10 days.

## 2026-08-10 — The phone gets its width back (spec 0017)

Owner feedback from a phone, on every surface at once. Webapp-only; desktop is a superset of the
phone layout, not a second UI.

- **Width.** Three nested paddings (page `px-5` + card `px-5` + zone `p-3.5`) ate ~18 % of a 390 px
  screen before a single value. Now only the page shell pays for the screen edge: cards and zones
  shrink their padding below 640 px, and the chart host's padding became **`--ts-pad`** — the day
  overlay, the reorder drop line and the `.ts-band` gutter all position against it, so it can only
  be changed in one place. ~48 px back, ~12 % more plot width.
- **Centred below 720 px.** Under a centred dial, the Sea tiles fell to *one* left-hugging column.
  They now stay two columns to the narrowest phone and centre their content, as do the Air zone and
  the tide strip. (0015's left-alignment rule now reads "from 720 px up".) `text-center` only —
  `justify-items-center` would shrink-wrap a `@container` tile and collapse the `cqw` type scale.
- **Chart controls, re-laid-out — nothing removed.** Twelve range chips at 44 px wrapped to three
  rows; they are now one horizontally-scrollable line (still wrapping from `md` up). The navigator
  stays visible (and square at 44 px, it was a 28 px-wide sliver); smoothing + jump-to-date fold
  behind a phone-only **⚙ Options** disclosure. Panels shrink 124 → 100 px below 560 px (~180 px off
  the stack), re-derived on resize.
- **The readout is a table, not a run of chips.** Each reading is `icon · LABEL` left + value
  **right-aligned** on a hairline, grouped under **Sea** / **Air** headings — a wrapped label can no
  longer shove its value out of line, and the two temperatures/directions stop being confusable.
- **Hover really is synced now.** `setCursor` only refreshed the card from *buoy* panels, so hovering
  wind, tide, humidity or pressure moved every crosshair while the card kept the previous instant.
  Every panel drives it; panels on their own x-grid map cursor → time → nearest buoy index. Renders
  are deduped by index (one write per move, not one per panel).
- The pinned touch bar gained the core values beside the timestamp (0016 gave it the stamp only).

Two real bugs found while measuring, both pre-existing:

- **Panels were built ~2·padding too wide.** `host.clientWidth` includes padding, so every plot
  overflowed its wrapper and the right edge of the x-axis was silently clipped by `overflow-hidden`.
- **`<table class="sr-only">` doesn't hide.** A table treats `width: 1px` as a *minimum*, so the
  visually-hidden summary was ~420 px wide and gave a 390 px phone 27 px of phantom horizontal
  scroll. The class belongs on a wrapper `<div>`.
- The history ribbon was a scroll trap too (`touch-none` on the track) — it now uses 0016's model:
  `pan-y` + an axis-lock, capturing the pointer only once the gesture commits to horizontal.

---

## 2026-08-07 — The charts stop trapping your finger (spec 0016)

Two owner reports from a phone, both on the chart stack.

- **Scroll trap, fixed.** Every panel `preventDefault()`ed *every* one-finger `touchmove` to pan the
  x-scale, and none set `touch-action` — so a finger anywhere over the charts could not scroll the
  page, and the stack is ~1700 px tall at 390 px wide. Now `touch-action: pan-y` hands vertical
  panning back to the **browser** (native momentum + rubber-banding, which JS can't match) and a JS
  axis-lock (8 px) decides on the first real move whose gesture it is. Belt and braces on purpose:
  engines cancel our touches at different moments, and a diagonal scroll would otherwise jitter the
  cursor on its way past. Under the threshold, a tap stays a tap.
- **One finger now reads instead of panning.** A horizontal drag scrubs the cursor along the series;
  pan/zoom moved to two fingers (and is still on `‹ ›`, the range chips and the history ribbon).
  Reading was the worse-served of the two — it used to be tap-only, one value at a time.
- **A pinned readout bar** carries the scrubbed date/time, **fixed to the viewport** (anything
  anchored inside the section scrolls away from the panel you're touching) and **kept after you lift
  your finger** — the values under a finger are only readable once the finger is gone. ✕ dismisses it
  and drops the cursor everywhere. It carries the timestamp only: the 338 px hover card would eat
  ~40 % of a phone screen, and the values are already on-plot in each panel's bubble.
- The card's default hint branches on `(hover: none)` — "Hover the chart" is false on a phone.
- Desktop is untouched: mouse drag-zoom, double-click reset, hover card and cursor bubbles behave
  exactly as before, and the bar is only ever raised by a touch scrub.

---

## 2026-08-07 — Current Conditions density pass (spec 0015)

Owner feedback on the two realtime blocks: they read well but the surface is empty. Webapp-only
layout work — same ten readings, same scan path, **~36 % less height** (two zones from ~630 px to
~400 px at a 1171 px viewport, which puts the tide strip above the fold on a laptop).

- **The dial stopped repeating itself.** It shrank 176 → 128 px and its centre (`N` / `355°`) is
  now the only place those two appear; the old three-line caption below it ("Swell direction /
  from N · 355° / Spread ±28°") is one label line plus the realm's second direction fact.
- **One `Metric` tile for every reading**, in a grid that fills edge to edge: Mer **4-up**, Air
  **6-up**. The Air zone's old second row was capped at `max-w-[22rem]`, so half of it was blank;
  an intermediate 3-up Air row was tried and discarded — over-wide columns just move the
  emptiness between the values. The wave-height hero is now a type-size variant, not a separate
  block, so both zones share one rhythm.
- **The cross-shore verdict moved into the header row** (title · verdict · freshness), freeing a
  full-width band that held three tokens.
- Six-up needs `cc_air_temp_short` / `cc_sea_temp_short` ("Temp. air" / "Temp. mer") — the full
  names stay in the popover title. Tiles are left-aligned at every width (the old under-720 px
  centring reads as misalignment in a 2-column phone grid).
- **The type scales with the tile, not the viewport** — second round of owner feedback: the block
  was shorter but a ~190px Mer cell still held a 25px number, so it still read empty. Each tile is a
  `@container` and its value is sized in `cqw`. Viewport units can't do it: the page is capped at
  `max-w-[1100px]`, so past ~1140px a `vw` number stops tracking its box, and a Mer cell (187px) and
  an Air cell (121px) would get the same size regardless. Mer values went 25 → 37px (hero 56px) with
  no extra zone height; the `clamp` bounds come from the widest non-wrapping string per zone
  ("1 020 hPa" sets Air's floor). Verified no overflow at 390 · 880 · 1100 · 1400px.
- **Values align via `subgrid`** (tile spans two rows of its zone grid, label `self-start`, value
  `self-end`) instead of a `min-h` reserving a blank line on the label — the reserve cost height in
  the common case where nothing wraps. `self-end` is what puts the hero and the smaller Mer values
  on one baseline. Both `@container` and `subgrid` are Baseline 2023 and degrade gracefully.
- The tile label is **inline flow, not flex**: in a flex row the text claims the whole line box, so
  a wrapped label shoved its `i` badge to the far right where it looked orphaned.
- **Micro-trends were built, then rejected.** A 24 h sparkline + 3 h delta + 24 h range per tile
  (off the already-loaded `recent.json`, plus `loadWindRecent` for the station) roughly tripled the
  facts per pixel; the owner's call was **too much information — keep it real-time**. See spec 0015
  §3: this card answers "what now", the chart stack below answers "how did it get there". Nothing
  of it was kept.

---

## 2026-08-02 — Bucket swept of two migrations' orphans (specs 0004 §6, 0008 §8.2)

Housekeeping only — no code, no pipeline change. Two past tier migrations left keys behind
because `sync_bucket` runs with `delete` off (deliberately: a partial upload must never prune
live tiers). Both specs had flagged the cleanup as a manual one-time job; it's now done.

- **Deleted 5 keys, ~7.3 MB**, all stamped 2026-07-05: `data/hourly.parquet` for each of the
  three campaigns (superseded by per-year `data/hourly/<campaign>_YYYY.parquet`), plus
  `06402/data/tides.json` and `06402/raw/06402_tides.csv` (superseded by the port-keyed
  `tides/<port>/` root — Anglet was the only buoy that ever produced them, since the other two
  had invalid site guesses).
- **Checked unreferenced before deleting**, not just unused-looking: every `manifest.json` now
  carries `tiers` = `latest`/`recent`/`daily` only — no `hourly`, no `tides` pointer — and no
  `webapp/` or `ingest/` code path reads either key. The local `hfdata/` mirror doesn't hold
  them either, so the next `update` won't re-upload them.
- **The rest of the bucket audited clean**: no pre-0009 flat `<campaign>/` prefixes survive (the
  `migrate delete` did land), reel backups sit at 15 dated folders per buoy matching
  `REEL_BACKUP_RETENTION_DAYS = 14`, and the other old-timestamped files are meant to be old —
  the `Candhis_*_arch.csv` archives and the one-shot `wind/*/raw/*_hist.csv` seeds.

## 2026-08-01 — A tide calendar, and a 24 h/12 h clock switch (specs 0008 §10, 0014 §6)

Two owner requests, both pure front-end — no ingest, no new data.

- **Tide calendar.** A small calendar button next to the live phase word in the banner opens a
  day-by-day view of the *same* extrema the strip already holds: a Monday-first month grid where
  each day carries a **marnage bar** (so the spring↔neap beat of the month reads at a glance),
  beside the selected day's tides (`▲/▼ · kind · time · height`), with the next tide highlighted
  and counting down. Navigation is **bounded by the data** — days outside the accumulator are
  disabled and a footer states the covered window, so "no predictions past 22 Aug" reads as a fact,
  not a bug.
- **Days are grouped in the buoy's zone, not UTC** (`zonedDayIndex`): a 23:40 UTC high tide is a
  next-day tide in Europe/Paris, and grouping on UTC days would file it under the wrong date.
- **Month-grid helpers were extracted** to `lib/calendar.ts` — the chart-range `DatePicker` had its
  own copy of `monthCells`/weekday labels; both now share one (and one `calendar` icon).
- **Clock format is now a setting** (Auto · 24 h · 12 h), a fourth field of the existing `Units`
  store under the same `olatu.units` key, so it needed no migration and reflows every time on the
  page at once — strip, sun, calendar, staleness badge, chart axis + hover. 24 h is
  `hourCycle: 'h23'`, **not** `hour12: false` (which renders midnight as `24:00` in some locales);
  the axis's midnight *probe* stays on a fixed h23 formatter, since it detects rather than displays.

## 2026-07-27 — The scraper stops failing on a quiet buoy (spec 0004 §5)

The refresh cron had been red on every run since 09:16 UTC, always the same line:
`✗ 03302: only 11 rows scraped (< 40); refusing to write`.

- **Cause was upstream, not ours.** Cap Ferret went silent 2026-07-25 13:30 → 2026-07-27 08:30 UTC.
  CANDHIS serves a rolling ~48 h window, so that window straddled the outage and held 11 rows where
  ~97 is normal — tripping `scrape.MIN_ROWS = 40`. Saint-Jean-de-Luz and Anglet refreshed fine
  throughout; only the overall exit code was red.
- **`MIN_ROWS` removed.** A row count cannot tell "the page is broken" from "the buoy is quiet", and
  only the first is actionable. It guarded nothing either: the merge is an additive coalesce under the
  never-shrink invariant, so a short scrape can't truncate the accumulator, and format breaks are caught
  by the structural checks. Meanwhile it *lost* data — the fresh rows were scraped and discarded on
  every run.
- **An empty table is now a no-op**, not an error: `validate_rows([])` returns an empty typed frame and
  `scrape()` warns and returns. Also removes a latent `ZeroDivisionError` in the plausible-range ratio.
- Verified end-to-end against the live 03302 feed: 1386 → 1392 rows merged, format breaks and junk pages
  still abort. See [LEARNINGS](../specs/LEARNINGS.md).

## 2026-07-25 — Panel reorder rebuilt on pointer events, and a readable readout (spec 0013 §7)

A second owner pass on the chart stack's hide/reorder affordance.

- **Reorder no longer scrolls you back to the top.** Rebuilding the stack destroys every uPlot, so the
  document briefly shrank and the browser clamped the scroll. The teardown now pins the host's height and
  the rebuild releases it **one frame later** — releasing it synchronously re-exposes a not-yet-laid-out
  (collapsed) stack, and a `scrollTo` against that stale layout is clamped away too.
  See [LEARNINGS](../specs/LEARNINGS.md).
- **Drag & drop rewritten on Pointer Events.** The HTML5 `draggable` version was **inert on touch** and
  only accepted the thin heading strip as a drop target. Now: mouse/pen/finger alike, the whole stack is
  the target, the dragged unit dims in place, a chip rides the pointer, an accent line marks the landing
  slot, the page auto-scrolls near the viewport edges, and `Escape` cancels.
- **A drag band per panel** — a full-height grab target in the chart host's left gutter (inside its
  padding, so no plot width is lost): a hairline at rest, firmer on stack hover, solid under the pointer.
  The heading grip stays as the accessible control and now moves a panel with **↑ / ↓**, keeping focus.
- **Air temperature gets its own rose** `--c-airtemp` — it was amber like the wind/gust series it sits
  next to. Realm is carried by zone/bar/tag, so the series hue is free (as for rain/humidity/pressure).
- **Bigger hover values:** readout values 0.84 → 0.98 rem in the foreground colour, its timestamp
  0.82 → 0.92 rem, on-plot cursor bubble 0.66 → 0.82 rem — plus **one timestamp riding the pointer**
  (snapped to the same grid index the readout reports), since the card scrolls out of view on a long stack.
- **The band is now the only reorder control** — the heading grip became redundant and went, semantics and
  all (`role=button`, ↑/↓, focus ring); band hover emphasis is **per panel**, not stack-wide.
- **Rain/spread stop clipping their zero:** the scale opens a sliver below 0 (axis filter hides the
  negative splits), so a dry-day flat line sits clear of the bottom edge with its `0` label intact.
- **Dependencies to latest**, including two majors — **maplibre-gl 6** (map, markers and controls verified
  in a browser) and **TypeScript 7** (which removed `baseUrl`; `paths` is now relative).

## 2026-07-25 — Wind UX polish + a units/settings modal (specs 0013 §6, 0014)

An owner-feedback pass on the wind surfaces, plus a real new capability — **display units**.

- **Fixed the "wind vanishes when I zoom into an older window" bug.** The chart's `gapAware` keyed its
  line-break threshold off the **global-minimum** cadence; the current-year wind file mixes a 6-min
  live tail with an hourly history, so every hourly step got flagged as a gap and the line shattered
  into invisible dots on the fine tier (the hourly-means tier at 1Y hid it). Now the cadence is a
  **causal EWMA of the normal deltas** — coarse history precedes the fine tail, so neither shatters.
  See [LEARNINGS](../specs/LEARNINGS.md).
- **Units & settings (spec 0014):** a header gear opens a small modal to choose **wind speed**
  (m/s · **km/h default** · kn), **temperature** (°C · °F, shared sea+air) and **pressure** (hPa · inHg
  · mmHg). `lib/units.tsx` (context + pure conversions keyed by column name) applies the choice
  everywhere — Current Conditions, every chart panel + heading unit tag, the hover readout — and
  persists it (`olatu.units`). Conversion happens at the last moment; the affine °C→°F commutes with
  the chart smoothing.
- **Direction is now a colour code on both realms:** the cyclical N teal · E blue · S gold · W pink hue
  applies to swell **and** wind direction (arrows, CC dial needle + coloured cardinals, a shared
  N/E/S/O legend on both direction panels). Realm stays carried by zone/bar/tag/values.
- **Hover readout gains the Air side** (wind, gust, wind direction, air temp — looked up by time on the
  station grid, so the two temperatures / directions are unmistakable) **plus an on-plot value bubble**
  on every panel that tracks the cursor.
- **Two more Air panels:** humidity + pressure (nullable, honest "not measured at this station").
- **Offshore/onshore verdict** moved to a banner **above** the two zones and **softened** (tinted pill,
  not a solid red block). **Sub-day presets** 2H · 6H · 12H (the range clamp relaxed to a 1-hour floor).
  **Wind stations on the map** (amber square markers). **Attribution:** Météo-France credited, the
  **Hugging Face open-data link removed**. The refresh workflow + docstring renamed (buoys · tides · wind).

## 2026-07-24 — Wind in the webapp: the Mer/Air realm system (spec 0013)

Surfaces the wind data (spec 0012) in the app around one visual axis: every datum belongs to a
**realm** — **Mer** (the buoy, offshore: swell, direction, sea temp — **teal**) or **Air** (the
paired station, onshore: wind, gust, air temp, rain — **amber `--c-wind`**, the one new token).
Colour **+** glyph, constant across all three surfaces, so "buoy" vs "station" reads at a glance.

- **Selection** — the existing collapsible station bar is **kept**; a new **amber station picker**
  (Radix popover) sits beside the teal buoy switcher. Default = the buoy manifest's `wind` pointer
  (nearest station); the user can pin any curated station, **persisted per buoy** (`olatu.station`).
  Honest attribution everywhere (name · distance · character · Météo-France), never "wind at the buoy".
- **Current conditions** — rebuilt into **two realm zones** (Mer, Air) joined by the one cross-realm
  **bridge**: the **offshore / onshore verdict** from station `wind_direction_deg` × buoy
  `peak_direction_deg` (`lib/wind.ts`; swell-relative approximation). The two temperatures are now
  unmistakable — sea temp teal in the Mer zone, air temp amber in the Air zone (glyph + zone + colour,
  never colour alone). Humidity/pressure are first-class nullable (em-dash where a station drops them).
- **Timeseries** — the station's four Air panels (wind mean+gust, wind direction, air temp, rain) plot
  on the **exact same x-axis + crosshair** as the buoy panels (a station carries its own time grid,
  like the tide panel). Every panel is **realm-tagged** (coloured left bar + Mer/Air chip). New
  **hide + reorder**: a drag handle + an eye per panel, hidden panels drop into a click-to-restore
  chip tray; order + hidden set **persisted** (`olatu.charts.order`, `olatu.charts.hidden`).

Data layer: a station loads with the **same code path as a buoy** — `windBase(station)` +
station-keyed tier loaders (`loadWind*`, `loadWindParquetTier`) mirror the buoy ones; `App` resolves
the paired station and threads it down, race-tagged `{campaign, station}` like tides. New `--c-wind`
token (both themes), wind/station/rain/humidity/pressure/eye/grip icons, EN/FR/ES strings. Follow-ups
noted in the spec: a combined air+sea temperature panel, and a map buoy↔station pairing line.

## 2026-07-24 — Wind (vent) per buoy from Météo-France (spec 0012, ingest only)

New data source: **wind from the nearest coastal Météo-France station**, keyed per-station and
shared across buoys like tides/ports (`schema.resolve_wind_station`, `WIND_MAX_KM=25`). Resolves
06403→**Socoa** (1.6 km), 06402→**Biarritz-Pays-Basque** (9.5 km), 03302→**Cap-Ferret** (15.6 km).
New `ingest/wind.py`; canonical 8-var schema (wind speed/dir, gust + dir, air temp, rain, humidity,
pressure — the last two nullable where a station drops them). Each buoy manifest gains a `wind`
**pointer** block (station id, distance, Licence Ouverte attribution). *(Now surfaced in the webapp — see the spec 0013 entry above.)*

Each station is **one unified series structured exactly like a buoy campaign** so the webapp can
later plot a station beside a buoy on the same time axis at any zoom (`build_station` mirrors
`ingest/build.py`): `wind/<station>/data/{manifest,latest,recent}.json` +
`year/<station>_<YEAR>.parquet` (native) + `hourly/…parquet` (hourly means) + `daily.parquet`.
Two feeds fused, one schema:

- **One-shot hourly history, keyless** — the open bulk CSVs on meteo.data.gouv.fr
  (`donnees-climatologiques-de-base-horaires`), URLs resolved from the data.gouv API (survives the
  `latest-`/`previous-` filename churn), decompressed + station-filtered with polars →
  `raw/<station>_hist.csv` (immutable, like a buoy `*_arch.csv`). Seeded all 3 stations **2010→now
  (~145k rows each)**. `pixi run wind --all --seed`.
- **Forward-growing 6-min live, `METEOFRANCE_API_KEY`** — DPObs v2 (`/station/infrahoraire-6m`,
  `apikey` header, 100 req/min), one call per 6-min grid point → `raw/<station>_<YEAR>_live.csv`
  (like a `*_reel.csv`). **Units differ from the bulk files** — `t` Kelvin (→°C), `pmer` Pascal
  (→hPa), gust `raf10`; 429s retried, not swallowed. From the seed onward the record grows *only*
  from this feed (the history is never re-fetched).

Folded into `update()` next to the tide step: scrape 6-min → append → rebuild tiers every run (the
`data/` dir is rewritten from scratch so past-year parquets stay byte-stable and `sync_bucket`
skips them). `METEOFRANCE_API_KEY` in `refresh-data.yml`. All non-fatal. `.env.template` added.

## 2026-07-19 — Denser station bar + remembered smoothing (UX polish)

Two quality-of-life refinements to existing features, both persisted like the other prefs:

- **The station bar collapses** (spec 0005) — it's the tallest thing above the charts (the
  locator map dominates), so it now defaults to a **dense one-line bar**: eyebrow + a compact
  buoy switcher (name-only chips) + a small chevron. Expand restores the intro, source links
  and map. Remembered in `olatu.station_collapsed` (**default collapsed**; only an explicit
  expand writes `0`). Folds to two rows on a phone (eyebrow + chevron up top, switcher
  full-width below, via `order` + `basis-full`). ~410 px expanded → ~49 px collapsed.
- **Chart smoothing is remembered** (spec 0006) — Raw/Light/Strong now persists across
  sessions in `olatu.smooth`, mirroring the range preset (`olatu.range`) exactly.

---

## 2026-07-13 — Data refresh survives an HF outage (resilience + diagnosability)

Hardened `ingest/` after a Hugging Face Xet outage failed one refresh and **hung the next
for 20+ min**, wedging the cron queue (full diagnosis in
[LEARNINGS](../specs/LEARNINGS.md#2026-07-13--an-hf-xet-outage-hung-the-refresh-a-hang-with-no-stack-is-the-real-bug)).

- **`ui.watchdog(seconds, label)`** — bounds any network step. On expiry it prints the step,
  **dumps every thread's stack** (top frame = the stuck call) and hard-exits `75`. A hang is
  now as readable as a crash. `OLATU_NET_TIMEOUT` (default 600s, `0` disables — seeding a
  bucket legitimately takes minutes).
- **`update._net(label, fn, …)`** — every bucket call now goes through one named wrapper:
  watchdog + exponential-backoff retry of **transport** faults (reset/timeout), giving up as
  a `RuntimeError` that `main()` already catches per campaign. It also warns when a step is
  merely *slow* (≥30s) — the early warning for the next outage.
- **`_post_with_retry` retries connection errors**, not just 429/5xx. The outage's
  `ConnectError: Connection reset by peer` hit the OIDC exchange — the run's *first* call —
  and used to take all three buoys down before any work began.
- **Self-healing mirror** — `pull()` deletes and **re-fetches** 0-byte archives (a pull killed
  mid-download); `build._read_raw_csv` replaces polars' bare `NoDataError: empty CSV` with the
  filename and the fix.
- **`timeout-minutes: 15`** on the refresh job (runs take 20–60s), so a hang can never again
  queue every later cron behind it (`concurrency` is `cancel-in-progress: false` by design).
- **Run-context line** at the top of every run: bucket, `huggingface_hub` version, auth source
  (OIDC / `HF_TOKEN` / local login), `API_MAREE_KEY` presence, net timeout.

---

## 2026-07-07 — Analytics, consent & legal pages (spec 0011)

Consent-gated **Google Analytics 4** (`G-XWQEVH6TD8`) + the site's legal surface.
`webapp/src/lib/analytics.ts` is a reactive consent store (`localStorage` `olatu.consent`,
`useSyncExternalStore`) that **injects gtag only after an explicit Accept** — nothing hits
Google before consent (stronger than default Consent Mode). Consent Mode v2 signals are set
(`analytics_storage` granted; `ad_storage`/`ad_user_data`/`ad_personalization` **denied**),
`anonymize_ip` on. The gtag shim must push the raw `arguments` object (GA requirement), so
it's a plain function cast to a variadic signature — **don't spread into an array**, GA won't
parse it. `ConsentBanner.tsx` is a persisted, revocable Accept/Decline bar (Decline as
prominent as Accept); the privacy page embeds the same controls to change your mind.

Three EN/FR/ES pages — **mentions légales / privacy / contact** — live in
`webapp/src/pages/LegalPage.tsx`, reached via a tiny **hash router** (`webapp/src/lib/route.ts`,
`#/privacy`) chosen over path routing because the Vite `base` is relative (`./`) — path routes
would break asset resolution and need a GH-Pages `404.html`; hash routes need zero config and
work offline in the PWA. `App.tsx` swaps the dashboard for `<LegalPage>` off-route
(Header/Footer/ConsentBanner shared); footer gains a Legal · Privacy · Contact row. Editor =
**Hadrien Mary** (personal, non-commercial), contact **via GitHub** (no email), host GitHub
Pages. GA4 measurement ID is public → hard-coded, **no CI/secret change**. Verified end-to-end
(Playwright): no Google request pre-consent; Accept → gtag 200 + `page_view` with
`anonymize_ip`, `gcs=G101`. **Dev gotcha:** the old PWA service worker stale-serves the prior
bundle until it auto-updates — unregister the SW / clear caches after a rebuild when verifying
locally.

## 2026-07-05 — Installable PWA (spec 0010)

Olatu is installable (Add to Home Screen) on Android/iOS/desktop with an offline app shell,
via **`vite-plugin-pwa`** (Workbox `generateSW`) configured in `webapp/vite.config.js`
(manifest + runtime caching). Icons are **pre-generated & committed** in `public/`
(`npm run pwa-assets` ← `pwa-assets.config.ts`, source `public/pwa-icon.svg` = the full-bleed
"O"; keep in sync with `favicon.svg` + `brands.tsx`) so CI needs **no `sharp`**. Caching:
shell precached + silent **`autoUpdate`**; **HF data tiers are NetworkFirst** (`olatu-data`
cache) so the every-30-min refresh stays authoritative online while the banner shows
last-known offline (history parquet range=206 → not cached, best-effort); Google Fonts
SWR/CacheFirst; MapLibre tiles uncached. `og.png` + `pwa-icon.svg` excluded from precache.
iOS standalone metas + apple-touch PNG in `index.html`. `injectRegister:'auto'` → **no
`main.tsx` change**; `devOptions` off (test via `npm run build && npm run preview`). Manifest
scope/start_url are **relative** so one build installs at both `olatu.io` and
`hadim.github.io/olatu/`.

## 2026-07-05 — Tide banner strip rework (spec 0008 §9)

The square arc became an integrated **tide-curve timeline** (prev extremum left/hollow →
**now** dot on the curve → next right/filled, with per-end kind+time captions + countdown),
and **sunrise/sunset moved into their own separated SUN zone** (no longer between tide facts).
`TideStrip.tsx`.

## 2026-07-05 — Buoy-layout + pipeline CLI (spec 0009)

(1) Buoy data on the bucket nests under a **`buoys/<campaign>/`** root (symmetric with
`tides/<port>/`) — flipped in `update._buoy_prefix` + webapp `dataBase`; migrated live via
`ingest/migrate_layout.py` (`pixi run migrate copy`, non-destructive; then `delete --yes`
once the deployed site reads `buoys/`). Local mirror stays flat `hfdata/<campaign>/`.
(2) The data pipeline got a **Typer + Rich CLI** (`ingest/ui.py` shared console): sectioned
per-buoy steps (cyan) vs a distinct tide step (blue) + two end-of-run summary tables; CI-safe
plain rendering with no TTY. `--campaign/-c` is now **repeatable** (not argparse `nargs=+`);
`refresh-data.yml` updated.

## 2026-07-05 — Tides / marées (spec 0008 incl. §8 revision)

`ingest/tides.py` fetches **api-maree.fr** `/water-levels` (IFREMER/PREVIMER, CC-BY;
`API_MAREE_KEY`, ingest-only) and derives high/low **extrema**, **keyed by port** —
`tides/<port>/raw/extrema.csv` accumulator + `tides/<port>/data/tides.parquet` tier on the
bucket (gated ~daily by a forward-horizon check), shared across buoys. `schema.resolve_tide_port`
maps each buoy to its nearest curated port (`TIDE_PORTS`, ≤40 km); `build.py` writes the result
into the manifest `tide` block (or null → empty-state). Runtime `webapp/src/lib/tides.ts`
(raised-cosine `tidePhase` / `reconstructCurve` / `extremaSeries` / `tideHeightAt`) feeds a
**banner tide strip** (`TideStrip.tsx` — arc, phase word, prev + next PM/BM + live countdown,
marnage in m + neap↔spring bar, **no coefficient**, plus sunrise/sunset from the pure
`lib/sun.ts` NOAA calc) and a **synced chart panel** (`TimeSeries.tsx`) plotting the
reconstructed **water-level curve with ▲/▼ markers** (auto Y; smooth 10-min curve ≤21 d,
raw-extrema zig-zag wider; empty-state where no extrema). Predictions cover ~±30 days.
Verified on all 3 buoys with the key; key absent from `dist`.
**Owner TODO:** create the api-maree.fr account + add the `API_MAREE_KEY` GitHub secret
(site ids already validated via `/sites`).

## 2026-07-05 — Identity, nav & attribution (spec 0007)

One **"O" wave-barrel logo** (`components/brands.tsx` `<Logo>`, kept in sync with
`public/favicon.svg`) replaces the emoji + separate favicon; the header is a clickable
**home** link (`<a href={BASE_URL}>`) with a bigger title + static headline (`app_headline`).
The **locator map** (`BuoyLocator`) is interactive: scroll-zoom + +/- controls and **flies to
the buoy on switch** (`easeTo`; first render keeps the all-buoys overview). The redundant
**static bottom mini-map was removed** (`MiniMap.tsx` + `ExpandedMap.tsx` + `public/map/*.png`
deleted) — the station block is now a compact Position/Sensor/Operator strip (Water-depth fact
dropped: always "not published"). **Data-source attribution unified** across the top bar +
footer with one icon family (`brands.tsx`: GitHub / Hugging Face / CANDHIS-buoy). The **footer
carries a discreet build stamp** (`Build <sha> · <date>`, links to the GH commit): sha+date
read from git in `vite.config.js` via `execFileSync` and inlined with Vite `define`
(`__COMMIT_HASH__` / `__COMMIT_DATE__`, typed in `vite-env.d.ts`).

## 2026-06-28 — Phase-7 polish, mobile & a11y (spec 0006 §6)

Accessible per-window **chart summary table** (`sr-only`, live region) so the canvases are
readable to assistive tech, each panel `role="img"`; uPlot **touch pinch-zoom + drag-pan**
(`lib/uplotTouch.ts`) with a **Reset** affordance; the heat-ribbon slider got **keyboard**
control (←/→ pan, Home/End); every animation is `motion-safe`/`motion-reduce` gated; **AA
contrast** verified both themes (faint `--text-3` nudged to clear 4.5 — see LEARNINGS); mobile
touch targets ≥44 px. Radix primitives supply focus-trap/ARIA. Plus a **ghost/skeleton load
state** (`components/Skeletons.tsx`): on first paint and on a buoy switch the full data-widget
charpente shows as shimmering placeholders (`.skeleton`, reduced-motion gated) mirroring the
real layout, with an `sr-only role=status` announcement.

## 2026-06-28 — Direction-glyph layer + history/glossary polish (spec 0003 §6)

The chart direction panel is a custom canvas layer (`TimeSeries.drawDirectionLayer`) —
density-thinned **arrow glyphs** coloured by a **cyclical OKLCH from-direction hue**
(`format.dirColor`, 360-entry LUT: N teal/E blue/S gold/W pink) over a **wrap-aware** spread
band; the same hue tints the banner dial. The date inputs became a **dual-month calendar
cherry-picker** (`DatePicker.tsx`, data-marked + big-swell-flagged days); the **heat-ribbon**
gained draggable edge handles + in-window pan. The glossary slide-over carries each variable's
CANDHIS field + typical range and a direction-colour legend.

## 2026-06-28 — Multi-buoy (spec 0005)

**3 buoys** — 06403 Saint-Jean-de-Luz + 06402 Anglet (archive 2009/2013→2026, seeded) + 03302
Cap Ferret (added realtime-only, later backfilled → full history from 2010). Top **station
bar** (app intro + data-source links) with a **segmented switcher** + a **lazy MapLibre locator
map** (click a buoy to switch; inactive markers are dots, active shows its name). Ingest is
campaign-parameterized end-to-end and tolerates no-archive buoys; `refresh-data.yml` is a
matrix over all campaigns. Switching reloads the selected buoy's tiers; choice is persisted
(`olatu.campaign`) + URL-deep-linked (`?buoy=<id>`, persisted choice wins on load — see 0005
revision 2026-07-04). Loaded tiers are tagged with their campaign so a switch never pairs a new
buoy with the old manifest.

## 2026-06-28 — Stack migration: Tailwind v4 + shadcn/Radix + Paraglide (spec 0006)

Paid down theme/i18n/styling debt with a full utility rewrite. Styling is Tailwind utilities
everywhere; design tokens live as raw `[data-theme]` CSS vars bridged into Tailwind via
**`@theme inline`** (so `bg-surface`/`text-fg`/`text-accent` stay theme-aware and the canvas
keeps reading the same `--c-*` raw vars — components rarely need `dark:`). i18n is **Paraglide
JS** (`messages/{en,fr,es}.json`, lowercase snake_case keys, `m.cc_wave_height()`; a
`LocaleProvider` switches with `reload:false` so chart range/zoom survive). UI primitives are
shadcn-style **copy-ins on Radix** in `src/components/ui/` (Popover, Dialog, Sheet, Tooltip,
ToggleGroup, Button). The language switch is a styled native `<select>`. Only CSS that survives
`styles.css`: tokens, keyframes, uPlot/MapLibre overrides, the hatched no-data band.
**`src/paraglide/` is generated (gitignored)** — the Vite plugin builds it; `npm run paraglide`
feeds standalone `tsc` (`npm run typecheck`).

## 2026-06-28 — Webapp core: TS rebuild, uPlot charts, live refresh, scraper

- **TypeScript rebuild** (Plotly removed): data loader for the JSON tiers + a
  current-conditions banner (compass dial, gauges, sea temp, staleness); **theme** toggle
  (dark default + light, CSS-var tokens).
- **uPlot synced multi-panel charts** (canvas) fed from `daily.parquet` via hyparquet
  (parquet-in-browser): wave height (Hs + Hmax), period, direction; range presets
  1D/2D/5D/10D/1M/6M/1Y/5Y/All (**default 1D**), shared crosshair + synced zoom, theme-aware.
  Panels with too little data auto-hide (temp, until the realtime feed accumulates).
- **Live auto-refresh**: the webapp polls `manifest.json` (every 5 min + on tab focus) and,
  when `generated_at` advances, pulls fresh `latest`/`recent` so the banner updates without a
  reload; the "ago"/freshness ticks via `useNow`. History parquet is not auto-reloaded.
- **Realtime scraper** (`ingest/scrape.py`, spec 0004): grows the live tail + sea-temperature
  history by parsing the CANDHIS realtime HTML table (one GET, no Valider/POST) into a per-year
  `*_reel.csv` accumulator. `build.py assemble()` does an archive-preferred column coalesce so
  the tail never clobbers the archive.
- **Live** at **https://olatu.io** (custom apex; also `hadim.github.io/olatu/`), deployed by
  `.github/workflows/deploy.yml` (official GitHub Pages Actions flow). Pushes touching
  `webapp/**` redeploy. Vite `base` is `./` (relative) so one build works at both hosts;
  `webapp/public/CNAME` ships in the artifact. Apex DNS → GH Pages A/AAAA; `www` → `hadim.github.io`.

## 2026-06-30 — Data store: HF dataset → public bucket (spec 0004 §6)

Moved the store from a HF *dataset* repo to the HF *bucket* `hadim/olatu` (2026-06-30). Buckets
are mutable/overwrite-in-place (no git-history bloat from the */30 refresh) and a *public*
bucket's `resolve/<key>` URLs are anonymous + CORS + range — same CDN as datasets, so the
webapp reads them with a plain `fetch` (no S3 client). Trade-off: non-versioned, so
`update.snapshot_reel` keeps daily dated reel backups (14-day retention) as the only rollback
for the forward-only accumulator. `ingest/update.py` does pull → scrape → build → upload (all
via `huggingface_hub` bucket API: `sync_bucket` / `batch_bucket_files`);
`.github/workflows/refresh-data.yml` runs it every 30 min keyless via OIDC trusted publisher
(`resource=buckets/hadim/olatu`). Webapp reads tiers from HF at runtime (no Pages redeploy on
data change). Sea-temperature history accumulates forward from the scraper's first run.

## 2026-06-28 — Foundation (spec 0001)

Specs written; repo cleaned; `pixi.toml` + polars ingest done and **validated on real data**
(≈214,900 rows, 2013→2026). Tiered Parquet/JSON pipeline; **Parquet** is Snappy +
`row_group_size≈1440` (multi-row-group, CI-asserted) so hyparquet range requests + column
projection work.

---

## Roadmap / next

Per the 0001 roadmap: **side-by-side buoy comparison** (0005 left it out), and the per-locale
**glossary JSON** + CI **key-parity** check (0001 §8) — the glossary still lives inline in the
Paraglide message dict for now.

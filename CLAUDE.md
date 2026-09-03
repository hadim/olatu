# CLAUDE.md

Project memory for AI coding sessions. **Stable operating manual — keep it short and current;
don't let it grow into a changelog.** When you ship something, record it in
[docs/HISTORY.md](docs/HISTORY.md) (dated, newest-first) and put the decision in
[specs/](specs/) — *not* here. Edit this file in place when a durable fact changes; only add a
new gotcha when it's a lasting "how not to break things" rule.

## Where things live

- **[specs/](specs/)** — intent & decisions (spec-driven; read [specs/README.md](specs/README.md) first).
- **[docs/HISTORY.md](docs/HISTORY.md)** — what's shipped, per spec (the changelog that grows).
- **[specs/LEARNINGS.md](specs/LEARNINGS.md)** — non-obvious findings that cost real debugging.
- **This file** — the durable "what/where/how-not-to-break-it" that a new session needs up front.

## What this is

**Olatu** — a fully static web app (GitHub Pages, no backend) that visualizes live +
historical data from CANDHIS wave buoys on the French Atlantic coast: **06403
Saint-Jean-de-Luz** (default), **06402 Anglet**, and **03302 Cap Ferret** (full history from
2010). Switchable in the UI (and via a `?buoy=<id>` URL); data tiers are read in the browser
from the HF bucket `hadim/olatu`. Live at **https://olatu.io** (also `hadim.github.io/olatu/`).

> The GitHub repo is **`hadim/olatu`**. The local working directory may still be named
> `wave-buoys-viewer` (cosmetic; rename optional).

## ⚠️ Read the specs first

This project is **spec-driven**. For every request, first ask *"does this merit a spec?"* — if
yes, create/update one (see "When does work need a spec?" in [specs/README.md](specs/README.md));
if unsure, ask the owner. Key specs to read before implementing:

- [specs/README.md](specs/README.md) — the workflow + full spec index.
- [0001 — Foundation](specs/2026-06-27-0001-foundation.md) — vision, **chosen stack**, data-ops, roadmap (7 phases).
- [0002 — Data dictionary](specs/2026-06-27-0002-data-dictionary.md) — canonical schema + every variable defined.
- [0008 — Tides](specs/2026-07-05-0008-tides.md) — the marée feature (fetch, per-port tier, banner + chart).

## Layout

```
ingest/        Python (polars). NOT an installable package. All steps take --campaign.
  schema.py    per-buoy identity (BUOYS) + column mapping/units/sentinel + TIDE_PORTS registry & resolve_tide_port (nearest port)
  scrape.py    fetch the CANDHIS realtime HTML table -> per-year reel CSV (coalesce-merge)
  tides.py     fetch api-maree.fr water levels -> high/low extrema -> tides/<port>/data/tides.parquet (spec 0008; needs API_MAREE_KEY)
  wind.py      Météo-France wind per station -> buoy-style tiered dataset wind/<station>/ (spec 0012; one-shot hourly history keyless + forward 6-min live needs METEOFRANCE_API_KEY)
  build.py     CSV -> tiered Parquet/JSON (archive-preferred coalesce)
  update.py    pull → scrape → tides → build → upload to the HF bucket (HF_TOKEN secret in CI, OIDC fallback) + daily reel snapshot; Typer CLI (-c repeatable)
  ui.py        shared Rich console + helpers (banner/section/step/detail/summary_table); buoys=cyan, tides=blue; CI-safe plain (spec 0009)
  migrate_layout.py  one-shot bucket layout migration <campaign>/ -> buoys/<campaign>/ (copy | delete --yes; spec 0009)
pixi.toml      Python env + frontend tasks (no pyproject; no Python library)
webapp/        the frontend (reads data tiers from the HF bucket at runtime)
specs/         decisions        docs/  HISTORY.md + README assets (logo, screenshot)
.github/workflows/  deploy.yml (Pages, on code changes) + refresh-data.yml (data, */30)
```

### Data store (HF bucket, not git)

**Data lives in the HF *bucket* `hadim/olatu`, NOT in git** (spec 0004; migrated from a dataset
repo 2026-06-30 — buckets are mutable/overwrite-in-place, and a *public* bucket's
`resolve/<key>` URLs are anonymous + CORS + range, so the webapp reads them with a plain
`fetch`). Non-versioned, so daily dated reel backups (14-day retention) are the only rollback.

- **Buoy data** nests under a **`buoys/` root** (spec 0009): `buoys/<campaign>/raw/*.csv`
  (archive + reel accumulator) + `buoys/<campaign>/data/…` (manifest/latest/recent.json,
  year/*.parquet, hourly/*.parquet per year, daily.parquet) + `buoys/<campaign>/backup/<UTC-date>/*_reel.csv`.
- **Tides** are a separate, port-keyed root (spec 0008): `tides/<port>/raw/extrema.csv`
  accumulator + `tides/<port>/data/tides.parquet` tier, shared across buoys (each buoy's
  manifest `tide` block names its nearest port).
- **Wind** is a separate, station-keyed root (spec 0012), each station a **buoy-style tiered
  dataset** (so it plots on the same axes as a buoy): `wind/<station>/raw/<station>_hist.csv`
  (one-shot hourly history) + `<station>_<YEAR>_live.csv` (forward-growing 6-min) → `data/`
  manifest/latest/recent JSON + year/hourly/daily parquet, built by `wind.build_station` (mirrors
  `build.py`). Shared across buoys (each buoy's manifest `wind` **pointer** names its station).
- The webapp fetches `…/buckets/hadim/olatu/resolve/buoys/<campaign>/data/…` (and
  `…/resolve/tides/<port>/data/…`) — public, CORS, range, **no `main` revision**. The **local**
  working mirror stays flat at `hfdata/<campaign>/{raw,data}`; only the bucket nests under
  `buoys/`. `hfdata/` and `webapp/public/data/` are gitignored.

## Commands

```bash
pixi run update                      # pull → scrape → build → upload to HF (the usual refresh; HF_TOKEN secret in CI, OIDC fallback)
pixi run update -c 06403 -c 06402    # refresh several buoys (repeat -c; typer, not argparse nargs)
pixi run migrate copy                # one-shot: copy bucket <campaign>/ -> buoys/<campaign>/ (spec 0009)
pixi run migrate delete --yes        # after the deployed site reads buoys/, drop the old root prefixes
pixi run scrape                      # lower-level: grow the local reel from the live feed (hfdata/06403/raw)
pixi run ingest                      # lower-level: build tiers from local raw (hfdata/06403/{raw,data})
pixi run wind --all --seed           # one-time: seed every station's wind history (2010→) to the bucket (spec 0012; keyless)
pixi run wind --live --all           # refresh the 6-min live wind layer (needs METEOFRANCE_API_KEY)
pixi run check                       # ruff format + lint
pixi run webapp                      # frontend dev server (reads data from HF; VITE_DATA_BASE_URL to override)
pixi run webapp-build                # static build for GitHub Pages
```

⚠️ **`pixi run` does NOT read `.env`.** The tide/wind steps then skip on a missing key and the
run still reports success (the buoy data refreshes fine), so a whole feature can silently stop
updating. Export first — `set -a && source .env && set +a && pixi run update …` — and check the
run's Tides/Wind tables say `refreshed`, not `no key`.

One-time seed of the bucket: `pixi run update --campaign 06403 --seed-src /Users/hadim/Data/olatu/06403`.

## Conventions & gotchas

- **Conventional Commits, always**: `type(scope): description` (feat/fix/docs/refactor/chore/ci/
  build/perf/test; scope e.g. `webapp`, `ingest`, `ci`).
- **English everywhere** (code, comments, specs, UI source strings); UI translated EN/FR/ES.
- **polars, not pandas.** TypeScript for the webapp. Pixel-perfect data-viz is the bar.
- **Timestamps are UTC**, rendered Europe/Paris. Don't use bare `new Date(value)`.
- **Sentinel `999.999`** (CANDHIS "no data") is nulled at ingest (threshold ≥ 999.99). Don't
  reintroduce it; don't blanket-clip directions (real 0–360°).
- **43 archive columns are 100% empty for 06403** (QUALITE, NBSYS, S1–S4) → dropped.
- **Sea temperature exists only in the realtime feed** → history has none; it accumulates
  forward. Handle missing-temp as a first-class UI state, not an empty chart.
- **Series has real gaps** (largest 50 days) → break the line, never interpolate across.
- **Parquet:** Snappy + `row_group_size≈1440` (multi-row-group, CI-asserted) so hyparquet range
  requests + column projection work.
- **GitHub Pages base path:** fetch webapp assets via `import.meta.env.BASE_URL`, never a leading
  `/`. **Data tiers are different** — fetch them via `dataBase(campaign)`
  (`webapp/src/lib/data.ts`) = `DATA_ROOT` + `buoys/<campaign>/data/` (the HF bucket resolve URL,
  no `main` revision), not BASE_URL. `VITE_DATA_BASE_URL` overrides the root.
- **Multi-buoy:** the buoy registry is `ingest/schema.py` `BUOYS` (Python) +
  `webapp/src/lib/buoys.ts` (frontend) — keep lat/lon in sync. Selected campaign is persisted
  (`olatu.campaign`) **and** deep-linked (`?buoy=<id>`, **persisted choice wins on load**; see
  spec 0005). Loaded tiers are tagged with their campaign so a switch never pairs the new buoy
  with the old manifest.
- **Realtime-only buoys:** a campaign with no `*_arch.csv` builds from the scraped reel alone
  (`build.read_archive` returns None, history accumulates forward). Drop archive CSVs into the
  campaign's `raw/` later to backfill (they coalesce) — this is how Cap Ferret went from
  realtime-only to full history from 2010.
- **Analytics/consent (spec 0011)** is consent-gated: `webapp/src/lib/analytics.ts` injects
  gtag (GA4 `G-XWQEVH6TD8`) **only after an explicit Accept** — never load a tracker before
  consent, and keep Consent Mode ad signals denied. The gtag shim pushes the raw `arguments`
  object; don't "clean it up" into a spread array (GA won't parse it). **Legal pages** are
  hash routes (`#/privacy` etc., `webapp/src/lib/route.ts`) — path routing would break the
  relative Vite `base`; keep new static pages on the hash router.
- **Never add an unbounded network call to `ingest/`.** Route every HF bucket call through
  `update._net(label, fn, …)` (watchdog + transport-fault retry) and give network work a
  `ui.watchdog`. A hang is worse than a crash here: the refresh cron is `concurrency:
  cancel-in-progress: false`, so one wedged run queues **every** later refresh behind it and
  the pipeline stops silently. Retry *transport* faults (reset/timeout), not just 5xx.
  See the 2026-07-13 LEARNINGS entry.
- **Tides (marée, spec 0008)** come from **api-maree.fr** — needs `API_MAREE_KEY` (env / GitHub
  secret, **ingest-only, never in the client**). Keyed by **port, not buoy**
  (`schema.TIDE_PORTS` + `resolve_tide_port`: each buoy → nearest curated port ≤ `TIDE_MAX_KM=40`,
  else no tide). Fetched from **`/tide-extrema`** — one request per port for the whole J±30 window,
  PM/BM **and** the coefficient; don't re-derive extrema or recompute the coefficient (spec §11).
  Runtime `webapp/src/lib/tides.ts` reconstructs the raised-cosine curve. **Marnage in metres is the
  primary metric** and the only input to the neap↔spring gauge; the **coefficient** (`c`, high-tide
  rows only, nullable) is a *secondary* readout — a Brest-referenced **national** index, identical at
  every French port, so it says nothing about the water *here*. Null `c` is normal (BM rows, and
  anything older than the API's rolling window — it can't be backfilled), so the webapp reads the
  tier **without a column projection**. A tide-tier schema change needs `pixi run update
  --force-tides`: the horizon gate only asks how far ahead the accumulator runs, so it would
  otherwise skip fetching for ~10 days. Predictions cover ~±30 days → older windows empty-state (like
  temp). Missing key/port is non-fatal (tide step skips). Valid site ids: 06403
  `saint-jean-de-luz`, 06402 `boucau-bayonne-biarritz`, 03302 `cap-ferret`. The **tide calendar**
  (spec 0008 §10, button beside the phase word) is pure UI over the already-loaded extrema — group
  days with `zonedDayIndex`/`groupTidesByDay` (the **buoy's zone**, never UTC: a 23:40 UTC tide is a
  next-day tide in Paris) and take the selectable bounds from the data, never from a ±N-day rule.
- **Wind (vent, spec 0012)** comes from **Météo-France**, keyed by **station**
  (`schema.WIND_STATIONS` + `resolve_wind_station`: each buoy → nearest station ≤
  `WIND_MAX_KM=25`, else no wind). Two layers: **hourly history** from the open bulk files
  (meteo.data.gouv.fr, Licence Ouverte, **no key**, 2010→) and **6-min live** from the DPObs API
  (**`METEOFRANCE_API_KEY`, ingest-only, `apikey` header, 100 req/min**). ⚠️ The DPObs 6-min
  feed's **units differ** from the bulk files — `t` Kelvin, `pmer` Pascal, gust is `raf10` —
  convert on ingest; and **don't swallow its 429s** (retry — see LEARNINGS). humidity/pressure
  are **nullable** (some stations drop them). Station ≠ offshore — the UI must name the station +
  distance, never "wind at the buoy". Non-fatal; `update()` scrapes the 6-min feed + rebuilds
  tiers every run, while the **hourly history is a one-shot seed** (`pixi run wind --seed`), never
  re-fetched — forward growth is 6-min only. ⚠️ **That 6-min window is gap-aware, never "the last
  N minutes" (spec 0012 §3.1).** DPObs serves ONE observation per call, so a fixed window makes
  every pipeline outage a *permanent* hole — CANDHIS republishes ~48 h and self-heals, DPObs does
  not, and that asymmetry cost a 6 h hole on 2026-09-02. `wind.live_targets` re-probes the 66-min
  tail **plus** any slot missing from the last 24 h, newest first, capped at 60/station/run (the
  cap is what keeps a long outage from wedging the cron; successive runs chew backwards). Never
  request past the measured ~96 h DPObs retention — that is the only place a hole is now
  permanent. `pixi run wind --backfill [HOURS] --all` lifts the cap for a manual repair.
- **Rain is an ACCUMULATION, not a state (spec 0018).** `precipitation_mm` is the only cumulative
  variable in the schema (`schema.WIND_ACCUM_VARS`) and it breaks every rule the others follow.
  It **sums** when down-sampling — `mean()` divided the daily rain by 24 (by ~240 in the 6-min era)
  and nothing surfaced it, because rain's normal value is 0. Both Météo-France feeds **end-stamp**
  a total (`RR1` at H covers `(H-1h, H]`, `rr_per` at T covers `(T-6min, T]`), so the bucket is
  `closed='right', label='left'` — that is what makes it exact for the hourly history *and* the
  6-min live layer at once. The native tier carries a **trailing-hour** total, computed **per layer
  before the hist/live coalesce** (a window spanning the seam double-counts an `RR1` with the 6-min
  readings inside it) — that is what keeps the seam flat and makes native == hourly at `:00`.
  Guard every accumulation aggregate against polars' `sum()`-of-nothing = `0.0`. Display unit is
  **tier-aware**: `mm/h` on native/hourly + Current Conditions, `mm/24h` on daily — never label a
  daily total `mm/h`. Adding another cumulative variable (`DRR1`, snow) means adding it to
  `WIND_ACCUM_VARS`, not to the mean path. See the 2026-08-24 LEARNINGS entry.
- **Wind webapp (spec 0013)** = the **Air realm** (amber `--c-wind`) opposite the buoy **Mer realm**
  (teal), one colour+glyph system across selection · current conditions · timeseries so "buoy vs
  station" reads at a glance. A **station picker** sits beside the (kept) collapsible buoy switcher:
  default = the manifest `wind` pointer, override **persisted per buoy** (`olatu.station`). A station
  loads with the **same code path as a buoy** (`data.windBase(station)` + `loadWind*` +
  `loadWindParquetTier`); `App` threads it down race-tagged `{campaign, station}`. Current Conditions
  is two realm **zones** joined by the **offshore/onshore** bridge (`lib/wind.ts` — station
  `wind_direction_deg` × buoy `peak_direction_deg`, swell-relative approx). Station timeseries share
  the buoy's x-axis with per-panel **hide/reorder** (persisted `olatu.charts.order|hidden`). Keep the
  temp/direction disambiguation carried by **zone + glyph + colour**. **§6 revision (2026-07-25):**
  direction is now a **cardinal colour-code** (N teal·E blue·S gold·W pink) on **both** realms — so
  realm is carried by zone/bar/tag/values, *not* the direction hue; the hover readout also lists the
  **Air** values (looked up by time on the station grid) + an on-plot **cursor bubble** per panel;
  humidity/pressure panels added; the offshore/onshore verdict is a softened banner **above** the zones;
  wind stations show as amber markers on the map; Météo-France is credited and the HF link was dropped.
- **Units (spec 0014)** are **display-only**: the stored tiers stay canonical (wind **m/s**, temp
  **°C**, pressure **hPa**). Convert at the **last moment** via `lib/units` (`useUnits` +
  `convertMeasure`/`formatKeyValue`/`keySuffix`, keyed by **column name**) — Current Conditions, chart
  panels + heading unit tags, hover readout. Default wind = **km/h**; the choice persists in
  `olatu.units`. Never mutate the stored data to change units; the °C→°F map is affine so it commutes
  with the chart smoothing. The **clock format** (Auto · 24 h · 12 h, spec 0014 §6) is a field of the
  same store: pass `units.clock` to `fmtTimeOfDay`/`fmtClock`/`fmtDateTime`/`fmtAxisTick` at every new
  call site. 24 h is `hourCycle: 'h23'`, **not** `hour12: false` (that renders midnight `24:00`).
- **Mobile is a layout mode, not a second UI (spec 0017).** Only the **page shell** pays for the
  screen edge on a phone (`px-3 sm:px-5`); cards/zones shrink their own padding instead of stacking
  a third inset, and the chart host's padding is **`--ts-pad`** (styles.css) because the day
  overlay, the reorder drop line and the `.ts-band` gutter all position against it — never
  hard-code `1rem` there again. Below **720px** the realm zones + tide strip **centre** (`text-center`
  only — `justify-items-center` shrink-wraps a `@container` tile and collapses its `cqw` type
  scale); from 720px up the 0015 left-alignment stands. Chart controls **lose nothing** on a phone:
  ranges become one scrollable line, the navigator stays out, smoothing/jump fold behind a
  phone-only ⚙ Options (`md:hidden` + `max-md:hidden`), so desktop is a superset. **Never size a
  uPlot from `host.clientWidth`** (it includes padding → plots overflow and the x-axis right edge is
  clipped): use the content width. **Never put `sr-only` on a `<table>`** — a table treats
  `width:1px` as a minimum, so it doesn't hide and it adds phantom horizontal scroll; wrap it.
  See the 2026-08-10 LEARNINGS entry.
- **Current Conditions is a REAL-TIME snapshot (spec 0015).** No trends, deltas, history or forecast
  on that card — a full 24 h sparkline + delta + range pass was built and rejected by the owner as
  too much information. It answers "what now"; the chart stack below answers "how did it get there".
  Its density instead comes from layout: a 128 px dial that is the *only* place the cardinal +
  degrees appear, one `Metric` tile per reading, and grids that fill edge to edge (Mer 4-up, Air
  6-up — never a `max-w` cap or an over-wide column). Air packs six-up only because
  `cc_air_temp_short`/`cc_sea_temp_short` are printed; keep the full names in the popover title.
  **Freshness is per realm, never per card (spec 0015 §7)** — the badge lives in each `ZoneHeader`
  (Mer reads the buoy tier, Air the station tier) and `stale` desaturates **its own zone**. The two
  feeds fail independently (CANDHIS froze on all three buoys at once on 2026-08-21 while
  Météo-France kept reporting), so never put a single buoy-fed badge back in the header row, and
  never desaturate the card element. **Tile type is sized in `cqw`, never `vw`** — each tile is a `@container`, and the page is capped
  at `max-w-[1100px]` so viewport units stop tracking the box past ~1140px; the `clamp` bounds come
  from the widest string a tile must hold without wrapping (Air's "1 020 hPa"), so re-tune them if
  you change the column count. Values align by **`subgrid`** (tile spans two rows, label
  `self-start`, value `self-end`) — don't put a `min-h` back on the label, it reserves a blank line
  in the common case where nothing wraps.
- **Never run `npm audit fix --force` in `webapp/`.** The remaining advisories all sit under
  `@vite-pwa/assets-generator` (whose latest still pins `sharp ^0.33.5`), so `--force` "fixes" them by
  **downgrading `vite-plugin-pwa` 1.3 -> 0.18.2**. They're patched instead via `overrides` in
  `package.json` (`sharp`, `brace-expansion`) — keep those; drop one only when upstream bumps.
- **Tiers are stale-while-revalidate, not fetch-on-load (spec 0019).** Every tier body is cached
  per URL in IndexedDB (`lib/cache.ts`) and painted **immediately** via the `onStale` callback of
  `lib/swr.ts`, while the network copy revalidates; a loader resolving **`null` means "unchanged,
  keep what you painted"**, never "no data" (the tide loader adds `undefined` = unchanged, `null` =
  no tides). Don't "simplify" that null away — re-setting identical data rebuilds every uPlot. Two
  orderings must be kept or the cache silently does nothing offline: **failing is faster than
  reading IndexedDB**, so grouped loads use `Promise.allSettled` (never `all`), and the flag that
  suppresses a late stale paint is set **only when a fresh copy actually replaces it** — never on a
  failure or an unchanged tier. Test the cache path with a *failing* backend, not a slow one. Every
  fetch registers with `lib/progress.ts`, which is what `DataStatus` renders: keep new tier loads
  going through `swr` so the rail/pill stay honest.
- **A cache moved the charts' mount into the past (spec 0019 §8).** `TimeSeries` seeds its x-window
  from **`TN`** (the latest reading) at mount — which now means "on data as old as your last visit".
  `TN` keeps moving after that (the 5-min manifest poll; the network copy replacing the cached
  paint), so **nothing may be seeded from it and then left alone**: the window slides forward, but
  ONLY when it was sitting on the latest reading (a window the user panned to stays put), and the
  in-memory per-year tile caches are dropped for the year(s) `TN` crossed — older years never grow.
  Drop either half and the axis reaches "now" over a line that stops where the last visit did.
  Matching rule one layer down: **"unchanged, keep what you have" may only be said to a caller that
  HAS it** — the stale parquet/tide parse is async while the hash compare is instant, so
  `loadParquetTierFrom`/`loadTidesForManifest` await the stale paint before returning the unchanged
  sentinel. See the 2026-08-27 LEARNINGS entry.
- **Rebuilding the chart stack must not move the page.** `TimeSeries`'s render effect destroys every
  uPlot and re-appends the panels, so the host collapses and the browser clamps the scroll to the top.
  The cleanup **pins `host.style.minHeight`** before `destroy()`, and the rebuild releases it in a
  **`requestAnimationFrame`** (the panels aren't laid out in the same tick — releasing synchronously,
  or calling `scrollTo` there, is clamped away). Keep both halves if you touch that effect.
  See the 2026-07-25 LEARNINGS entry.
- **Never `preventDefault()` a one-finger `touchmove` on a chart (spec 0016).** That is what turned
  the ~1700px chart stack into a scroll trap on a phone. The plot hit area sets `touch-action: pan-y`
  so the BROWSER scrolls vertically; a JS axis-lock (8px) then claims only horizontal gestures. One
  finger horizontal = **scrub to read**, two fingers = pan/zoom — don't move pan back to one finger.
  The touch readout bar is **fixed to the viewport** (the hover card sits ~1700px above the panel
  you're touching) and is deliberately **not cleared on `touchend`**; the ✕ is the only way out, so
  keep it. It also carries the **core values** beside the stamp (spec 0017 §5). The same rule applies
  to the ribbon and any new hit area: `pan-y` + an axis-lock, never `touch-none`.
- **Every panel drives the hover readout (spec 0017 §5).** A panel on its own x-grid (tide, Air) maps
  cursor → **time** → nearest buoy index. Don't reintroduce a "buoy panels only" guard: that was the
  "hovering isn't synced between the plots" report — every crosshair moved while the card kept the
  previous instant. Readout rows are label-left / **value-right** and grouped Sea/Air; keep that,
  it's what makes the two temperatures and the two directions distinguishable at a glance.
- **Reorder is Pointer Events, never HTML5 drag-and-drop** (spec 0013 §7) — `draggable` does nothing on
  touch. The one control is the per-panel **`.ts-band`** in the host's left gutter: pointer drag *and*
  the accessible/keyboard control (`role=button`, `tabindex`, ↑/↓, re-focused after the rebuild via
  `focusBandRef`). Only the hovered `.ts-unit` lights its band — don't light the whole stack.
- **Chart gap-breaks:** `TimeSeries.gapAware` must estimate the sampling cadence **causally (an EWMA of
  the normal deltas)**, never the global-minimum delta — a **mixed-cadence** source (the current-year
  wind file = a 6-min live tail on an hourly history) otherwise flags every hourly step as a gap and
  shatters the line into invisible dots. See the 2026-07-25 LEARNINGS entry.

## Status

Shipped and live at **olatu.io** — foundation → PWA → analytics/legal → wind ingest → wind in the
webapp → units/settings + wind-UX polish → Current Conditions density → touch charts → mobile layout
→ rain accumulation → instant load from the local tier cache (specs 0001–0019). The full feature-by-feature history is in
**[docs/HISTORY.md](docs/HISTORY.md)**; the spec index + statuses are in [specs/README.md](specs/README.md).

**Open owner TODO:** CI authenticates to the bucket with the **`HF_TOKEN`** repo secret (the
fine-grained HF token `olatu-gh-ci`, read+write scoped to `hadim/olatu` only) since 2026-09-02,
because HF stopped matching the bucket's OIDC trusted publisher (`400 No trusted publisher
configured … matching this OIDC token`, every run for a whole day). `update.resolve_token` takes
the env var first and falls back to the OIDC exchange when it is unset, so **delete the secret
to go back keyless** once HF matches the claims again — nothing else changes. `API_MAREE_KEY` and
`METEOFRANCE_API_KEY` are set. **Next per roadmap:** a combined air+sea temperature chart panel + the
map buoy↔station pairing **line** (station markers already shipped, spec 0013 §6), side-by-side buoy
comparison, per-locale glossary JSON.

# CLAUDE.md

Project memory for AI coding sessions. Keep it short and current.

## What this is

**Olatu** — a fully static web app (GitHub Pages, no backend) that visualizes live
+ historical data from CANDHIS wave buoys on the French Atlantic coast: **06403
Saint-Jean-de-Luz** (default) and **06402 Anglet** (Basque, full history), plus **03302
Cap Ferret** (Gironde, realtime-only — no archive yet). Switchable in the UI (and via a
`?buoy=<id>` URL); data tiers are read in the browser from the HF bucket `hadim/olatu`.

> The GitHub repo is **`hadim/olatu`**. The local working directory may still be
> named `wave-buoys-viewer` (cosmetic; rename optional).

## ⚠️ Read the specs first

This project is **spec-driven**. For every request/task, first ask *"does this merit
a spec?"* — if yes, create/update one (see "When does work need a spec?" in
[specs/README.md](specs/README.md)); if unsure, ask the owner. Before implementing, read:

- [specs/README.md](specs/README.md) — the workflow + index
- [specs/2026-06-27-0001-foundation.md](specs/2026-06-27-0001-foundation.md) —
  vision, **chosen stack**, data-ops, feature spec, UX direction, **roadmap (7 phases)**
- [specs/2026-06-27-0002-data-dictionary.md](specs/2026-06-27-0002-data-dictionary.md) —
  canonical schema + plain-language definition of every variable
- [specs/2026-07-05-0008-tides.md](specs/2026-07-05-0008-tides.md) — tide (marée) feature:
  api-maree.fr fetch, extrema accumulator, **per-port Parquet tier** (`tides/<port>/`, §8.2),
  banner strip + **water-level curve chart** (§8.3), sun times, nearest-port resolution

## Layout

```
ingest/        Python (polars). NOT an installable package. All steps take --campaign.
  schema.py    per-buoy identity (BUOYS) + column mapping/units/sentinel + TIDE_PORTS registry & resolve_tide_port (nearest port)
  scrape.py    fetch the CANDHIS realtime HTML table -> per-year reel CSV (coalesce-merge)
  tides.py     fetch api-maree.fr water levels -> high/low extrema -> tides/<port>/data/tides.parquet (spec 0008 §8.2; needs API_MAREE_KEY)
  build.py     CSV -> tiered Parquet/JSON (archive-preferred coalesce)
  update.py    pull → scrape → tides → build → upload to the HF bucket (OIDC in CI) + daily reel snapshot; Typer CLI (-c repeatable)
  ui.py        shared Rich console + helpers (banner/section/step/detail/summary_table); buoys=cyan, tides=blue; CI-safe plain (spec 0009)
  migrate_layout.py  one-shot bucket layout migration <campaign>/ -> buoys/<campaign>/ (copy | delete --yes; spec 0009)
pixi.toml      Python env + frontend tasks (no pyproject; no Python library)
webapp/        the frontend (reads data tiers from the HF bucket at runtime)
specs/         decisions
.github/workflows/  deploy.yml (Pages, on code changes) + refresh-data.yml (data, */30)
```

> **Data lives in the HF *bucket* `hadim/olatu`, NOT in git** (see specs/0004; migrated
> from a dataset repo 2026-06-30). Buoy data nests under a **`buoys/` root** (spec 0009,
> symmetric with the tide root): `buoys/<campaign>/raw/*.csv` (archive + reel accumulator) +
> `buoys/<campaign>/data/…` (manifest/latest/recent.json, year/*.parquet, hourly/*.parquet
> per year, daily.parquet) + `buoys/<campaign>/backup/<UTC-date>/*_reel.csv` (daily reel
> snapshots, 14-day retention — buckets are non-versioned so this is the only rollback).
> **Tides are a separate, port-keyed root** (specs/0008 §8.2): `tides/<port>/raw/extrema.csv`
> accumulator + `tides/<port>/data/tides.parquet` tier, shared across buoys (each buoy's
> manifest `tide` block names its nearest port). The webapp fetches
> `…/buckets/hadim/olatu/resolve/buoys/<campaign>/data/…` (and `…/resolve/tides/<port>/data/…`)
> — public, CORS, range, **no `main` revision**. The **local** working mirror stays flat at
> `hfdata/<campaign>/{raw,data}`; only the bucket nests under `buoys/`. `hfdata/` (local
> mirror) and `webapp/public/data/` are gitignored.

## Commands

```bash
pixi run update                      # pull → scrape → build → upload to HF (the usual refresh; OIDC in CI)
pixi run update -c 06403 -c 06402    # refresh several buoys (repeat -c; typer, not argparse nargs)
pixi run migrate copy                # one-shot: copy bucket <campaign>/ -> buoys/<campaign>/ (spec 0009)
pixi run migrate delete --yes        # after the deployed site reads buoys/, drop the old root prefixes
pixi run scrape                      # lower-level: grow the local reel from the live feed (hfdata/06403/raw)
pixi run ingest                      # lower-level: build tiers from local raw (hfdata/06403/{raw,data})
pixi run check                       # ruff format + lint
pixi run webapp                      # frontend dev server (reads data from HF; VITE_DATA_BASE_URL to override)
pixi run webapp-build                # static build for GitHub Pages
```

One-time seed of the bucket: `pixi run update --campaign 06403 --seed-src /Users/hadim/Data/olatu/06403`.

## Conventions & gotchas

- **Conventional Commits, always**: `type(scope): description` (feat/fix/docs/
  refactor/chore/ci/build/perf/test; scope e.g. `webapp`, `ingest`, `ci`).
- **English everywhere** (code, comments, specs, UI source strings); UI translated EN/FR/ES.
- **polars, not pandas.** TypeScript for the webapp. Pixel-perfect data-viz is the bar.
- **Timestamps are UTC**, rendered Europe/Paris. Don't use bare `new Date(value)`.
- **Sentinel `999.999`** (CANDHIS "no data") is nulled at ingest (threshold ≥ 999.99).
  Don't reintroduce it; don't blanket-clip directions (real 0–360°).
- **43 archive columns are 100% empty for 06403** (QUALITE, NBSYS, S1–S4) → dropped.
- **Sea temperature exists only in the realtime feed** → history has none; it
  accumulates forward. Handle missing-temp as a first-class UI state, not an empty chart.
- **Tides (marée, spec 0008 + §8 revision)** come from **api-maree.fr** (needs the
  `API_MAREE_KEY` env / GitHub secret — **ingest-only**, never in the client). Keyed by
  **port, not buoy** (`schema.TIDE_PORTS` + `resolve_tide_port`: each buoy → nearest curated
  port within `TIDE_MAX_KM=40`, else no tide). `ingest/tides.py` derives high/low extrema into
  `tides/<port>/raw/extrema.csv` (forward-growing, like the reel) + `tides/<port>/data/tides.parquet`;
  the manifest `tide` block carries `{port,label,distance_km,range_ref,source}`. The webapp
  (`lib/tides.ts`) reconstructs the raised-cosine curve. **Banner** = arc + prev/next PM/BM +
  countdown + marnage (m, no coefficient) + **sunrise/sunset** (`lib/sun.ts`, pure NOAA calc);
  **chart** = **water-level curve + ▲/▼ markers** (`TimeSeries` tide panel, auto Y; smooth
  10-min curve ≤21 d, extrema zig-zag wider). Predictions cover ~±30 days → older windows
  empty-state (like temp). Missing key/port is non-fatal (tide step skips). Valid site ids:
  06403 `saint-jean-de-luz`, 06402 `boucau-bayonne-biarritz`, 03302 `cap-ferret`.
- **Series has real gaps** (largest 50 days) → break the line, never interpolate across.
- **GitHub Pages base path:** fetch webapp assets via `import.meta.env.BASE_URL`,
  never a leading `/`. **Data tiers are different** — fetch them via
  `dataBase(campaign)` (`webapp/src/lib/data.ts`) = `DATA_ROOT` + `buoys/<campaign>/data/`
  (the HF bucket resolve URL, `…/buckets/hadim/olatu/resolve/` — no `main` revision; buoy
  data nests under `buoys/`, spec 0009), not BASE_URL. `VITE_DATA_BASE_URL` overrides the root.
- **Multi-buoy:** the buoy registry is `ingest/schema.py` `BUOYS` (Python) +
  `webapp/src/lib/buoys.ts` (frontend) — keep lat/lon in sync. Selected campaign is
  persisted (`olatu.campaign`) **and** deep-linked (`?buoy=<id>`, **persisted choice wins
  on load**, `?buoy=` only for a first-time visitor with no stored choice — see specs/0005
  revision 2026-07-04; replaceState on switch); loaded tiers are tagged with their campaign
  so a switch never pairs the new buoy with the old manifest (see specs/0005).
- **Realtime-only buoys:** a campaign with no `*_arch.csv` (e.g. Cap Ferret) builds from
  the scraped reel alone — `build.read_archive` returns None and history accumulates
  forward. Drop archive CSVs into the campaign's `raw/` later to backfill (they coalesce).
- **Parquet:** Snappy + `row_group_size≈1440` (multi-row-group, CI-asserted) so
  hyparquet range requests + column projection work.

## Current state (2026-06-28)

- Specs written; repo cleaned; `pixi.toml` + polars ingest done and **validated on
  real data** (≈214,900 rows, 2013→2026).
- **Data lives in the HF *bucket* `hadim/olatu`, not git** (foundation §5.3 migration
  done; **moved dataset repo → bucket 2026-06-30**, see specs/0004 §6). Buckets are
  mutable/overwrite-in-place (no git-history bloat from the */30 refresh) and a *public*
  bucket's `resolve/<key>` URLs are anonymous + CORS + range — same CDN as datasets, so
  the webapp reads them with a plain `fetch` (no S3 client). Trade-off: non-versioned, so
  `update.snapshot_reel` keeps daily dated reel backups (14-day retention) as the only
  rollback for the forward-only accumulator. `ingest/update.py` does pull → scrape →
  build → upload (all via `huggingface_hub` bucket API: `sync_bucket` / `batch_bucket_files`);
  `.github/workflows/refresh-data.yml` runs it every 30 min keyless via OIDC trusted
  publisher (`resource=buckets/hadim/olatu`, configured on the bucket's Settings); the
  webapp reads tiers from HF at runtime (no Pages redeploy on data change).
  Sea-temperature history accumulates forward from the scraper's first run.
- **Webapp rebuilt to TypeScript** (Plotly removed). Working: data loader for the
  JSON tiers + a current-conditions banner (compass dial, gauges, sea temp,
  staleness); **theme** toggle (dark default + light, CSS-var tokens).
- **Stack debt paid down (2026-06-28, specs/0006): Tailwind v4 + shadcn/Radix +
  Paraglide, full utility rewrite.** Styling is now Tailwind utilities everywhere;
  the design tokens live as raw `[data-theme]` CSS vars bridged into Tailwind via
  **`@theme inline`** (so `bg-surface`/`text-fg`/`text-accent` stay theme-aware and the
  canvas keeps reading the same `--c-*` raw vars — components rarely need `dark:`).
  i18n is **Paraglide JS** (`messages/{en,fr,es}.json`, **lowercase snake_case keys**,
  `m.cc_wave_height()`; a `LocaleProvider` switches with `reload:false` so chart
  range/zoom survive). UI primitives are shadcn-style **copy-ins on Radix** in
  `src/components/ui/` (Popover, Dialog, Sheet, Tooltip, ToggleGroup, Button) — the
  hand-rolled InfoPopover/Glossary/DatePicker/buoy-switch now ride them for free focus
  trap / ARIA / keyboard. The language switch is a styled native `<select>`. Only CSS
  that survives `styles.css`: tokens, keyframes, uPlot/MapLibre-injected overrides, the
  hatched no-data band. **`src/paraglide/` is generated (gitignored)** — the Vite plugin
  builds it; `npm run paraglide` feeds standalone `tsc` (`npm run typecheck`).
- **uPlot synced multi-panel charts** (canvas) fed from `daily.parquet` via
  hyparquet (parquet-in-browser): wave height (Hs + Hmax), period, direction;
  range presets (1M/6M/1Y/5Y/All), shared crosshair + synced zoom, theme-aware.
  Panels with too little data auto-hide (temp, until the realtime feed accumulates).
- **Live**: https://olatu.io (custom apex domain; also reachable at
  https://hadim.github.io/olatu/) — deployed by `.github/workflows/deploy.yml`
  (official GitHub Pages Actions flow; Pages source = GitHub Actions). Pushes that
  touch `webapp/**` redeploy automatically. Vite `base` is `./` (relative) so one
  build works at both the apex and the project path; `webapp/public/CNAME` (=`olatu.io`)
  ships in the artifact. Apex DNS → GitHub Pages A/AAAA records; `www` CNAME → `hadim.github.io`.
- **Live auto-refresh**: the webapp polls `manifest.json` (every 5 min + on tab focus)
  and, when `generated_at` advances, pulls fresh `latest`/`recent` so the banner updates
  without a reload; the relative "ago"/freshness ticks via `useNow`. History parquet is
  not auto-reloaded (daily means barely move in 30 min).
- **Realtime scraper** (`ingest/scrape.py`): grows the live tail + sea-temperature
  history by parsing the CANDHIS realtime HTML table (one GET, no Valider/POST) into a
  per-year `*_reel.csv` accumulator. `build.py assemble()` does an archive-preferred
  column coalesce so the tail never clobbers the archive. See spec 0004.
- Chart range presets are 1D/2D/5D/10D/1M/6M/1Y/5Y/All; **default is 1D**.
- **Multi-buoy shipped** (specs/0005): **3 buoys** — 06403 Saint-Jean-de-Luz + 06402
  Anglet (archive 2009/2013→2026, seeded) + 03302 Cap Ferret (realtime-only). Top
  **station bar** (app intro + data-source links) with a **segmented switcher** + a
  **lazy MapLibre locator map** (click a buoy to switch; inactive markers are dots,
  active shows its name). The ingest is campaign-parameterized end-to-end and tolerates
  no-archive buoys; `refresh-data.yml` is a matrix over all campaigns. Switching reloads
  the selected buoy's tiers; choice is persisted + URL-deep-linked (`?buoy=<id>`).

- **Direction-glyph layer + history/glossary polish shipped** (2026-06-28, see specs/0003
  §6): the chart direction panel is now a custom canvas layer (`TimeSeries.drawDirectionLayer`)
  — density-thinned **arrow glyphs** coloured by a **cyclical OKLCH from-direction hue**
  (`format.dirColor`, 360-entry LUT: N teal/E blue/S gold/W pink) over a **wrap-aware**
  spread band; the same hue tints the banner dial. The date inputs became a **dual-month
  calendar cherry-picker** (`DatePicker.tsx`, data-marked + big-swell-flagged days); the
  **heat-ribbon** gained draggable edge handles + in-window pan. The glossary slide-over
  now carries each variable's **CANDHIS field + typical range** and a **direction-colour
  legend**.

- **Phase 7 polish/mobile/a11y shipped** (2026-06-28, specs/0006 §6): accessible
  per-window **chart summary table** (`sr-only`, live region) so the canvases are
  readable to assistive tech, each panel `role="img"`; uPlot **touch pinch-zoom + drag-pan**
  (`lib/uplotTouch.ts`) with a **Reset** affordance; the heat-ribbon slider got
  **keyboard** control (←/→ pan, Home/End); every animation is `motion-safe`/`motion-reduce`
  gated; **AA contrast** verified both themes (faint `--text-3` nudged to clear 4.5 — see
  LEARNINGS); mobile touch targets ≥44 px. Radix primitives supply focus-trap/ARIA.
- **Ghost/skeleton load state** (`components/Skeletons.tsx`): on first paint (and on a
  buoy switch) the full data-widget charpente — banner, chart wells, map+facts — shows
  as shimmering placeholders (`.skeleton`, reduced-motion gated) instead of a bare
  "Loading…" line; an `sr-only role=status` carries the announcement. Mirrors the real
  layout so there's no jump when data lands.

- **Identity / nav / attribution polish shipped** (2026-07-05, specs/0007): one **"O"
  wave-barrel logo** (`components/brands.tsx` `<Logo>` — kept in sync with
  `public/favicon.svg`) replaces the emoji + separate favicon; the header is a clickable
  **home** link (`<a href={BASE_URL}>`) with a bigger title + a static headline
  (`app_headline`). The **locator map** (`BuoyLocator`) is now interactive: scroll-zoom +
  +/- controls and **flies to the buoy on switch** (`easeTo`; first render keeps the
  all-buoys overview). The redundant **static bottom mini-map was removed**
  (`MiniMap.tsx` + `ExpandedMap.tsx` + `public/map/*.png` deleted) — the station block is
  now a compact Position/Sensor/Operator strip (Water-depth fact dropped: always "not
  published"). **Data-source attribution unified** across the top bar + footer with one
  icon family (`brands.tsx`: GitHub / Hugging Face / CANDHIS-buoy). The **footer carries a
  discreet build stamp** (`Build <sha> · <date>`, links to the GH commit): sha+date read
  from git in `vite.config.js` via `execFileSync` and inlined with Vite `define`
  (`__COMMIT_HASH__` / `__COMMIT_DATE__`, typed in `vite-env.d.ts`).

- **Tides (marée) shipped + reworked** (2026-07-05, specs/0008 incl. §8 revision):
  `ingest/tides.py` fetches **api-maree.fr** `/water-levels` (IFREMER/PREVIMER, CC-BY;
  `API_MAREE_KEY`, ingest-only) and derives high/low **extrema**, now **keyed by port** —
  `tides/<port>/raw/extrema.csv` accumulator + `tides/<port>/data/tides.parquet` tier on the
  bucket (gated ~daily by a forward-horizon check), shared across buoys. `schema.resolve_tide_port`
  maps each buoy to its nearest curated port (`TIDE_PORTS`, ≤40 km) and `build.py` writes the
  result into the manifest `tide` block (or null → empty-state). Runtime `webapp/src/lib/tides.ts`
  (raised-cosine `tidePhase` / `reconstructCurve` / `extremaSeries` / `tideHeightAt`) feeds:
  a **banner tide strip** (`TideStrip.tsx` — arc, phase word, **prev + next** PM/BM + live
  countdown, marnage in m + neap↔spring bar, **no coefficient**, plus **sunrise/sunset** from
  the pure `lib/sun.ts` NOAA calc) and a **synced chart panel** (`TimeSeries.tsx`) plotting the
  reconstructed **water-level curve with ▲/▼ high/low markers** (auto min/max Y; smooth 10-min
  curve on windows ≤21 d, raw-extrema zig-zag wider; water level in hover + summary; empty-state
  where no extrema). Attribution in footer + glossary. Verified on all 3 buoys with the key;
  key absent from `dist`. **Owner TODO:** create the api-maree.fr account + add the
  `API_MAREE_KEY` GitHub secret (site ids already validated via `/sites`).

- **Buoy-layout + pipeline CLI shipped** (2026-07-05, specs/0009): (1) buoy data on the bucket
  nests under a **`buoys/<campaign>/`** root (symmetric with `tides/<port>/`) — flipped in
  `update._buoy_prefix` + webapp `dataBase`; migrated live via `ingest/migrate_layout.py`
  (`pixi run migrate copy`, non-destructive; then `delete --yes` once the deployed site reads
  `buoys/`). Local mirror stays flat `hfdata/<campaign>/`. (2) The data pipeline got a **Typer +
  Rich CLI** (`ingest/ui.py` shared console): sectioned per-buoy steps (**cyan**) vs a distinct
  **tide** step (**blue**) + two end-of-run summary tables; CI-safe plain rendering with no TTY.
  `--campaign/-c` is now **repeatable** (not argparse `nargs=+`); `refresh-data.yml` updated.
- **Tide banner strip reworked** (2026-07-05, specs/0008 §9): the square arc became an
  integrated **tide-curve timeline** (prev extremum left/hollow → **now** dot on the curve →
  next right/filled, with per-end kind+time captions + countdown), and **sunrise/sunset moved
  into their own separated SUN zone** (no longer between tide facts). `TideStrip.tsx`.

Next per roadmap: side-by-side buoy comparison (0005 left it out), and the per-locale
**glossary JSON** + CI **key-parity** check (0001 §8) — the glossary still lives inline in
the Paraglide message dict for now.

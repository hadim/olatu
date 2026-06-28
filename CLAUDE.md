# CLAUDE.md

Project memory for AI coding sessions. Keep it short and current.

## What this is

**Olatu** — a fully static web app (GitHub Pages, no backend) that visualizes live
+ historical data from a single CANDHIS wave buoy: **06403, Saint-Jean-de-Luz**
(Atlantic / Basque coast). Data is read from committed Parquet/JSON in the browser.

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

## Layout

```
ingest/        Python (polars). NOT an installable package.
  schema.py    canonical column mapping, units, sentinel, headline/direction vars
  scrape.py    fetch the CANDHIS realtime HTML table -> per-year reel CSV (coalesce-merge)
  build.py     CSV -> tiered Parquet/JSON (archive-preferred coalesce)
  update.py    pull → scrape → build → upload to the HF dataset (OIDC in CI)
pixi.toml      Python env + frontend tasks (no pyproject; no Python library)
webapp/        the frontend (reads data tiers from the HF dataset at runtime)
specs/         decisions
.github/workflows/  deploy.yml (Pages, on code changes) + refresh-data.yml (data, */30)
```

> **Data lives in the HF dataset `hadim/olatu`, NOT in git** (see specs/0004).
> Layout: `<campaign>/raw/*.csv` (archive + reel accumulator) + `<campaign>/data/…`
> (manifest/latest/recent.json, year/*.parquet, hourly/daily.parquet). The webapp
> fetches `…/resolve/main/06403/data/…` (CORS-served). `hfdata/` (local working mirror)
> and `webapp/public/data/` (optional local build) are gitignored.

## Commands

```bash
pixi run update                      # pull → scrape → build → upload to HF (the usual refresh; OIDC in CI)
pixi run update --campaign 06403     # same, explicit campaign
pixi run scrape                      # lower-level: grow the local reel from the live feed (hfdata/06403/raw)
pixi run ingest                      # lower-level: build tiers from local raw (hfdata/06403/{raw,data})
pixi run check                       # ruff format + lint
pixi run webapp                      # frontend dev server (reads data from HF; VITE_DATA_BASE_URL to override)
pixi run webapp-build                # static build for GitHub Pages
```

One-time seed of the dataset: `pixi run update --campaign 06403 --seed-src /Users/hadim/Data/olatu/06403`.

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
- **Series has real gaps** (largest 50 days) → break the line, never interpolate across.
- **GitHub Pages base path:** fetch webapp assets via `import.meta.env.BASE_URL`,
  never a leading `/`. **Data tiers are different** — fetch them via `DATA_BASE`
  (`webapp/src/lib/data.ts`), the HF dataset resolve URL, not BASE_URL.
- **Parquet:** Snappy + `row_group_size≈1440` (multi-row-group, CI-asserted) so
  hyparquet range requests + column projection work.

## Current state (2026-06-28)

- Specs written; repo cleaned; `pixi.toml` + polars ingest done and **validated on
  real data** (≈214,900 rows, 2013→2026).
- **Data lives in the HF dataset `hadim/olatu`, not git** (foundation §5.3 migration
  done; see specs/0004). `ingest/update.py` does pull → scrape → build → upload;
  `.github/workflows/refresh-data.yml` runs it every 30 min keyless via OIDC trusted
  publisher; the webapp reads tiers from HF at runtime (no Pages redeploy on data
  change). Sea-temperature history accumulates forward from the scraper's first run.
- **Webapp rebuilt to TypeScript** (Plotly removed). Working: data loader for the
  JSON tiers + a current-conditions banner (compass dial, gauges, sea temp,
  staleness); **theme** toggle (dark default + light, CSS-var tokens) and **i18n**
  (en/fr/es, browser auto-detect, persisted) — both hand-rolled for now
  (Tailwind/shadcn + Paraglide come later per spec).
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

Next per roadmap: the direction glyph/cyclical layer, history navigation (date picker
+ heat-ribbon) polish, the full glossary, multi-buoy (06402 Anglet staged), and
migrating theme/i18n/styling to Tailwind + shadcn + Paraglide.

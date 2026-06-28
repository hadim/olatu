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
ingest/        Python (polars) CSV -> tiered Parquet/JSON. NOT an installable package.
  schema.py    canonical column mapping, units, sentinel, headline/direction vars
  build.py     the build script (run via pixi); default --out webapp/public/data
pixi.toml      Python env + frontend tasks (no pyproject; no Python library)
webapp/        the frontend
  public/data/ generated tiers (committed): manifest/latest/recent.json, year/*.parquet, hourly/daily.parquet
specs/         decisions
```

## Commands

```bash
pixi run scrape                      # grow realtime reel CSVs from the live CANDHIS feed (incl. sea temp)
pixi run update                      # scrape, then rebuild the tiers (usual refresh)
pixi run ingest                      # build data/ from CANDHIS CSVs (default src /Users/hadim/Data/olatu)
pixi run ingest --src DIR --out DIR  # override paths
pixi run check                       # ruff format + lint
pixi run webapp                      # start the frontend dev server (bundled Node)
pixi run webapp-build                # static build for GitHub Pages
```

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
- **GitHub Pages base path:** fetch every runtime asset via `import.meta.env.BASE_URL`,
  never a leading `/`.
- **Parquet:** Snappy + `row_group_size≈1440` (multi-row-group, CI-asserted) so
  hyparquet range requests + column projection work.

## Current state (2026-06-27)

- Specs written; repo cleaned; `pixi.toml` + polars ingest done and **validated on
  real data** (214,908 rows, 2013→2026). Data committed to `main` (acknowledged
  debt; migration path in foundation spec §5.3).
- **Webapp rebuilt to TypeScript** (Plotly removed). Working: data loader for the
  JSON tiers + a current-conditions banner (compass dial, gauges, sea temp,
  staleness); **theme** toggle (dark default + light, CSS-var tokens) and **i18n**
  (en/fr/es, browser auto-detect, persisted) — both hand-rolled for now
  (Tailwind/shadcn + Paraglide come later per spec).
- **uPlot synced multi-panel charts** (canvas) fed from `daily.parquet` via
  hyparquet (parquet-in-browser): wave height (Hs + Hmax), period, direction;
  range presets (1M/6M/1Y/5Y/All), shared crosshair + synced zoom, theme-aware.
  Panels with too little data auto-hide (temp, until the realtime feed accumulates).
- **Live**: https://hadim.github.io/olatu/ — deployed by `.github/workflows/deploy.yml`
  (official GitHub Pages Actions flow; Pages source = GitHub Actions). Pushes that
  touch `webapp/**` redeploy automatically.
- **Realtime scraper** (`ingest/scrape.py`, `pixi run scrape`/`update`): grows the live
  tail + sea-temperature history by parsing the CANDHIS realtime HTML table (one GET,
  no Valider/POST) into per-year `*_reel.csv`. `build.py assemble()` now does an
  archive-preferred column coalesce so the tail never clobbers the archive. See spec 0004.

Next per roadmap: 30-min detail via year parquet + the direction glyph/cyclical
layer, history navigation (date picker + heat-ribbon), the map, the full glossary,
and migrating theme/i18n/styling to Tailwind + shadcn + Paraglide.

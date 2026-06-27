# CLAUDE.md

Project memory for AI coding sessions. Keep it short and current.

## What this is

**Olatu** — a fully static web app (GitHub Pages, no backend) that visualizes live
+ historical data from a single CANDHIS wave buoy: **06403, Saint-Jean-de-Luz**
(Atlantic / Basque coast). Data is read from committed Parquet/JSON in the browser.

> The GitHub repo is **`hadim/olatu`**. The local working directory may still be
> named `wave-buoys-viewer` (cosmetic; rename optional).

## ⚠️ Read the specs first

This project is **spec-driven**. Before implementing, read:

- [specs/README.md](specs/README.md) — the workflow + index
- [specs/2026-06-27-0001-foundation.md](specs/2026-06-27-0001-foundation.md) —
  vision, **chosen stack**, data-ops, feature spec, UX direction, **roadmap (7 phases)**
- [specs/2026-06-27-0002-data-dictionary.md](specs/2026-06-27-0002-data-dictionary.md) —
  canonical schema + plain-language definition of every variable

## Layout

```
ingest/        Python (polars) CSV -> tiered Parquet/JSON. NOT an installable package.
  schema.py    canonical column mapping, units, sentinel, headline/direction vars
  build.py     the build script (run via pixi)
pixi.toml      Python env + tasks (no pyproject; no Python library)
data/          generated tiers (committed): manifest/latest/recent.json, year/*.parquet, hourly/daily.parquet
webapp/        the frontend (currently React+Vite+Plotly; being rebuilt — see roadmap)
specs/         decisions
```

## Commands

```bash
pixi run ingest                      # build data/ from CANDHIS CSVs (default src /Users/hadim/Data/fff)
pixi run ingest --src DIR --out DIR  # override paths
pixi run check                       # ruff format + lint
cd webapp && npm run dev             # frontend dev server
```

## Conventions & gotchas

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

Phase 1 in progress: specs written; repo cleaned (old synthetic data / notebooks /
Python package removed); `pixi.toml` + polars ingest done and **validated on real
data** (214,908 rows, 2013→2026). Next per roadmap: webapp TS migration, then uPlot
charts replacing Plotly. Data is currently committed to `main` (acknowledged debt;
migration path in foundation spec §5.3).

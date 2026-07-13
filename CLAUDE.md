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
  build.py     CSV -> tiered Parquet/JSON (archive-preferred coalesce)
  update.py    pull → scrape → tides → build → upload to the HF bucket (OIDC in CI) + daily reel snapshot; Typer CLI (-c repeatable)
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
- The webapp fetches `…/buckets/hadim/olatu/resolve/buoys/<campaign>/data/…` (and
  `…/resolve/tides/<port>/data/…`) — public, CORS, range, **no `main` revision**. The **local**
  working mirror stays flat at `hfdata/<campaign>/{raw,data}`; only the bucket nests under
  `buoys/`. `hfdata/` and `webapp/public/data/` are gitignored.

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
  else no tide). Runtime `webapp/src/lib/tides.ts` reconstructs the raised-cosine curve; marnage
  in metres (**no coefficient**). Predictions cover ~±30 days → older windows empty-state (like
  temp). Missing key/port is non-fatal (tide step skips). Valid site ids: 06403
  `saint-jean-de-luz`, 06402 `boucau-bayonne-biarritz`, 03302 `cap-ferret`.

## Status

Shipped and live at **olatu.io** — foundation → PWA → analytics/legal (specs 0001–0011). The full
feature-by-feature history is in **[docs/HISTORY.md](docs/HISTORY.md)**; the spec index +
statuses are in [specs/README.md](specs/README.md).

**Open owner TODO:** create the api-maree.fr account + add the `API_MAREE_KEY` GitHub secret so
tides refresh in CI (site ids already validated). **Next per roadmap:** side-by-side buoy
comparison, and the per-locale glossary JSON + CI key-parity check.

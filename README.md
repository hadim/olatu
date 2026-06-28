# 🌊 Olatu

> *Olatu* — Basque for "wave".

A fast, beautiful, **fully static** web app to read what the sea is doing at the
**CANDHIS wave buoys of the French Atlantic coast** — right now, and across their
history. Switch between **Saint-Jean-de-Luz** (06403), **Anglet** (06402) and
**Cap Ferret** (03302) from a map, with a shareable `?buoy=<id>` URL.

No backend, no account, no API key. The browser reads tiered Parquet/JSON straight from
an open **Hugging Face dataset** and renders it with pixel-perfect canvas charts.
Deployed on GitHub Pages.

![Olatu — live & historical sea state for the Basque-coast CANDHIS wave buoys](docs/screenshot.png)

- **Live:** https://olatu.io
- **Data source:** [CANDHIS](https://candhis.cerema.fr) — the French national in-situ
  wave-measurement network, operated by [Cerema](https://www.cerema.fr). Datawell
  directional Waverider buoys, one measurement every 30 minutes:
  - **06403 — Saint-Jean-de-Luz** (43.408° N, 1.682° W), ~3 km off the Belharra reef;
  - **06402 — Anglet** (43.532° N, 1.615° W), off the Adour estuary;
  - **03302 — Cap Ferret** (44.653° N, 1.447° W), off the Gironde / Arcachon coast.
  - *The Basque buoys carry full history back to 2013/2009; Cap Ferret was added
    realtime-only — its history accumulates forward from when scraping began.*
- **Open data:** the cleaned, refreshed tiers live in the public Hugging Face dataset
  [**`hadim/olatu`**](https://huggingface.co/datasets/hadim/olatu) — re-scraped from
  CANDHIS every 30 minutes and reusable by anyone (CORS-served Parquet/JSON).

> 🚧 **Status: active development.** Rebuilt from scratch for a much nicer UX and
> pixel-perfect data-viz. Working today: a buoy switcher (segmented control + map
> locator), a current-conditions banner with a compass dial and freshness state, synced
> uPlot charts with a heat-ribbon timeline and a date jumper, a lazy MapLibre detail map,
> a definitions glossary, dark/light themes and EN/FR/ES. Still on the roadmap: the
> direction-glyph layer and the Tailwind + shadcn + Paraglide migration. See
> [`specs/`](specs/) for the plan and decisions.

## What it does

- **Several buoys, one tap** — pick a buoy on the map or the switcher and the whole
  page follows; the choice is remembered and shareable via the URL.
- **Current conditions at a glance** — wave height, swell direction, period and sea
  temperature, with a clear "how fresh is this reading?" indicator.
- **Time travel** — today, this week, this month, any past year, or a precise custom
  date range, down to 30-minute detail.
- **Every value explained** — a plain-language definition for each variable, so you
  always know what you're looking at.
- **Multilingual** — English, French, Spanish. **Desktop and mobile**, both first-class.

## How it's built

| Layer | Tech |
|-------|------|
| Frontend | React + Vite + TypeScript, **uPlot** (canvas charts), MapLibre (lazy map), CSS-var theming |
| Data in the browser | [hyparquet](https://github.com/hyparam/hyparquet) — reads Parquet directly, no WASM |
| Data pipeline | **Python + [polars](https://pola.rs)** (CANDHIS CSV → cleaned, tiered Parquet/JSON), managed by [pixi](https://pixi.sh) |
| Data hosting | Hugging Face **dataset** [`hadim/olatu`](https://huggingface.co/datasets/hadim/olatu) (public, CORS), refreshed every 30 min by GitHub Actions |
| Site hosting | GitHub Pages (static) |

The site and its data are **decoupled**: the every-30-minute refresh re-uploads data to
the Hugging Face dataset without ever rebuilding or redeploying the webapp.

## Repository layout

```
ingest/              Python (polars) pipeline: CANDHIS CSV → tiered Parquet/JSON, per campaign
  schema.py          per-buoy identity registry (BUOYS) + canonical column mapping
  scrape.py / build.py / update.py   scrape live feed · build tiers · pull→scrape→build→upload to HF
webapp/              the frontend (reads the data tiers from the HF dataset at runtime)
  src/lib/buoys.ts   the buoy registry powering the switcher + locator map
specs/               design & decision records (this project is spec-driven)
```

Data is **not** in git — it lives in the Hugging Face dataset, laid out per campaign as
`<campaign>/raw/*.csv` (sources) and `<campaign>/data/…` (the tiers the webapp fetches).

## Getting started

Requires [pixi](https://pixi.sh).

### Data pipeline

```bash
pixi install
pixi run update                      # pull → scrape → build → upload to HF (campaign 06403)
pixi run update --campaign 06402     # same, for Anglet
```

`update` pulls the realtime accumulator from the dataset, scrapes the live CANDHIS feed,
rebuilds the tiers, and uploads them back — the same command runs locally (your stored
`hf` login) and in CI (keyless OIDC). Lower-level `pixi run scrape` / `pixi run ingest`
work on a local `./hfdata/<campaign>/{raw,data}` mirror.

### Frontend

`pixi` bundles Node, so no separate install is needed:

```bash
pixi run webapp          # start the local dev server (reads data from the HF dataset)
pixi run webapp-build    # static build for GitHub Pages
```

Point the app at a different data root with `VITE_DATA_BASE_URL` (must end in `/`; the
app appends `<campaign>/data/`). Or use npm directly inside `webapp/`.

## Contributing & bug reports

Contributions, ideas and bug reports are very welcome — please
[open an issue](https://github.com/hadim/olatu/issues) or a pull request.

## License & attribution

- **Code** is released under the [MIT License](LICENSE).
- **Wave data** is © **Cerema / CANDHIS** and is provided under the CANDHIS
  [conditions of use](https://candhis.cerema.fr/doc/01_Utilisation.fr.pdf). This is an
  independent community viewer and is **not** an official Cerema/CANDHIS product.

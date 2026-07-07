# History — what's shipped

Reverse-chronological log of shipped milestones (newest first). Each entry summarizes
**what a spec became in the code** and the few implementation facts worth remembering later.

**This file is the append target, not CLAUDE.md.** When you ship something, add a dated
entry here — keep CLAUDE.md a stable operating manual. Intent & decisions live in
[`specs/`](../specs/); non-obvious findings in [`specs/LEARNINGS.md`](../specs/LEARNINGS.md).

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

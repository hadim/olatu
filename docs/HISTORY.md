# History — what's shipped

Reverse-chronological log of shipped milestones (newest first). Each entry summarizes
**what a spec became in the code** and the few implementation facts worth remembering later.

**This file is the append target, not CLAUDE.md.** When you ship something, add a dated
entry here — keep CLAUDE.md a stable operating manual. Intent & decisions live in
[`specs/`](../specs/); non-obvious findings in [`specs/LEARNINGS.md`](../specs/LEARNINGS.md).

---

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

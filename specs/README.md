# Specs

This project is **spec-driven**. Before a phase is implemented, the decisions
behind it are written down here so the work stays coherent across many sessions.

## How it works

- Specs are **timestamped and numbered**: `YYYY-MM-DD-NNNN-slug.md`.
- A spec is the source of truth for *intent and decisions*; the code is the source
  of truth for *implementation*. When they disagree, fix one of them on purpose.
- Specs are append-mostly. We don't silently rewrite history — if a decision
  changes, add a new spec (or a dated "Revision" section) that **supersedes** the
  old one and link both ways.
- Each spec carries a `Status:` (`Draft` → `Accepted` → `Implemented` /
  `Superseded`).

## When does work need a spec?

Ask this for **every** request or task (and when in doubt, **ask the owner**):

- **Write/update a spec** for: a new feature or capability, an architecture or
  tech-stack decision, a data-model/schema change, a UX direction, or anything with
  non-trivial scope or real trade-offs — i.e. anything a future session would need
  to understand the *intent* behind.
- **No spec needed** for: trivial/mechanical edits, small bug fixes, cosmetic tweaks,
  dependency bumps. (If a fix revealed a non-obvious *learning*, log it in
  [LEARNINGS](LEARNINGS.md) instead.)
- A single request that bundles **several things** can map to **one or several**
  specs — split by coherent topic.
- Update the spec *as part of* the task, not after; keep code and spec in sync.

## Index

| Spec | Status | Summary |
|------|--------|---------|
| [0001 — Foundation](2026-06-27-0001-foundation.md) | Draft | Vision, data reality, tech stack, data-ops, features, UX, roadmap |
| [0002 — Data dictionary](2026-06-27-0002-data-dictionary.md) | Draft | Buoy identity + canonical schema + plain-language definition of every variable |
| [0003 — UX refinement](2026-06-27-0003-ux-refinement.md) | Draft | First owner-feedback polish pass: chart fixes, banner/staleness, terminology (vague/houle), definitions, time nav |
| [0004 — Realtime scraper](2026-06-27-0004-realtime-scraper.md) | Accepted | The live-growing tail: scrape CANDHIS realtime HTML (single GET, no Valider/POST) → per-year reel CSV; coalesce merge so temperature history accumulates without clobbering the archive |
| [0005 — Multi-buoy](2026-06-27-0005-multi-buoy.md) | Accepted | Add CANDHIS 06402 Anglet; finish the campaign parameterization (build.py); webapp buoy switch (segmented control + lazy map picker), top station bar, HF data-source surfacing |
| [0006 — Stack migration & a11y](2026-06-28-0006-stack-migration-a11y.md) | Accepted | Pay down stack debt (theme/i18n/styling → Tailwind v4 + shadcn/Radix + Paraglide, full utility rewrite) + Phase-7 polish/mobile/a11y (chart fallback table, pinch-zoom, reduced-motion, ARIA, AA contrast) |
| [0007 — Identity, home nav & attribution](2026-07-05-0007-identity-nav-attribution.md) | Implemented | One "O" wave-barrel logo (favicon + header), clickable home + headline, live buoy-aware locator map (scroll-zoom + fly-to), drop the redundant static mini-map & water-depth fact, unified data-source icon family, discreet footer build stamp |
| [0008 — Tides (marées)](2026-07-05-0008-tides.md) | Accepted | Tide state in the banner + a dedicated chart panel: fetch api-maree.fr water levels (IFREMER/PREVIMER, CC-BY) in a new `ingest/tides.py`, derive high/low extrema into a forward-growing accumulator + `tides.json` tier on the HF bucket; runtime `lib/tides.ts` (raised-cosine phase + curve); marnage in metres as the primary metric; `API_MAREE_KEY` secret, ingest-only. **§9 revision:** banner strip reworked into an integrated tide-curve timeline (prev→now→next) + a separated sun zone. **§10 revision:** a tide **calendar** popover beside the phase word — month grid with a per-day marnage bar + the selected day's extrema, days grouped in the buoy's zone, bounds read off the accumulator. **§11 revision:** ingest switches to the API's `/tide-extrema` (one request, extrema **+ coefficient**, replacing our own peak detection) and the French **coefficient de marée** ships as a *secondary* readout beside the marnage |
| [0009 — Buoy-layout & pipeline CLI](2026-07-05-0009-buoy-layout-and-cli.md) | Accepted | Nest buoy data on the bucket under a `buoys/<campaign>/` root (symmetric with `tides/<port>/`) via a non-destructive two-phase migration (`ingest/migrate_layout.py`); Typer + Rich CLI for the data pipeline (`ingest/ui.py`) with buoy/tide work colour-separated + CI-safe plain rendering |
| [0010 — Installable PWA](2026-07-05-0010-pwa.md) | Implemented | Make Olatu installable (Add to Home Screen) on Android/iOS/desktop + an offline app shell via `vite-plugin-pwa` (Workbox): committed generated icons (incl. maskable), manifest (`standalone`, relative scope), NetworkFirst for the live HF data tiers so the refresh stays authoritative, silent `autoUpdate` |
| [0011 — Analytics, consent & legal](2026-07-07-0011-analytics-consent-legal.md) | Implemented | Consent-gated Google Analytics 4 (`G-XWQEVH6TD8`) via Consent Mode v2 — gtag loaded only after an explicit Accept, `anonymize_ip`, ads permanently denied; a persisted, revocable Accept/Decline banner; EN/FR/ES legal pages (mentions légales / privacy / contact, editor = Hadrien Mary, contact via GitHub) served through a tiny hash router (`#/privacy`), footer-linked |
| [0012 — Wind (vent)](2026-07-24-0012-wind.md) | Accepted | Wind per buoy from the nearest coastal Météo-France station (shared per-station like tides/ports). Each station is **one buoy-style tiered dataset** under `wind/<station>/` (`wind.build_station` mirrors `build.py`: manifest + latest/recent + year/hourly/daily): a one-shot hourly history (open bulk files, keyless, 2010→) fused with a forward-growing 6-min live feed (DPObs API, `METEOFRANCE_API_KEY`, `apikey` header), 8 canonical vars. Folded into `update()`. Webapp is spec 0013 |
| [0013 — Wind in the webapp (UX)](2026-07-24-0013-wind-webapp-ux.md) | Accepted | Surface wind around the **Mer/Air realm** system (buoy=teal, station=amber `--c-wind`), constant across all three surfaces. A station picker beside the buoy switcher (default = manifest pointer, override persisted per buoy); Current Conditions rebuilt into **two realm zones** + the cross-realm **offshore/onshore** bridge (`lib/wind.ts`); station timeseries on the buoy's shared x-axis, realm-tagged, with **hide/reorder + chip tray** (persisted). Station loads with the same code path as a buoy (`windBase` + station-keyed loaders). Kept the collapsible station bar. **§6 revision (2026-07-25):** owner-feedback polish — causal-EWMA gap fix, direction colour-code on both realms, Air hover values + on-plot cursor bubble, humidity/pressure panels, verdict-to-top + softened, sub-day presets, map station markers, Météo-France attribution / HF link dropped |
| [0014 — Units & settings](2026-07-25-0014-units-settings.md) | Accepted | A header-gear settings modal to pick display units — wind speed (m/s · **km/h default** · kn), temperature (°C · °F, shared sea+air), pressure (hPa · inHg · mmHg). `lib/units.tsx` (context + pure conversions keyed by column name) applies + persists (`olatu.units`) the choice everywhere: Current Conditions, chart panels + heading unit tags, hover readout. Convert at the last moment; canonical storage unchanged. **§6 revision:** clock format (Auto · **24 h** · 12 h) joins the same store — `hourOpts` in `lib/format` feeds every time formatter |
| [0015 — Current Conditions density](2026-08-07-0015-current-conditions-density.md) | Accepted | Density pass on the two realtime realm zones (~36 % less height, same ten readings): the dial shrinks to 128 px and stops repeating the cardinal + degrees it already prints, every reading becomes one `Metric` tile in a grid that fills edge to edge (Mer 4-up, Air 6-up — no `max-w` cap, no over-wide columns), the wave-height hero becomes a type-size variant, and the offshore/onshore verdict folds into the header row. **§3:** 24 h micro-trends (sparkline + 3 h delta + range) were built and **rejected by the owner** — this card stays a pure real-time snapshot; history belongs to the chart stack. **§7 revision (2026-08-21):** freshness becomes **per realm** — the single buoy-fed header badge splits into one badge per `ZoneHeader` (Mer reads the buoy tier, Air the station tier) and the `stale` desaturation applies per zone, after a CANDHIS-wide freeze made a 14-min-old station render as dead as a 5-h-old buoy |
| [0016 — Touch charts](2026-08-07-0016-touch-charts.md) | Accepted | Rework the chart stack's touch model: `touch-action: pan-y` + a JS axis-lock give **vertical scrolling back to the browser** (the stack used to `preventDefault()` every one-finger move, trapping the page for ~1700px on a phone); one finger horizontal now **scrubs to read values** instead of panning (pan moves to two fingers, and stays on ‹ ›/chips/ribbon); a compact **viewport-fixed readout bar** carries the scrubbed date/time and **persists after you lift your finger**, since the hover card sits ~1700px above the panel you're touching (or under your hand) |
| [0017 — Mobile layout, chart controls & readout](2026-08-10-0017-mobile-layout.md) | Accepted | Phone pass across every surface: only the page shell pays for the screen edge (cards/zones shrink their padding, the chart host's becomes `--ts-pad`); below 720 px the realm zones + tide strip **centre** and Sea keeps two tile columns (revises 0015 §2 for narrow widths); chart controls re-laid-out with **nothing removed** — ranges on one scrollable line, navigator always visible, smoothing/jump behind a phone-only ⚙ Options; panels shorten below 560 px; the readout becomes a **right-aligned, Sea/Air-grouped table** and **every panel drives it** (tide/Air map cursor → time → buoy index — the "plots aren't synced" report); the pinned touch bar gains values. Fixes three pre-existing bugs: plots built at `clientWidth` (padding included → clipped right edge), `sr-only` on a `<table>` (phantom horizontal scroll), and the `touch-none` history ribbon |
| [0018 — Precipitation window & aggregation](2026-08-24-0018-precipitation-window.md) | Accepted | `precipitation_mm` was the one **accumulation** in an all-state schema and was ingested as a state: one column carried **two windows** (1 h `RR1` history, 6 min `rr_per` live — a 10x cliff at the seam) and `_downsample` **averaged a total** (daily rain divided by 24, or 240 in the live era: 51.2 mm of rain reported as 2.1 mm). Probed the feeds to settle the stamping convention — both are **end-stamped** (`RR1` at H covers `(H-1h, H]`), exact on all seven probed hours. Fix: rain **sums** on a right-closed / left-labelled bucket (exact for both layers), the native tier carries a **trailing-hour** total so the seam disappears and native/hourly agree at `:00`, and the unit tag is tier-aware — **mm/h** on the fine tiers, **mm/24h** on the daily one |
| [0019 — Instant load & cache](2026-08-25-0019-instant-load-cache.md) | Accepted | The ~1 s blank-shell wait on every load: tier bodies are cached per URL on the device (IndexedDB) and painted **immediately** while the network copy revalidates in parallel — replacing them in place, or not re-rendering at all when the bytes are identical. One `DataStatus` widget makes it visible: determinate rail + pill on a cold load, a discreet "refreshing" chip on a warm one, an "updated" confirmation only for a refresh that changed something, and "showing your saved data" when the network fails with data on screen. Warm first paint ~250 ms vs ~900 ms cold |
| [LEARNINGS](LEARNINGS.md) | Living | Running log of significant findings (gzip/parquet, etc.) — update on every big finding |
| [HISTORY](../docs/HISTORY.md) | Living | What each spec became in the code — dated, newest-first changelog of shipped milestones |

## Conventions

- **Name:** the project is **Olatu** (Basque for "wave"). GitHub repo `hadim/olatu`,
  GH Pages base `/olatu/`. (Local working dir may still be `wave-buoys-viewer`.)
- **Language:** everything in this repo is in **English** (code, comments, specs,
  UI source strings). User-facing copy is then translated (EN / FR / ES).
- **Units & time:** SI-ish marine units (m, s, °, °C). All timestamps are stored
  **UTC** and rendered in the buoy's local zone (**Europe/Paris**).
- **Two buoys:** CANDHIS **06403 — Saint-Jean-de-Luz** (default) and **06402 — Anglet**
  (see [0005](2026-06-27-0005-multi-buoy.md)). The schema is multi-buoy ready
  (`campaign_id` is a column); the app shows one buoy at a time with a switch.

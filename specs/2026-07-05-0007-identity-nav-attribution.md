# 0007 — Brand identity, home nav, live locator & unified attribution

- **Status:** Implemented
- **Date:** 2026-07-05
- **Authors:** Hadrien Mary (+ implementation)
- **Touches:** header, locator map, station-location block, data-source attribution,
  footer build stamp. UX-polish follow-up to [0005](2026-06-27-0005-multi-buoy.md)
  (multi-buoy) and [0006](2026-06-28-0006-stack-migration-a11y.md) (stack/a11y).

> An owner-feedback polish pass focused on **identity and coherence**: one real logo used
> everywhere, a clickable "home", an actually-interactive locator map, and a single
> coherent visual language for "where the data comes from" — plus a discreet build stamp
> so anyone can tell which commit is live.

---

## 1. Decisions

### 1.1 One logo, everywhere (the "O" wave-barrel monogram)
The header used the 🌊 emoji while the favicon was three swell-lines — two unrelated marks.
Replaced by **one** mark: a wave that curls over into a tube, forming the **O of Olatu**,
on a dark rounded app-icon tile with the brand teal gradient (`#9CEFE2 → #38E1C6 →
#12A28E`). It reads at 16 px (favicon) and scales up cleanly (header, apple-touch).

- Source of truth: `webapp/src/components/brands.tsx` `<Logo>` (React).
- `webapp/public/favicon.svg` is a hand-kept **copy** of the same paths — change both
  together (there's a comment on each side saying so).
- `index.html` already points `icon` / `mask-icon` / `apple-touch-icon` at `favicon.svg`,
  so the new mark propagates to the tab, the pinned icon and the home-screen icon.

### 1.2 Header: clickable home, bigger, with a headline
- The logo + title are wrapped in a real `<a href={BASE_URL}>` → clicking (or middle-click
  / open-in-new-tab / keyboard) returns to the app root. This is a single-page app, so
  "home" = a clean reload of the default/persisted buoy.
- Title and icon are enlarged; a **static headline** (`app_headline` — "Live wave & swell
  · French Atlantic coast") sits under the title. The old dynamic "CANDHIS <id> · <name>"
  subline was dropped from the header — it's redundant with the station switcher (which
  highlights the active buoy) and the conditions banner (which names it).

### 1.3 Locator map is now interactive
The top locator map (`BuoyLocator`) was a deliberately "calm" picker (scroll-zoom
disabled, static bounds). Now:
- **Scroll-wheel zoom** is enabled and on-map **+/- controls** are added (rotation still
  off).
- On a buoy **switch** it **flies** (`easeTo`, ~900 ms) to the newly-selected buoy. The
  first render still opens on the all-buoys overview (a `firstSelect` ref guards the
  initial effect run), so the picker context is shown before the user commits.

**Basemap provider (2026-09-10):** the keyless CARTO raster tiles were replaced by
**OpenFreeMap** vector styles (`positron` / `dark`) after CARTO began stamping "API KEY
REQUIRED" across every free tile. Same design — those styles *are* Positron / Dark Matter —
so the map is unchanged to look at. OpenFreeMap declares no `attribution` on its sources, so
the OSM + OpenFreeMap credit is passed to MapLibre as `customAttribution`.

### 1.4 Bottom station-location block: drop the static map & water depth
The bottom block had a **static PNG mini-map that never changed per buoy** (it always
showed the same committed image) plus a fact grid. With 1.3 making the *top* map live and
buoy-aware, the static map was redundant, so:
- Removed `MiniMap.tsx` + `ExpandedMap.tsx` and the committed `public/map/*.png`. (The
  full-screen expand + "open in OpenStreetMap" affordance goes with them; the interactive
  top map covers exploration.)
- Dropped the **Water depth** fact — it is `null` ("not published") for all three buoys,
  so it was pure noise. The block is now a compact **Position · Sensor · Operator** strip.

### 1.5 Unified data-source attribution + a coherent icon family
Attribution was scattered and inconsistent (a top "Data: …" line with underlined text
links; a footer with different styling). Now both use **one icon family** and one link
style (`brands.tsx`): GitHub (Octocat), Hugging Face (a monochrome smiling face), and
CANDHIS (a measurement-buoy glyph). All inherit `currentColor` and share the same
hover-to-accent treatment, so the top source line and the footer read as one system.

### 1.6 Discreet build stamp in the footer
The footer now shows **which commit is live and when it shipped** — `Build <short-sha> ·
<date>`, linking to `github.com/hadim/olatu/commit/<sha>`. The sha + ISO commit date are
read from `git` at **build time** in `vite.config.js` (`execFileSync`, no shell) and
inlined via Vite `define` as `__COMMIT_HASH__` / `__COMMIT_DATE__` (declared in
`vite-env.d.ts`). Falls back to "Build dev" when git is unavailable. CI checks out the
repo, so this resolves the pushed commit that triggered the Pages deploy. The date is
formatted in the active locale from a fixed UTC-noon `Date` (never a bare
`new Date(iso)`), so the displayed day never tz-shifts.

### 1.7 Attribution that actually satisfies the licence (amendment, 2026-09-10)
1.5 made attribution *coherent*; it did not make it *compliant*. Reading Candhis's own
[Conditions d'utilisation des données](https://candhis.cerema.fr/doc/01_Utilisation.fr.pdf)
(Cerema, V1 2025-05-27) closed three gaps at once.

**The grant.** Candhis data is published under the **Licence Ouverte / Etalab v2.0**, which
names redistribution and commercial use explicitly. That is the legal basis for mirroring the
tiers on the public HF bucket — worth recording, because it is the question that keeps coming
back. It is conditional on naming **the source** *and* **the date the reused information was
last updated**, and we were doing neither properly.

- **The date is a licence term.** The footer credit now carries `· mise à jour du <jour>`,
  formatted in the buoy's zone (`fmtDay`) from **`manifest.span.end`** — the newest reading
  actually redistributed, *not* the build clock. Those two diverge exactly when it matters:
  the refresh rebuilds every 30 min through an upstream outage, so a `generated_at`-keyed
  credit would have claimed today's date over data frozen days ago.
- **The data now carries its own licence.** `manifest.source` (new, top-level — mirroring
  where a wind station's manifest keeps its `source`, spec 0012 §5, while `tide`/`wind` are
  pointers at *other* datasets and carry theirs inside) holds provider, partners, licence +
  licence URL, terms URL, last-update date and a paste-ready `credit` sentence, built by
  `schema.candhis_source(campaign, updated=…)`. Until now the parquet travelled the bucket
  naked: anyone pulling it directly, rather than through the webapp footer, had nothing to
  attribute it with. A webapp footer does not attribute a bucket.
- **"Cerema" was the wrong credit.** The conditions credit each campaign to the organisations
  behind it, and ours are not Cerema: **06403 → Département 64** (no Cerema at all), 06402 →
  Université de Pau / Cerema / Région Nouvelle-Aquitaine / CA Pays Basque / Port de Bayonne,
  03302 → Université de Bordeaux / Cerema / Shom. `BUOYS[...]["partners"]` holds them, and the
  station-facts strip is now **Position · Sensor · Partners**. `operator` stays and still means
  Cerema — it is the *network* operator, a different fact, not a shorter spelling of the same one.
- The legal page's IP section now states all three licences (Licence Ouverte for Candhis **and**
  Météo-France, CC-BY for the tides) and says plainly that Olatu redistributes them with source
  and last-update date. `footer_data_by` dropped its `©`: a bare copyright mark next to an
  open-licensed dataset framed the relationship wrongly.

**Cache-compat.** `Buoy.partners` and `Manifest.source` are typed **optional**: spec 0019 paints
from an IndexedDB manifest that may predate this, so both read defensively (partners fall back to
the operator fact, the date falls back to `span.end`, which has always existed).

## 2. i18n
New lowercase-snake keys in `messages/{en,fr,es}.json` (parity kept): `app_headline`,
`nav_home`, `footer_build`, `footer_build_title`. The `map_*`, `station_depth` /
`station_not_published` and `app_tagline` keys are now unused but left in place (harmless;
removing them is a separate cleanup).

## 3. Out of scope / follow-ups
- `og.png` still shows the old art — regenerate it with the new mark when convenient.
- Removing the now-dead i18n keys.
- A light-tile logo variant (the mark is a dark app-icon tile in both themes for now,
  which is an intentional app-icon look).

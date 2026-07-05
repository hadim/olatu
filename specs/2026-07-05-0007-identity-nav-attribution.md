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

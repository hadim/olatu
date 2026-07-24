# 0014 — Units & settings

**Status:** Accepted
**Date:** 2026-07-25
**Supersedes / relates:** graduates the "display-unit choice" open item from
[0013 §5](2026-07-24-0013-wind-webapp-ux.md); the realm system + wind surfaces are 0013.

## 1. Why

Olatu shows several physical quantities in one canonical unit each (wind **m/s**, temperature
**°C**, pressure **hPa**). Different audiences read different units — surfers on this coast think in
**km/h** for wind; some want **knots**, **°F**, or **inHg**. The owner's call: **default wind to
km/h**, and give a small **settings modal** to switch speed / temperature / pressure. The choice must
apply **everywhere the value appears** (Current Conditions, every chart panel + axis, the hover
readout) and **persist** across sessions.

## 2. Scope (what's convertible, what isn't)

Convert only the quantities with a genuinely useful alternative:

| Measure | Canonical | Options | Default | Digits |
|---|---|---|---|---|
| Wind speed (speed · gust) | m/s | m/s · **km/h** · kn | **km/h** | m/s 1 · km/h 0 · kn 0 |
| Temperature (sea + air) | °C | °C · °F | °C | 1 |
| Pressure (MSL) | hPa | hPa · inHg · mmHg | hPa | hPa 0 · inHg 2 · mmHg 0 |

Direction (°), wave height (m), period (s), rain (mm) and humidity (%) have **no** alternative worth
offering — they stay canonical and pass through untouched. Temperature is **shared**: one choice
drives **both** sea temp (Mer) and air temp (Air), so the two are always in the same unit.

## 3. Design

- **`lib/units.tsx`** — the single source of truth. A `Units` object `{speed, temp, pressure}`, pure
  conversion + formatting helpers keyed by the **data column name** (`measureKind('wind_speed_ms') →
  'speed'`, etc.), and a React context (`UnitsProvider` / `useUnits`) mirroring `theme.tsx`. Canonical
  → display conversion happens **at the last moment** (never in the stored data). The `°C→°F` map is
  **affine**, so it commutes with the charts' moving-average smoothing — convert after smoothing.
- **`components/Settings.tsx`** — a gear in the header opens a **Radix `Dialog`** (focus-trap, Esc,
  scroll-lock) with three `ToggleGroup` rows + a "reset to defaults". Live: flipping a unit reflows
  every value on the page immediately.
- **Persistence:** `olatu.units` (JSON, per-key validated, `try/catch`). Missing/invalid → the default
  for that key. A fresh visitor gets `{speed:'kmh', temp:'c', pressure:'hpa'}`.
- **Wiring:** `UnitsProvider` wraps `App` (inside `LocaleProvider`). `CurrentConditions` formats the
  five unit-bearing gauges via `formatKeyValue` + `keySuffix`. `TimeSeries` converts the plotted
  column, prints the unit in each **panel heading** (convertible via settings, else a fixed unit like
  `m`/`s`/`%`), and formats the hover chips + the on-plot cursor bubble; `units` is in the render
  effect's deps so a change redraws the charts.

## 4. Non-goals / later

- No **wave-height in feet** (surf "face height" is a different convention — punt until asked).
- No per-quantity locale defaults (e.g. °F for `en`) — the default is global; the user picks.
- Distance stays km; period stays s.

## 5. Touch list

- **`lib/units.tsx`** (new) · **`components/Settings.tsx`** (new).
- **`main.tsx`** — `UnitsProvider`. **`Header.tsx`** — the gear.
- **`CurrentConditions.tsx`** — units on speed/gust/air-temp/sea-temp/pressure gauges.
- **`TimeSeries.tsx`** — convert plotted values, heading unit tags, units-aware hover chips + cursor
  bubble + a11y summary.
- **`messages/{en,fr,es}.json`** — `settings_*` + `cc_hp_unavailable`.

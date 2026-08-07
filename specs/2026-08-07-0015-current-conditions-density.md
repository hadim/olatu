# 0015 — Current Conditions: density pass

**Status:** Accepted
**Date:** 2026-08-07
**Supersedes / relates:** revises the Current Conditions layout of
[0013 §4](2026-07-24-0013-wind-webapp-ux.md) (the two realm zones + the offshore/onshore bridge).
The realm system, the direction colour code, the glyph family and the unit handling
([0014](2026-07-25-0014-units-settings.md)) are **unchanged** — this spec only changes how much of
the block is air.

## 1. Why

Owner feedback: the two realtime blocks read well but the surface is **empty**. At ~1060 px of
content width each realm zone was ~300 px tall for 4–6 scalars. The measured causes:

1. **Triple redundancy under each dial.** The dial centre already printed `N` + `355°`; the caption
   below repeated "Swell direction / from N · 355°". ~70 px of height for one new fact (`±28°`).
2. **The dial owned a whole column** (176 px, `minmax(150px,0.8fr)`) to carry one value.
3. **The gauge grids were wide and short** — 3 tiles across ~600 px — and the Air zone's second row
   was capped at `max-w-[22rem]`, so the right half of that row was literally blank.
4. **The cross-shore verdict took a full-width band** for three tokens and a pill.

## 2. Decision

Keep the two realm **zones** (they carry Mer/Air, and 0013's whole colour+glyph system hangs off
them). Inside them:

- **The dial shrinks and stops repeating itself.** Max width 176 → **128 px**. Its centre keeps the
  cardinal + degrees, and that is now the *only* place they appear. The 3-line caption collapses to
  the direction label + its `InfoPopover`, plus the realm's second direction fact (`±28°` spread on
  Mer, `gust NNE · 30°` on Air), each kept to one line (`whitespace-nowrap`).
- **One uniform tile grid per zone.** Every reading is the same `Metric` tile — label above value.
  Wave height keeps its hierarchy through **type size alone** (a `hero` variant), not through a
  separate block above the gauges, so both zones share one grid rhythm.
- **The grids fill edge to edge at every breakpoint.** Mer **4-up** (2×2 under 1000 px, 1 under
  420), Air **6-up** (3×2 under 1000 px, 2×3 under 560). No `max-w` cap, no ragged last row, and no
  over-wide columns leaving rivers of white between values — the failure mode of an intermediate
  3-up Air row that was tried and discarded.
- **The verdict moves into the section header row** — title · verdict · freshness badge. It keeps
  the softened pill of 0013 §6 and drops to its own full-width line under 860 px.
- **Two short labels.** Six-up only works because `cc_air_temp_short` / `cc_sea_temp_short`
  ("Temp. air" / "Temp. mer") are printed instead of the full names, which stay in the popover
  title. Every other label already fits.
- **Labels reserve two lines** (`min-h-[2.3em]`). Several wrap once translated, and free wrapping
  staggered the value baselines across a row.
- **Tiles are left-aligned at every width.** The old gauges centred themselves under 720 px, which
  made sense as a single column; in the 2-column phone grid it reads as misalignment.

## 3. Explicitly rejected: micro-trends

A first pass filled the freed pixels with **information** rather than air: a 24 h sparkline, a 3 h
delta arrow and a 24 h min–max under every value, read from the `recent.json` tier `App` already
loads (plus `loadWindRecent` for the station). It worked and roughly tripled the facts per pixel.

**The owner rejected it: too much information — this block must stay a pure real-time snapshot.**
That is the durable decision here, not an implementation detail: Current Conditions answers *"what
is it doing right now"*, and the whole chart stack one scroll below answers *"how did it get
there"*. Do not re-add trend, history or forecast material to this card; put it in the timeseries.

Consequences: no `lib/trend.ts`, no `WindData.recent`, `components/Sparkline.tsx` stays the dead
module it was, and `lib/units` gains no delta conversion. (If a delta is ever shown anywhere, note
that a difference must NOT go through `convertKeyValue` — the °C→°F map is affine and would add its
+32 offset to a change.)

## 4. What this does not change

The realm colours, the direction colour-code (N teal · E blue · S gold · W pink), the glyph family,
the `InfoPopover` definitions, the staleness semantics, the tide strip, and every unit/clock
behaviour from 0014. Webapp-only: no data-tier, ingest or manifest change.

## 5. Effect

The two zones go from ~630 px of height to ~400 px (**≈ 36 % less**) at 1171 px viewport, with the
same ten readings and the same scan path (realm tag → dial → hero value → tiles). The tide strip now
sits above the fold on a laptop.

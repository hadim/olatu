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
- **The type scales with the TILE, not the viewport.** Every tile is a `@container` and its value
  is sized in `cqw` (`clamp(1.55rem,20cqw,2.35rem)`, hero `clamp(2.4rem,30cqw,3.6rem)`). This is the
  fix for the *second* round of owner feedback — after the layout pass the block was shorter but a
  ~190px Mer cell still held a 25px number, so it read empty. Viewport units cannot do this job:
  the page is capped at `max-w-[1100px]`, so past ~1140px a `vw`-sized number stops tracking the box
  it sits in, and a Mer cell (~187px) and a six-up Air cell (~121px) would get the same size anyway.
  The percentages are set by the widest string each tile must hold **without wrapping** — Air's
  "1 020 hPa" fixes its floor, the four-up Mer cell allows its ceiling, and the `clamp` max stops a
  one-column phone tile (~300px) rendering a 60px number. Measured: Mer 37px / hero 56px, Air 26px,
  no overflow at 390 · 880 · 1100 · 1400px.
- **Values align by `subgrid`, not by reserved space.** Each tile spans two rows of its zone grid
  and adopts them (`grid-rows-subgrid`), so the label track is exactly as tall as the tallest label
  in that row. The label is `self-start`, the value `self-end` — that last part is what puts the
  wave-height hero and the three smaller Mer values on **one baseline**. The earlier `min-h` on the
  label did the same alignment job but cost a blank line's height whenever nothing actually wrapped,
  which is the common case.
- **The label is inline flow, not flex.** In a flex row the label text claims the whole line box, so
  a two-line label shoved the `i` badge to the far right where it read as belonging to nothing.
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

## 4. Browser support

`@container` and `subgrid` are both Baseline 2023 (Chrome 117+, Safari 16+, Firefox 110+). Neither
is load-bearing for correctness: without container queries `cqw` falls back to the small-viewport
size and every value simply renders at its `clamp` ceiling; without subgrid the tile is an ordinary
two-row grid and values stop sharing a baseline across a row. Both degrade to "slightly less tidy",
never to broken or unreadable.

## 5. What this does not change

The realm colours, the direction colour-code (N teal · E blue · S gold · W pink), the glyph family,
the `InfoPopover` definitions, the staleness semantics, the tide strip, and every unit/clock
behaviour from 0014. Webapp-only: no data-tier, ingest or manifest change.

## 6. Effect

The two zones go from ~630 px of height to ~400 px (**≈ 36 % less**) at 1171 px viewport, with the
same ten readings and the same scan path (realm tag → dial → hero value → tiles). The tide strip now
sits above the fold on a laptop, and the numbers grew with the space rather than leaving it blank —
the Mer values went 25px → 37px without the zone getting any taller.

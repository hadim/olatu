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

## 7. Revision (2026-08-21) — freshness is per realm, not per card

Revises §5 above ("the staleness semantics [are unchanged]") and the header row of §2, and with
them the single-source staleness model that came from
[0003](2026-06-27-0003-ux-refinement.md) back when the card only ever showed one feed.

### 7.1 Why

On 2026-08-21 the CANDHIS publication chain froze at 01:00 UTC. All three buoys — 06403, 06402 and
03302, 300 km of coast apart — stopped on the same minute, so this was upstream, not the buoys and
not our pipeline (which kept scraping, kept logging `newest timestamp did not advance`, and kept
uploading). Five hours later the card looked like this:

- the **one** `StalenessBadge` in the header row read the buoy tier alone (`latestTimestamp(latest)`),
  so it said "5 hours ago" — for the whole card;
- `saturate-[0.55]` fired on the **card element**, so the Air zone was greyed out too;
- the Air zone carried **no timestamp at all**.

The station was 14 minutes old. The freshest data on the page was rendered as the deadest, and a
reader had no way to tell that the wind numbers were still perfectly good.

That is not a bad threshold, it is a modelling error: since 0012/0013 this card shows **two
unrelated feeds** — CANDHIS every 30 min via HTML scrape, Météo-France every 6 min via DPObs — which
fail **independently**. One badge can only ever be right about one of them.

### 7.2 Decision

**Each realm answers for its own source.** The freshness badge moves out of the header row and into
the `ZoneHeader` of each zone, at its trailing edge:

- Mer reads `latestTimestamp(latest)`, Air reads `latestTimestamp(wind.latest)`. Neither stands in
  for the other, and neither is derived from the other.
- The `stale` desaturation applies to **its own zone**, never to the card. A frozen buoy must not
  make a healthy station look dead.
- The header row keeps identity + the offshore/onshore verdict, and loses its badge — with two
  zone badges, a third one above them would be a summary of nothing.

The `fresh`/`aging`/`stale` thresholds (2 h / 6 h) are unchanged and shared. What is realm-specific
is the *explanation*: `cc_{fresh,aging,stale}_help` are now source-agnostic and a new
`cc_cadence_{sea,air}` line carries the reporting rhythm that makes an age legible — "the buoy
reports every 30 minutes" vs "the station reports every 6 minutes; Olatu refreshes every 30
minutes". Each badge's accessible name is realm-qualified (`Reading freshness · Air`) so the two
are distinguishable to a screen reader, and its popover title leads with the realm.

### 7.3 Notes

- `ZoneHeader` gains an optional `badge` slot placed with `min-[720px]:ml-auto`, **not** a bare
  `ml-auto`: below 720 px the whole header centres (0017) and an auto margin would break that. The
  badge simply wraps onto its own centred line there.
- This is display-only. No tier, manifest or ingest change — both timestamps were already loaded.
- The upstream freeze itself needs no code change: the scraper's coalesce-merge already handles it
  (it kept writing a valid, non-shrinking file throughout), so the series reconnects by itself
  whenever CEREMA republishes.

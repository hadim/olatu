# 0023 — Wave steepness (cambrure): how organised the swell is

**Status:** Accepted
**Date:** 2026-11-20
**Supersedes / relates:** adds a display-derived variable beside the schema of
[0002 — Data dictionary](2026-06-27-0002-data-dictionary.md) (and revises its §6 labels);
adds a Sea panel to the chart stack of [0013](2026-07-24-0013-wind-webapp-ux.md) /
[0017](2026-08-10-0017-mobile-layout.md); corrects the spread definition shipped with
[0003](2026-06-27-0003-ux-refinement.md).

## 1. Why

On **2026-11-20** the 06403 buoy read **3.5–3.9 m at 12 s** and every Anglet webcam showed a
chaotic, unsurfable sea. The owner's question: the same two numbers could just as well describe
a groomed sea with long lines — *what is the variable that tells the two apart, and can we
compute it from what we have?*

Height and period say **how much** energy there is. What separates the two seas is how that
energy is **spread**: one long period arriving alone (a swell that travelled, and sorted itself
on the way — long waves run faster), or every period at once (a storm next door). Three layers
of disorder, with three different lifetimes:

| Layer | Cause | Gone when |
|---|---|---|
| Chop (1–4 s) | local wind, now | 1–3 h after the wind drops |
| Wind sea (5–9 s) | the last 12–24 h of wind over the Bay | about a day |
| Disorganised swell | the storm was too close to sort its periods | never — it takes another swell |

(Orders of magnitude, not measurements.)

We looked at what the data can say about it — 13 years of 06403, 222 420 half-hourly readings:

- **Steepness** (height ÷ wavelength) is the one usable real-time proxy. It follows the wind
  (rank correlation 0.35 with the wind at Socoa now, 0.48 with its 24 h mean; 0.67 among 4 m
  seas) but is not *only* the wind: among 4 m seas under less than 11 km/h of wind it still
  spans 1.0–1.6 %.
- **Directional spread does not discriminate here.** It sits in 20–35° for 90 % of the time at
  06403 (16–32° at 06402, 13–28° at 03302), with the same median (~27° among 4 m seas) whatever
  the wind, and it jumps 12° → 34° within hours in the realtime feed. The app's own definition promised "small =
  one clean swell" (§7).
- **Spectral width** (`EPS2`, `KAPA`, `Tp/T02`) exists only in the archive, which lags by weeks
  (last `Tp` on 2026-10-31 when checked on 11-20), and does not follow the wind in the history.
- **No ground truth.** Nothing here was calibrated against observed sessions.

The week itself is the best illustration: the swell arrived clean on Wednesday 18 around
22:30 Paris (3.3 m at 14.4 s, **1.0 %**), the front passed around 01:00 (46 km/h westerly), the
height rose while the period *fell*, and the buoy has read **1.6–1.9 %** ever since.

## 2. What it is

```
steepness (%) = 100 × H1/3 / L0        L0 = g · Th1/3² / 2π ≈ 1.56 × Th1/3²   (metres)
```

- **Inputs are the two realtime headline columns** (`significant_wave_height_m`,
  `significant_period_s`). The buoy does not measure a wavelength; linear theory gives it from
  the period.
- **Deep-water wavelength, on purpose.** The buoys sit in intermediate depth, but the offshore
  wavelength makes steepness a property of the *swell* — how far it is from the wind that raised
  it — comparable between buoys, rather than a property of the mooring depth (which CANDHIS does
  not publish).
- **Built on Th1/3, not Tp.** Realtime has no peak period. Th1/3 runs 1–2 s shorter than Tp, so
  these percentages are higher than a figure computed from a forecast site's Tp; the scale in §3
  is calibrated on Th1/3.
- **Not CANDHIS's `significant_steepness`** (SZ13D). That one is archive-only, computed per
  individual wave, and reads 2.2–2.9× ours (rank correlation 0.72). Different quantity; do not
  swap one for the other.

Physical meaning: wind raises steep waves; a swell that travels keeps its length, loses height,
and drops its short waves — so steepness falls with distance from the storm. A sea fully raised
by the wind sits around **2.5–3 %** (a fully developed Pierson–Moskowitz sea works out to
roughly 2.2–2.6 % on Tp, a little more on Th1/3; observed p99 = 2.9 %, max 4.7 %).

## 3. The reading scale

| Steepness | Name (EN / FR) | Examples | Share of time (06403) |
|---|---|---|---|
| < 0.5 % | very long swell / houle très longue | 1 m · 12 s, 2 m · 17 s | 12.6 % |
| 0.5–1.0 % | long swell / houle longue | 1.5 m · 11 s, 2 m · 13 s | 39.2 % |
| 1.0–1.5 % | short swell / houle courte | 2 m · 10 s, 3.3 m · 14 s | 26.2 % |
| 1.5–2.5 % | mixed sea / mer mélangée | 2.5 m · 9 s, 3.7 m · 12 s | 19.0 % |
| > 2.5 % | wind sea / mer du vent | 1 m · 5 s, 4 m · 9 s | 3.0 % |

Distribution: p5 0.36 · p25 0.67 · **median 0.98** · p75 1.42 · p95 2.28 %. Right-skewed, mode
around 0.6–0.8 %. Medians elsewhere: 1.12 % at 06402, 1.27 % at 03302 — one scale serves all
three.

Decisions:

- **The thresholds are provisional.** Only the top one has a physical anchor. They are meant to
  be compared with the webcams for a few weeks and moved (they live in one array,
  `STEEPNESS_CLASSES`).
- **The names describe the swell, never the surface.** An earlier draft said "clean swell" for
  the second class. Steepness is blind to local chop riding a long swell (§8), so a word about
  the *surface* would promise something this number cannot see. "Long for its height" is what it
  measures.
- **An absolute scale, not one relative to size.** Steepness rises with height (median 0.8 %
  under 1 m, 1.0 % at 1–2 m, 1.2 % at 2–3 m, 1.5 % at 3–4.5 m, 1.8 % above): a 4 m sea almost
  never drops under 1 %. That is physics — big seas here come from close storms — and an
  absolute scale stays simple and comparable. The note says so.
- **Not a surf score.** It is one of two readings; the other is the wind (force and
  offshore/onshore, already on screen). They fail and recover on different clocks, which is
  itself the information, and there is no ground truth to weight them into one number.

## 4. Computed in the browser, never stored

`lib/steepness.ts` `withSteepness(src)` adds a `wave_steepness_pct` column to whichever tier is
plotted. No ingest change, no new tier column, and the whole history from 2013 for free.

It is derived from the *plotted* tier, so on the aggregated tiers it is the ratio of two means:

| Tier | Error vs the mean of the half-hourly steepness |
|---|---|
| hourly means | ≤ 0.01 point for 95 % of hours |
| daily means | median 0.01 point; reads up to ~0.15 point **low** on a day that changed a lot (p95) |

Accepted: the daily tier is an overview. If it ever matters, compute the column at ingest and
average *it* — do not start storing it for any other reason (it would be a third thing to keep
in sync with the two it is made of).

## 5. The chart panel

A Sea panel, `steepness`, directly under height and period — the two series it is made of.

- **Fixed y-domain, 0–3 %.** It stretches only when the window holds one of the rare seas beyond
  it (0.7 % of readings — so a days-long window almost never, a year-long one always). The bands
  therefore sit at the same height from one visit to the next, and the panel is read by
  *position*.
- **The class bands are the ground** (`drawClear`, like the silence band of 0021, which paints
  over them). One neutral ink, more of it per class: sequential, not a traffic light — a steep
  sea is not "bad".
- **Ticks are the class boundaries** (0.5 · 1 · 1.5 · 2.5), so the only horizontal rules are
  the band edges.
- **Bands are named in place, at the left**, on a translucent plate painted *over* the line (as
  ground, the names were struck through wherever the curve crossed them). The names may not eat
  the plot: full names on a desktop, short ones on a tablet, and only the **two end bands** on a
  phone or whenever the bands are thinner than a line of type — enough to say which way the
  scale runs.
- **Neutral ink, not a ninth hue** (`--c-steep`). It is a reading *of* the measurements, and the
  palette had no hue left: every candidate collided with a neighbour or with the Air amber
  (lime ↔ wind amber ΔE 4.8 deutan; orchid ↔ direction violet 8.9 normal vision).
- **Hover:** the readout card gets a numeric `Steepness` row like any other; the on-plot bubble
  alone prints the class word (`1.7 % · mixed sea`).
- **Order.** A panel the stored order has never seen is inserted after its nearest default
  predecessor *of the same realm* (`reconcileOrder`), so a returning reader finds it under
  Period, not below the whole Air realm. Side fix: the order is now reconciled against **every**
  panel of both realms rather than the ones available at mount — before, a load where the
  station had not resolved yet dropped the Air ids from the store, so a custom Air order never
  survived a reload.

## 6. The note

Steepness is the one reading Olatu computes rather than relays, so its note is in one place: a
**Steepness (computed by Olatu)** section in the Definitions sheet. It is made to be scanned, not
read: one sentence, the five-row scale with examples, two short lists (*how to read it*, *what it
cannot see* — §8), and the formula on one line. The first cut was three paragraphs; the owner
asked for "a small table or an airy list, quick to understand".

The scale itself is one component (`SteepnessScale`), shared with the Current Conditions popover
(§9), so the two can never show a different scale.

The panel heading carries an **ⓘ** that opens the sheet scrolled to that section. The chart
headings are imperative DOM inside the uPlot host and cannot hold the React popover the tiles
use, so the bridge is a window event (`lib/glossary.ts` `openGlossary(anchor)`); the sheet moves
focus to the section it lands on.

## 7. Copy corrected on the way

- **Spread.** "Small = one clean, aligned swell; large = a confused sea" promised a cleanliness
  score that the data does not support at these buoys (§1). The definition now says what the
  number is (the fan of directions around the main swell), that it moves little near the coast
  and jumps between readings, and points to Steepness.
- **Wave-height scale: legend removed.** The glossary's height bands were named `glassy`,
  `smooth`, `clean / lively` — surface-quality words attached to a height alone, i.e. exactly the
  confusion this spec is about. They were first renamed to sizes; then the owner asked what the
  section was for and could not see what it described. It was the legend of the history ribbon,
  whose ~4 900 one-pixel daily bars blend into a tint nobody can match to a swatch — seven rows
  explaining a code the eye cannot read, in a note meant to be short. The section is gone; the
  ribbon keeps its colours (bar *height* already says the size), and 0002 §6 keeps the bands with
  size labels as documentation.

## 8. What it cannot see

- **Local chop on a long swell.** Th1/3 is the period of the *big* waves, so a 1 m · 12 s swell
  under a strong onshore thermal still reads 0.45 %. This is why the wind stays beside it.
- **Two long swells crossing.** Low steepness, peaky sea.
- **Anything at the beach**: banks, tide, the size a spot can hold. At 4 m the Anglet beach
  breaks are saturated whatever the steepness.
- **The future.** A buoy measures now. A forecast needs a wave model that separates swell from
  wind sea — a new data source and its own spec.

## 9. Current Conditions

A steepness reading in the card's header row, beside the offshore/onshore verdict and built like
it — the fact in mono (`Steepness 1.6 %`), the reading in a pill (`Mixed sea`, with a five-step
position gauge). The two answer one question together: the swell's own order here, what the
local wind does to its surface there.

**The whole pill is the button**, and it opens the *scale* with the current class marked: for
this reading the explanation is "where am I among the five", which a paragraph cannot show. One
sentence, the table, one hint, and a link on to the full note (§6). The shore pill got the same
treatment — its definition used to hide behind a 10 px "i" inside something that already looked
like a button.

It was first planned as a second step, once the scale had been lived with on the chart; the
owner chose to ship it with the panel (2026-11-20). The thresholds and words stay provisional,
and now show in two places.

- **Not a fifth tile.** A bare percentage means nothing without its word, and the Mer grid is
  four-up (0015).
- **Neutral, where the shore pill is coloured.** A steep sea is not an alarm and a long swell is
  not a promise (§8). The gauge is five equal steps with the active one taller and darker — not
  rising bars, which read as "full signal".
- **Computed from the values the tiles print, and only when height and period come from the
  same reading.** A height from 09:00 over a period from 08:30 is a ratio of nothing; the readout
  is then simply absent.
- **No smoothing.** The value moves ~6 % between readings and the class word changes on 12.8 %
  of them (6.4 % with a median over three). A median would be steadier, but the card would
  disagree with its own tiles and with the last point of the chart below it. The number rides
  beside the word precisely so that a borderline reading reads as borderline.
- **Mer only.** It stands without a paired station, and goes hollow and dashed with its zone
  when the buoy stops reporting (0015 §8) — a record of the last reading, not a reading.
- It is still a real-time snapshot (0015 §3): one value of now, no trend.

### Not in this spec

- **Calibration** against webcams or logged sessions.
- **Forecast** (§8).

## 10. Verification

- `npm run typecheck` and `npm run build` pass.
- Checked in a browser against the live bucket, 06403: 5D (native tier), 1Y (hourly), All
  (daily); dark and light; FR and EN; 1280 px and 390 px. Hover at 2026-11-19 21:30 reads
  3.7 m · 11.7 s → 1.7 % · mer mélangée (3.7 / (1.56 × 11.7²) = 1.73 %).
- A stored order without the new panel (`seatemp, height, period, tide, swelldir, wind, airtemp,
  winddir, …`) reloads as `…, period, steepness, tide, …` with the custom Air order intact.
- The ⓘ opens the sheet on the steepness section, with focus on it.
- The steepness pill opens the scale with `Mer mélangée` marked; "Définition complète" closes
  it and opens the sheet on the steepness section. The popover stays inside a 390 px screen.
- Current Conditions: 3.8 m · 12.4 s reads `Cambrure 1,6 %` · `Mer mélangée`; one header line at
  1280 px, readings on their own line from 980 px down, no horizontal overflow at 390 px. With
  the buoy's `latest.json` served 10 h old (intercepted in the test browser), the Mer zone goes
  dormant and the pill goes hollow and dashed with it.

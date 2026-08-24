# 0018 — Precipitation: accumulation window & aggregation

**Status:** Accepted
**Date:** 2026-08-24
**Supersedes / relates:** fixes the `precipitation_mm` variable defined in
[0012 — Wind ingest](2026-07-24-0012-wind.md) §2.3 and plotted by
[0013 — Wind webapp UX](2026-07-24-0013-wind-webapp-ux.md) §4. Display rules follow
[0014 — Units & settings](2026-07-25-0014-units-settings.md) (convert at the last moment).

## 1. Why

`precipitation_mm` is the only **accumulation** in an otherwise all-*state* schema (wind, temp,
humidity, pressure are instantaneous readings). It was ingested and aggregated as if it were a
state, which made it wrong in three compounding ways.

### 1.1 Two different windows in one column

| layer | source | field | window |
|---|---|---|---|
| history (2010 → 2026-07-24) | meteo.data.gouv bulk hourly | `RR1` | **1 h** |
| live (2026-07-24 →) | DPObs `infrahoraire-6m` | `rr_per` | **6 min** |

Same column, two windows. At the seam the series drops ~10x for no meteorological reason, and
[CurrentConditions.tsx](../webapp/src/components/CurrentConditions.tsx) renders the last raw value
labelled "mm" — i.e. **the rain of the last 6 minutes**, which is why the tile reads 0,0 almost
always.

### 1.2 Down-sampling averaged a total

[`wind._downsample`](../ingest/wind.py) applied `mean()` to every non-direction column. Averaging a
cumulative depth is meaningless; measured on Socoa:

| bucket | true total | stored | factor |
|---|---|---|---|
| 2026-02-16 (daily, history) | **51.2 mm** | 2.13 mm | ÷ 24 |
| 2026-02-10 (daily, history) | 37.9 mm | 1.58 mm | ÷ 24 |
| 2026-08-14 (daily, live) | 0.80 mm | 0.0034 mm | ÷ 236 |
| 2026-08-14 22:00 (hourly, live) | 0.40 mm | 0.04 mm | ÷ 10 |

The "years" view announced 2 mm for a day that took 51 mm. Worse, the divisor **changes at the
seam** (24 in the history era, ~240 in the live era), so even relative comparisons were false.

### 1.3 The stamping convention was never established

`group_by_dynamic(every=…)` buckets `[t, t+every)` and labels at the **left**. Both Météo-France
feeds stamp an accumulation at the **end** of its window, so the two conventions disagreed by up to
one hour — invisible while §1.2 dominated, but a real off-by-one once the sum is correct.

## 2. What the standard actually is

There is no single canonical window. The rule (WMO, and Météo-France's own products) is that a
precipitation total is **always reported over an explicitly named window**: RR1, RR3, RR6, RR12,
RR24. In practice **RR1 (1 h) is the reference for observation**, RR24 (06 UTC → 06 UTC in France)
for the climatological daily total. **Intensity** is the derived quantity and is expressed in
**mm/h** — the light / moderate / heavy / violent thresholds are defined in mm/h.

So "aligning on the standard" means: *a named window, a stated stamping convention, and mm/h when
we mean a rate* — not "convert everything to hourly".

### 2.1 Stamping — measured, not assumed

Météo-France's field descriptor (`H_descriptif_champs.csv`) says only *"RR1 : quantité de
précipitation tombée en 1 heure"*, and contrasts it with *"T : température sous abri
**instantanée**"* — so a row mixes instantaneous states and a trailing accumulation, but the
descriptor never states which hour `RR1` covers. Probed against the 6-min feed over a rainy evening
at Socoa (2026-08-23, DPObs):

```
     H    rr1   sum over (H-1h, H]   sum over [H, H+1h)
 17:00    0.0                  0.0                  0.0
 18:00    0.4                  0.4                  2.5
 19:00    2.3                  2.3                  2.2
 20:00    2.0                  2.0                  0.6
 21:00    0.6                  0.6                  0.0
 22:00    0.0                  0.0                  0.0
```

Exact on all seven hours for `(H-1h, H]`. **Both feeds are end-stamped**: `rr_per` at `T` covers
`(T-6min, T]`, `RR1` at `H` covers `(H-1h, H]`.

## 3. Decision

### 3.1 Storage — one window per tier, uniform within it

`precipitation_mm` stays the canonical name and stays in **mm**. What changes is that each tier now
carries **one stated window**, uniform across both source layers:

| tier | value | window | stamp |
|---|---|---|---|
| `year/` (native) + `latest.json` + `recent.json` | mm fallen in the **trailing hour** | 1 h rolling | end (the sample's own time) |
| `hourly/` | mm fallen in that hour | 1 h | **start** of the hour |
| `daily.parquet` | mm fallen in that UTC day | 1 d | **start** of the day |

The native tier becomes a **1-hour rolling total** evaluated at each native sample: in the history
era the rolling window contains exactly one `RR1` row, so the value *is* `RR1` (unchanged); in the
live era it is the trailing-hour sum of ten 6-min readings. One quantity — "rain in the last hour" —
sampled hourly then every 6 minutes. The seam stops being a cliff, and the native and hourly tiers
agree exactly at `:00`, so zooming never moves the rain.

The rolling sum is computed **per layer, before the hist/live coalesce**, so an hourly `RR1` is
never summed with the 6-min readings it already contains. Cost: for the ≤1 h of live samples right
at a station's seam the trailing window is short of history and under-reports. One hour, once per
station, at the 2026-07-24 boundary.

### 3.2 Aggregation — sum over `(t, t+every]`, labelled `t`

Precipitation aggregates with `sum()`, not `mean()` — the accumulation analogue of the circular mean
already used for the direction columns. The bucket is **right-closed, left-labelled**
(`closed='right', label='left'`), which given §2.1's end-stamping is **exact for both layers**:

- hourly, history: bucket labelled `H` holds the single `RR1` stamped `H+1h`, covering `(H, H+1h]`.
- hourly, live: bucket labelled `H` holds stamps `H+6min … H+1h`, covering `(H, H+1h]`.
- daily, history: bucket labelled `D` holds `D+01:00 … D+24:00` = exactly day `D`.
- daily, live: bucket labelled `D` holds the 240 stamps covering exactly day `D`.

Left-labelling puts the aggregate on the same convention as the mean columns beside it ("this row
describes the period *beginning* here"), so a bar sits over its own hour/day on the chart. The state
columns keep `mean()` / circular mean and their default left-closed bucket; the ≤1-sample boundary
difference between `[t, t+every)` and `(t, t+every]` is immaterial for a mean.

The daily bucket is the **UTC day**, like every other daily aggregate in the project — not the
climatological 06 UTC → 06 UTC day. Consistency inside the dataset beats matching a convention we
use nowhere else.

### 3.3 Display — mm/h at the fine tiers, mm/j at the daily tier

Per 0014 the stored value stays canonical and the unit is decided at the last moment. The window is
a property of the **tier**, so the unit tag is tier-aware:

| surface | reads | unit shown |
|---|---|---|
| Current Conditions rain tile | `latest.json` (trailing hour) | **mm/h** |
| rain panel, native + hourly tiers | 1 h window | **mm/h** |
| rain panel, daily tier | 1 d window | **mm/j** (`mm/d`, `mm/d`) |

"mm in the last hour" and "mm/h" are the same number, and mm/h is the standard intensity unit — so
the fine tiers get a unit that is both correct and immediately readable against the usual
thresholds. Rain has no alternative unit worth offering, so it stays out of the settings modal
(0014 §1 unchanged).

## 4. Consequences

- **Rebuild required.** `build_station` re-emits every tier from the immutable `raw/` accumulators,
  so `pixi run wind --all` is enough — no history re-fetch. The hourly history seed is untouched.
- **`daily.parquet` rain values change by ~24x** (and the live era by ~240x). This is the fix, not a
  regression; nothing downstream pins the old numbers.
- The glossary entry (`def_rain`, EN/FR/ES) must name the window — "over the last hour" — because
  "over the interval" was true and useless.
- 0012 §2.3's variable table said only "hourly accumulation" for `RR1` and never covered `rr_per`.
  It is corrected by this spec.

## 5. Rejected

- **Keep `mm` per raw interval and let the webapp divide by the cadence.** The native tier is
  mixed-cadence by construction, so the webapp would have to infer each row's window from the gap to
  its neighbour — the same fragile cadence guess that already bit the gap-break logic (0013, and the
  2026-07-25 LEARNINGS entry).
- **End-stamp the aggregates too.** Exact, but it labels 2026-02-16's rain at 2026-02-17T00:00, so
  every bar in the "years" view sits one day right of its day.
- **Store an intensity everywhere (mm/h in all tiers).** Makes `mean()` correct for free, but a
  daily tier in "mean mm/h" answers a question nobody asks; the daily total is the useful number.
- **Give the rain panel its own tier (always hourly).** Correct, but it puts a third data source and
  a third x-grid into `TimeSeries` for one panel, and costs a fetch on short spans.

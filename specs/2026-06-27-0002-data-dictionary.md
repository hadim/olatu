# 0002 — Data dictionary

- **Status:** Draft
- **Date:** 2026-06-27
- **Relates to:** [0001 — Foundation](2026-06-27-0001-foundation.md)

> This is the **single source of truth** for the canonical schema and the
> plain-language definition of every variable. The i18n glossary files
> (`glossary.{en,fr,es}.json`) and the `manifest.json` variable dictionary are
> generated/validated against this. Definitions come from the official Cerema
> CANDHIS *Format / Détail des paramètres d'états de mer* document (see Sources).
>
> Two definition levels per variable:
> - **Simple** — one line, for a casual surfer/beachgoer.
> - **Full** — 2–4 sentences, for an informed user.

---

## 1. Buoy identity

| Field | Value |
|-------|-------|
| Station | **06403 — Saint-Jean-de-Luz** |
| Network / operator | CANDHIS, operated by **Cerema** (+ Dept. Pyrénées-Atlantiques 64) |
| Coast | Atlantic / Basque coast, inner southern **Bay of Biscay** (~3 km off the **Belharra** reef) |
| Position | **43.408333 °N, −1.681667 °W** (43°24.5′N, 1°40.9′W) |
| Sensor | Datawell directional Waverider (GNSS displacement) |
| Cadence | one sea state every **30 minutes** (computed over a ~30 min record) |
| Water depth | not published in open docs → display "not published" |
| Timezone (display) | Europe/Paris (data stored UTC) |

Dominant swell clusters **W–NW (~290–310°)**; real (sentinel-excluded) `Hs`
median ≈ **1.18 m**, p99 ≈ **4.81 m**; `Tp` ≈ 11 s. Summer sea temperature reaches
the low-to-mid 20s °C (24.8 °C observed late June 2026).

---

## 2. Source file formats

Both feeds are `;`-delimited, half-hourly.

**Archive** `Candhis_06403_YYYY_arch.csv` (2013→2026), 73 columns:
`DateHeure; H13D; H110D; HMAXD; HSIGMA; HRMSD; H2%D; TH13D; TH110D; TAVGD; THMAXD;
TMAXD; ETAMAX; ETAMIN; SZ13D; SZMAXD; TSZMAXD; NBRE_VAG; SKEW; KURT; RHH; HM0; TP;
T02; TE; EPS2; KAPA; THETAP; THETAM; SIGMAP; SIGMAM; QUALITE; NBSYS;` then
`{HM0,TP,T02,TE,EPS2,KAPA,THETAP,THETAM,SIGMAP,SIGMAM}_S1..S4`.

**Realtime** `Candhis_06403_YYYY-MM-DD_reel.csv` (rolling ~48 h), 7 columns:
`Date; H1/3; Hmax; Th1/3; DirPic; EtalPic; TempMer`.

---

## 3. Canonical schema — overview

`snake_case` names, units, and which source feed provides each. **"For 06403"**
flags whether the column carries real data for *this* buoy.

| Canonical | Unit | Archive col | Realtime col | For 06403 |
|-----------|------|-------------|--------------|-----------|
| `campaign_id` | – | (added) | (added) | ✅ |
| `datetime_utc` | UTC | `DateHeure` | `Date`+`Heure (TU)` | ✅ |
| `significant_wave_height_m` | m | `H13D` | `H1/3` | ✅ **headline** |
| `significant_wave_height_tenth_m` | m | `H110D` | – | ✅ |
| `max_wave_height_m` | m | `HMAXD` | `Hmax` | ✅ **headline** |
| `significant_wave_height_sigma_m` | m | `HSIGMA` | – | ✅ |
| `rms_wave_height_m` | m | `HRMSD` | – | ✅ |
| `wave_height_2pct_m` | m | `H2%D` | – | ✅ |
| `significant_period_s` | s | `TH13D` | `Th1/3` | ✅ **headline** |
| `period_h110_s` | s | `TH110D` | – | ✅ |
| `mean_period_s` | s | `TAVGD` | – | ✅ |
| `period_of_hmax_s` | s | `THMAXD` | – | ✅ |
| `max_period_s` | s | `TMAXD` | – | ✅ |
| `eta_max_m` | m | `ETAMAX` | – | ✅ |
| `eta_min_m` | m | `ETAMIN` | – | ✅ |
| `significant_steepness` | – | `SZ13D` | – | ✅ |
| `max_steepness` | – | `SZMAXD` | – | ✅ |
| `period_of_max_steepness_s` | s | `TSZMAXD` | – | ✅ |
| `n_waves` | count | `NBRE_VAG` | – | ✅ |
| `skewness` | – | `SKEW` | – | ✅ |
| `kurtosis` | – | `KURT` | – | ✅ |
| `height_correlation_rhh` | – | `RHH` | – | ✅ |
| `spectral_significant_height_hm0_m` | m | `HM0` | – | ✅ **headline** |
| `peak_period_s` | s | `TP` | – | ✅ **headline** |
| `mean_period_t02_s` | s | `T02` | – | ✅ |
| `energy_period_s` | s | `TE` | – | ✅ |
| `spectral_narrowness_eps2` | – | `EPS2` | – | ✅ |
| `spectral_width_kappa` | – | `KAPA` | – | ✅ |
| `peak_direction_deg` | ° from, true N, CW | `THETAP` | `DirPic` | ✅ **headline** |
| `mean_direction_deg` | ° from, true N, CW | `THETAM` | – | ✅ |
| `peak_directional_spread_deg` | ° | `SIGMAP` | `EtalPic` | ✅ **headline** |
| `mean_directional_spread_deg` | ° | `SIGMAM` | – | ✅ |
| `sea_temperature_c` | °C | – | `TempMer` | 🟡 realtime-only **headline** |
| `quality_flag` | code | `QUALITE` | – | ❌ empty → dropped |
| `n_wave_systems` | count | `NBSYS` | – | ❌ empty → dropped |
| `system{1..4}_*` (40 cols) | – | `*_S1..S4` | – | ❌ empty → dropped |

> **30 wave variables + datetime + campaign_id are usable.** The 43 `❌` columns
> are 100 % empty for 06403 and are **dropped at ingest**; their definitions below
> are kept as reference in case a future buoy populates them. 🟡 = present only in
> the realtime feed, so it accumulates forward (see [0001 §2.4](2026-06-27-0001-foundation.md)).

---

## 4. Definitions

### 4.1 Identity & time
- **`campaign_id`** — *Simple:* which buoy the row came from. *Full:* CANDHIS
  campaign/station id (e.g. `06403`); added by the ingest, not an oceanographic
  parameter.
- **`datetime_utc`** — *Simple:* when the measurement was taken (UTC). *Full:*
  timestamp of the 30-min sea-state record in Universal Time. Archive uses one
  `DateHeure` field; the realtime export uses one combined `Date` field (e.g.
  `2026-06-27 16:00:00`). **Both are UTC** — empirically confirmed on 2026-06-27: a
  realtime file downloaded at 18:34 CEST (16:34 UTC) had its newest row at `16:00:00`,
  i.e. ~34 min old in UTC, not the ~2.5 h that a local-time reading would imply. The
  ingest maps `Date → datetime_utc` as-is and the frontend renders Europe/Paris.
  *(The earlier "splits Date + `Heure (TU)`" note was wrong — the file has no separate
  time column.)*

### 4.2 Wave heights (time-domain)
- **`significant_wave_height_m`** (H1/3) — *Simple:* the typical big-wave height
  (average of the biggest third of waves). *Full:* mean height of the highest
  one-third of waves over the record — the classic "sea state" height a surfer
  feels. The realtime table reports the same quantity as `H1/3`.
- **`significant_wave_height_tenth_m`** (H1/10) — *Simple:* average height of the
  biggest tenth of waves (the bigger sets). *Full:* mean height of the highest
  one-tenth of waves; always larger than H1/3; characterises the larger sets.
- **`max_wave_height_m`** (Hmax) — *Simple:* the single biggest wave in the record.
  *Full:* maximum individual wave height in the 30-min record (≈1.6–2× H1/3 in a
  typical sea); the rogue/biggest wave to be wary of.
- **`significant_wave_height_sigma_m`** — *Simple:* significant height from the
  sea-surface wobble. *Full:* Hσ = 4·σ_η (σ_η = std-dev of surface elevation); a
  statistical estimator that usually matches H1/3 and Hm0 closely.
- **`rms_wave_height_m`** — *Simple:* root-mean-square (energy-average) wave height.
  *Full:* Hrms = √(mean of Hi²); used in wave-energy/engineering formulae; smaller
  than H1/3.
- **`wave_height_2pct_m`** (H2%) — *Simple:* height exceeded by only 2 % of waves
  (very large waves). *Full:* a design/extreme-load parameter common in coastal
  engineering (runup, armour stability).

### 4.3 Wave periods (time-domain)
- **`significant_period_s`** (Th1/3) — *Simple:* typical time between the bigger
  waves. *Full:* mean period of the highest one-third of waves; realtime `Th1/3`.
- **`period_h110_s`** — *Simple:* time between the biggest tenth of waves. *Full:*
  mean period associated with H1/10.
- **`mean_period_s`** (Tavg) — *Simple:* average time between all waves. *Full:*
  mean period over all individual waves; lower than the significant period;
  characterises choppiness.
- **`period_of_hmax_s`** — *Simple:* duration of the single biggest wave. *Full:*
  period of the individual wave that had Hmax.
- **`max_period_s`** — *Simple:* longest single wave period in the record.

### 4.4 Surface elevation, steepness & statistics
- **`eta_max_m` / `eta_min_m`** — *Simple:* highest crest / deepest trough relative
  to mean water level. *Full:* max/min free-surface elevation during the record;
  defines crest/trough extremes.
- **`significant_steepness`** (SZ) — *Simple:* how steep the bigger waves are
  (height vs length). *Full:* mean steepness H/L of the highest third; L derived
  from period and depth via the linear dispersion relation. High → breaking/
  uncomfortable seas.
- **`max_steepness` / `period_of_max_steepness_s`** — steepest single wave, and its
  period.
- **`n_waves`** (NBRE_VAG) — *Simple:* how many waves were counted. *Full:* number
  of individual waves (mean-level down-crossing) in the record; also a sample-size
  quality indicator — too few waves makes time-domain stats unreliable.
- **`skewness`** — *Simple:* how lopsided the waves are (peaky crests, flat
  troughs). *Full:* asymmetry of the surface-elevation distribution; 0 for a linear
  (Gaussian) sea, positive for nonlinear waves; a quality/nonlinearity indicator.
- **`kurtosis`** — *Simple:* whether extreme waves are more likely than normal.
  *Full:* tailedness of the elevation distribution; 3 for Gaussian, >3 indicates
  heavy tails (greater rogue-wave likelihood).
- **`height_correlation_rhh`** — *Simple:* how much each wave's size predicts the
  next. *Full:* correlation of successive individual wave heights; describes wave
  grouping (set behaviour).

### 4.5 Spectral (frequency-domain) integral parameters
- **`spectral_significant_height_hm0_m`** (Hm0) — *Simple:* significant wave height
  from the wave-energy spectrum. *Full:* Hm0 = 4·√m0 (m0 = total spectral
  energy/variance); the standard frequency-domain Hs used in forecasting and the
  WMO reference; usually close to H1/3.
- **`peak_period_s`** (Tp) — *Simple:* period of the most energetic waves (the
  dominant swell). *Full:* period of maximum spectral energy (barycentric "Delft"
  method); the single most useful swell descriptor for forecasting/surf. *(Note:
  the realtime feed has no Tp — it provides time-domain Th1/3 instead.)*
- **`mean_period_t02_s`** (Tm02) — *Simple:* average wave period from the spectrum.
  *Full:* T02 = √(m0/m2), the spectral zero-up-crossing mean period; lower than Tp.
- **`energy_period_s`** (Te) — *Simple:* energy-weighted average period (used for
  wave power). *Full:* Te = m−1/m0; weights longer waves more; the key period for
  wave-energy resource assessment.
- **`spectral_narrowness_eps2`** — *Simple:* how clean/single-swell the sea is
  (narrow = one swell). *Full:* ε2 = √(m0·m2/m1² − 1); small = narrow-banded (one
  clean swell), large = broad/mixed sea.
- **`spectral_width_kappa`** — *Simple:* another measure of how spread-out the swell
  energy is. *Full:* κ, an alternative spectral-bandwidth metric to ε2.

### 4.6 Direction
- **`peak_direction_deg`** (θp) — *Simple:* the compass direction the dominant swell
  comes **from**. *Full:* direction of provenance at the spectral peak, relative to
  true north, positive clockwise (nautical "coming-from" convention); e.g. 300° =
  WNW. Realtime `Dir. au pic`. For 06403 it clusters W–NW (~290–310°).
- **`mean_direction_deg`** (θm) — *Simple:* the average direction waves come from.
  *Full:* energy-weighted mean direction over the whole spectrum.
- **`peak_directional_spread_deg`** (σp) — *Simple:* how spread-out in direction the
  main swell is (focused vs messy). *Full:* directional width at the spectral peak
  (circular std-dev); small = clean/aligned swell, large = short-crested/confused
  sea. Realtime `Étal. au pic` (étalement = spreading). *(The old app called this
  `peak_spread_deg`.)*
- **`mean_directional_spread_deg`** (σm) — average directional spread over the whole
  spectrum.

> **Direction rendering rule:** because direction is circular (0°≡360°), it is
> rendered with a **cyclical hue scale + arrow glyphs**, never as a line in degrees
> (which wraps wrongly — a bug in the old Plotly view). Spread is drawn as a band/
> wedge around direction, not a competing line.

### 4.7 Sea temperature
- **`sea_temperature_c`** — *Simple:* sea-surface temperature at the buoy. *Full:*
  water temperature from the buoy's onboard thermometer (°C). **Present only in the
  realtime feed** (`Temp. mer`) — not in the wave-only archive export — so historical
  coverage builds up forward from when the scraper begins (see
  [0001 §2.4](2026-06-27-0001-foundation.md)). Views older than coverage must show a
  "temperature available from <date> / last 48 h only" state, not an empty axis.

### 4.8 Reference-only (empty for 06403 → dropped)
Kept here so a future buoy can reuse the schema:
- **`quality_flag`** (QUALITE) — Cerema data-quality / validation flag (raw vs
  operator-validated vs doubtful/rejected). The code→label mapping is not in the
  open docs; would need Cerema to surface trustworthy/provisional states.
- **`n_wave_systems`** (NBSYS) — number of wave systems (spectral partitions,
  max 4) by the Hanson & Phillips algorithm; >1 = mixed seas (e.g. a long-period
  groundswell + a local wind-sea).
- **`system{n}_*`** — per-partition Hm0 / Tp / T02 / Te / ε2 / κ / peak & mean
  direction / peak & mean spread for each of up to 4 swell/wind-sea trains. Lets you
  separate, e.g., a 0.4 m NW groundswell from an overlapping W wind-chop. **Empty for
  06403.**

---

## 5. Headline variables (surface prominently)

`significant_wave_height_m` · `max_wave_height_m` · `peak_period_s` /
`significant_period_s` · `peak_direction_deg` · `peak_directional_spread_deg` ·
`sea_temperature_c` (+ `spectral_significant_height_hm0_m` in the scientific view).

---

## 6. Sea-state reference scale

Doubles as the wave-height color legend (see [0001 §7.1](2026-06-27-0001-foundation.md)).

| H1/3 | Label | Color |
|------|-------|-------|
| 0.0–0.5 m | glassy | `#BFE9E0` |
| 0.5–1.0 m | smooth | `#6FD3C4` |
| 1.0–1.5 m | moderate | `#38B8C9` |
| 1.5–2.5 m | clean/lively | `#2E8FC4` |
| 2.5–4.0 m | building | `#3D5FBE` |
| 4.0–6.0 m | big | `#7A4FC0` |
| 6.0 m+ | heavy / storm | `#B83D8E` |

---

## 7. Missing-data handling (ingest contract)

1. **Sentinel `999.999` → null** for every numeric column (CANDHIS "no valid
   measurement" fill; impossible as a height/period/direction/spread). Implemented
   as "null any value ≥ 999.99" so it's float-repr-safe and still preserves real
   `peak_direction_deg` values up to 360°.
2. **Drop the 43 empty columns** (§3).
3. **Gaps:** the series has real outages (93.9 % coverage, 66 gaps > 1 h, largest
   50 days). Do not interpolate across gaps — charts break the line; presets/ranges
   landing on empty stretches show a "no data for this period" state.
4. **Temperature coverage** is published per-variable in `manifest.json` so the
   frontend decides panel visibility from metadata, not by probing nulls.

---

## Sources

- Cerema/CANDHIS, *Détail des paramètres d'états de mer* (Format doc) — authoritative
  definitions/units for H13D…SIGMAM_S4, partitions, QUALITE/NBSYS.
- Cerema/CANDHIS, *Conditions d'utilisation* (25-RE-0137, 2025) — station identity.
- Cerema/CANDHIS, *API PHP REST v1* — metadata fields, column ordering, sensor.
- CANDHIS realtime page `campagne.php?camp=06403` — realtime column names.
- Direct profiling of `/Users/hadim/Data/fff` (2026-06-27) — coverage, gaps,
  sentinel detection, empty-column detection, value ranges.

// Wave steepness ("cambrure", spec 0023): how tall the waves are for their length.
//
// A DISPLAY-DERIVED variable — never stored, never fetched. It is computed in the browser from
// two columns every tier already carries (H1/3 and Th1/3), so it costs no ingest change and has
// the buoy's whole history from day one. Keep it that way: a stored copy would be a third thing
// to keep in sync with the two it is made of.
//
// The buoy does not measure a wavelength. Linear theory gives it from the period, in deep water:
// L0 = g·T² / 2π. Deep water on purpose, even though the buoys sit in ~20–50 m: the offshore
// wavelength makes steepness a property of the SWELL (how far it is from the wind that raised
// it), comparable from one buoy to the next, instead of a property of the mooring depth — which
// CANDHIS does not publish anyway.
//
// Not to be confused with CANDHIS's own `significant_steepness` (SZ13D): archive-only (weeks
// late), computed per individual wave, and ~2.5× larger. See spec 0023 §2.

import type { Columnar } from './parquet';
import type { MessageKey } from './i18n';

export const STEEPNESS_KEY = 'wave_steepness_pct';
const HEIGHT_KEY = 'significant_wave_height_m';
const PERIOD_KEY = 'significant_period_s';

/** Deep-water wavelength per second² of period: g / 2π ≈ 1.56 m. */
const L0_PER_T2 = 9.80665 / (2 * Math.PI);

/** Steepness in percent, or null when either input is missing or unusable. */
export function steepnessPct(heightM: number | null | undefined, periodS: number | null | undefined): number | null {
  if (heightM == null || periodS == null || !(periodS > 0) || heightM < 0) return null;
  return (100 * heightM) / (L0_PER_T2 * periodS * periodS);
}

/** The reading scale (spec 0023 §3). `upTo` is the exclusive upper bound, in percent.
 *
 *  The words describe the SWELL — long for its height, or short and wind-raised — and never the
 *  surface: steepness is blind to local chop riding a long swell, so a word like "clean" would
 *  promise something this number cannot see. The thresholds are provisional (0023 §3): the only
 *  physical anchor is the top one, a sea fully raised by the wind sits around 2.5–3 %.
 *  `shortKey` is the same name without its noun, for a chart band too narrow for the full one. */
export const STEEPNESS_CLASSES: { upTo: number; labelKey: MessageKey; shortKey: MessageKey; example: [number, number][] }[] = [
  { upTo: 0.5, labelKey: 'steep_very_long', shortKey: 'steep_very_long_short', example: [[1, 12], [2, 17]] },
  { upTo: 1.0, labelKey: 'steep_long', shortKey: 'steep_long_short', example: [[1.5, 11], [2, 13]] },
  { upTo: 1.5, labelKey: 'steep_short', shortKey: 'steep_short_short', example: [[2, 10], [3.3, 14]] },
  { upTo: 2.5, labelKey: 'steep_mixed', shortKey: 'steep_mixed_short', example: [[2.5, 9], [3.7, 12]] },
  { upTo: Infinity, labelKey: 'steep_wind_sea', shortKey: 'steep_wind_sea_short', example: [[1, 5], [4, 9]] },
];

/** The finite class boundaries, in percent — the chart's y-ticks and band edges. */
export const STEEPNESS_BOUNDS = STEEPNESS_CLASSES.map((c) => c.upTo).filter(Number.isFinite);

/** Index into STEEPNESS_CLASSES for a steepness in percent. */
export function steepnessClassIndex(pct: number): number {
  const i = STEEPNESS_CLASSES.findIndex((c) => pct < c.upTo);
  return i < 0 ? STEEPNESS_CLASSES.length - 1 : i;
}

/** `src` plus the derived steepness column (a shallow copy — the tier itself is never mutated,
 *  it is shared with the caches). Always adds the column, all-null when an input is absent, so
 *  every reader can index it without a guard.
 *
 *  On the hourly-means tier this is exact to 0.01 point; on the daily-means tier the ratio of two
 *  daily means reads up to ~0.15 point low on a day that changed a lot (spec 0023 §4). */
export function withSteepness(src: Columnar): Columnar {
  const h = src[HEIGHT_KEY] as (number | null)[] | undefined;
  const t = src[PERIOD_KEY] as (number | null)[] | undefined;
  const out: (number | null)[] = new Array(src.t.length);
  for (let i = 0; i < src.t.length; i++) out[i] = steepnessPct(h?.[i], t?.[i]);
  return { ...src, [STEEPNESS_KEY]: out };
}

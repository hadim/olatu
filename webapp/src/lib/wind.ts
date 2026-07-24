// Pure, framework-agnostic wind helpers (spec 0013). The single synthesized payoff Olatu adds
// on top of the raw station feed is **offshore / onshore** — the most-asked question for surfing
// this coast — from the angle between the station's wind direction and the buoy's swell direction.
//
// Both are "comes-FROM" bearings: `wind_direction_deg` is where the wind blows from,
// `peak_direction_deg` is where the swell arrives from. Offshore wind blows from land out to sea,
// i.e. from ~opposite the swell source → it opposes the incoming swell and grooms it (clean).
// Onshore wind blows in with the swell (from the same side) → blown out. This is a swell-relative
// approximation (it treats the beach as facing the swell); a per-buoy shore-normal could refine it
// later (spec 0013 §5). Needs both feeds present.

export type WindShore = 'offshore' | 'onshore' | 'cross';

/** Smallest absolute angular difference between two bearings, in [0, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** Offshore / onshore / cross-shore from wind-from vs swell-from bearings; `null` if either is
 *  missing. d ≥ 135° → offshore (wind opposes the swell → clean); d ≤ 45° → onshore (blown out);
 *  in between → cross / side-shore. */
export function shoreRelation(
  windFromDeg: number | null | undefined,
  swellFromDeg: number | null | undefined,
): WindShore | null {
  if (windFromDeg == null || swellFromDeg == null) return null;
  const d = angleDiff(windFromDeg, swellFromDeg);
  if (d >= 135) return 'offshore';
  if (d <= 45) return 'onshore';
  return 'cross';
}

/** The semantic colour token for a shore relation (separate from the realm accents): offshore is
 *  good (calm green), onshore is poor (danger), cross is neutral (warning). */
export function shoreColorVar(shore: WindShore): string {
  return shore === 'offshore' ? '--calm' : shore === 'onshore' ? '--danger' : '--warning';
}

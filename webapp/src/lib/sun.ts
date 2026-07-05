// Sunrise / sunset for a lat/lon on a given civil day — a pure, deterministic port of the
// NOAA solar-position algorithm (no API, no key; spec 0008 §8.4). Returns epoch **ms** UTC,
// rendered in the buoy timezone by the caller. Accurate to ~1 min at temperate latitudes,
// which is all a "Sunrise 07:12" readout needs. Guards polar day/night (never hit here).

const RAD = Math.PI / 180;

/** Julian Day at 00:00 UT of a Gregorian calendar date. */
function julianDay(y: number, m: number, d: number): number {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

/** Minutes past 00:00 UTC of the sunrise (or sunset) for a Julian day + position, or null
 *  when the sun doesn't cross the horizon that day (polar day/night). */
function eventMinutesUTC(jday: number, lat: number, lon: number, rise: boolean): number | null {
  const jc = (jday - 2451545) / 36525; // Julian century
  const gmls = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360; // geom mean longitude (°)
  const gmas = 357.52911 + jc * (35999.05029 - 0.0001537 * jc); // geom mean anomaly (°)
  const eeo = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc); // orbit eccentricity
  const seqc =
    Math.sin(gmas * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * gmas * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * gmas * RAD) * 0.000289; // equation of centre
  const strueLong = gmls + seqc;
  const appLong = strueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * jc) * RAD);
  const moe = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const oblCorr = moe + 0.00256 * Math.cos((125.04 - 1934.136 * jc) * RAD);
  const declin = Math.asin(Math.sin(oblCorr * RAD) * Math.sin(appLong * RAD)) / RAD; // (°)
  const vy = Math.tan((oblCorr / 2) * RAD) ** 2;
  const eqTime =
    (4 *
      (vy * Math.sin(2 * gmls * RAD) -
        2 * eeo * Math.sin(gmas * RAD) +
        4 * eeo * vy * Math.sin(gmas * RAD) * Math.cos(2 * gmls * RAD) -
        0.5 * vy * vy * Math.sin(4 * gmls * RAD) -
        1.25 * eeo * eeo * Math.sin(2 * gmas * RAD))) /
    RAD; // minutes

  const zenith = 90.833; // includes atmospheric refraction + the sun's apparent radius
  const cosH =
    Math.cos(zenith * RAD) / (Math.cos(lat * RAD) * Math.cos(declin * RAD)) -
    Math.tan(lat * RAD) * Math.tan(declin * RAD);
  if (cosH > 1 || cosH < -1) return null;
  const ha = Math.acos(cosH) / RAD; // hour angle (°)
  const noon = 720 - 4 * lon - eqTime; // solar noon, minutes UTC
  return noon + (rise ? -1 : 1) * 4 * ha;
}

export interface SunTimes {
  sunrise: number | null;
  sunset: number | null;
}

/** Local civil Y/M/D at a timezone for an instant (same technique as the chart's day grid). */
function civilDate(ms: number, tz: string): { y: number; m: number; d: number } {
  const o: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') o[p.type] = +p.value;
  }
  return { y: o.year, m: o.month, d: o.day };
}

/**
 * Sunrise & sunset (epoch **ms**, UTC) for the buoy's *local* civil day containing `nowMs`.
 * At our near-Greenwich longitudes the event always falls on the same UTC date, so anchoring
 * to that date's UTC midnight is exact.
 */
export function sunTimes(nowMs: number, lat: number, lon: number, tz: string): SunTimes {
  const { y, m, d } = civilDate(nowMs, tz);
  const jday = julianDay(y, m, d);
  const base = Date.UTC(y, m - 1, d);
  const at = (rise: boolean): number | null => {
    const mins = eventMinutesUTC(jday, lat, lon, rise);
    return mins == null ? null : base + mins * 60_000;
  };
  return { sunrise: at(true), sunset: at(false) };
}

// Locale-aware formatting helpers (numbers, time, compass directions, staleness).

import type { Locale } from './i18n';

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** 16-point compass abbreviation for a "from" direction in degrees.
 *  French/Spanish use O (Ouest/Oeste) instead of W. */
export function compass(deg: number, locale: Locale): string {
  const token = COMPASS_16[Math.round(deg / 22.5) % 16];
  return locale === 'en' ? token : token.replace(/W/g, 'O');
}

export function fmtNumber(value: number, locale: Locale, digits = 1): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function fmtClock(ms: number, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
    timeZone,
  }).format(new Date(ms));
}

/** Full date + time for the chart hover card, e.g. "12 Jan 2024, 14:30". */
export function fmtDateTime(ms: number, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(ms));
}

/** Locale-aware axis tick label whose detail scales with the tick spacing (seconds).
 *  On sub-day windows the ticks are hours, but a bare "08:00 16:00 00:00…" loses the
 *  day/month — so ticks that land on local midnight show the date instead, anchoring
 *  each day (spec 0003: year-aware ticks, extended down to intra-day context). */
export function fmtAxisTick(ms: number, locale: Locale, timeZone: string, incrSec: number): string {
  const DAY = 86_400;
  let opts: Intl.DateTimeFormatOptions;
  if (incrSec >= DAY * 300) opts = { year: 'numeric', timeZone };
  else if (incrSec >= DAY * 27) opts = { month: 'short', year: '2-digit', timeZone };
  else if (incrSec >= DAY) opts = { day: 'numeric', month: 'short', timeZone };
  else {
    // Intra-day tick: show the date at the day boundary, the clock otherwise.
    const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(new Date(ms));
    const hh = p.find((x) => x.type === 'hour')?.value;
    const mm = p.find((x) => x.type === 'minute')?.value;
    opts = hh === '00' && mm === '00' ? { day: 'numeric', month: 'short', timeZone } : { hour: '2-digit', minute: '2-digit', timeZone };
  }
  return new Intl.DateTimeFormat(locale, opts).format(new Date(ms));
}

/** Wave-height → sea-state colour (mirrors specs/0002 §6 and the chart legend). */
export function hsColor(v: number): string {
  if (v < 0.5) return '#BFE9E0';
  if (v < 1) return '#6FD3C4';
  if (v < 1.5) return '#38B8C9';
  if (v < 2.5) return '#2E8FC4';
  if (v < 4) return '#3D5FBE';
  if (v < 6) return '#7A4FC0';
  return '#B83D8E';
}

// --- Cyclical swell-direction colour (spec 0001 §7.1, 0002 §4.6) -------------------
// Direction is circular (0°≡360°), so it gets a hue *wheel* anchored at the four
// cardinals, interpolated in OKLCH: L/C linearly, hue along the shortest arc so the
// midtones stay saturated (no muddy grey across the neutral axis) and 359° sits next
// to 1°. Precomputed once into a 360-entry lookup, so per-glyph colouring on the
// charts is a cheap array index.
const DIR_ANCHORS: { deg: number; hex: string }[] = [
  { deg: 0, hex: '#38E1C6' }, // N — instrument teal
  { deg: 90, hex: '#7CC4FF' }, // E — sky blue
  { deg: 180, hex: '#FFC857' }, // S — warm gold
  { deg: 270, hex: '#FF7AA8' }, // W — coral pink
];

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function linearToByte(c: number): number {
  const cc = Math.max(0, Math.min(1, c));
  const v = cc <= 0.0031308 ? 12.92 * cc : 1.055 * cc ** (1 / 2.4) - 0.055;
  return Math.round(v * 255);
}

/** sRGB hex → OKLCH [L, C, hue(rad)] (Björn Ottosson's matrices). */
function hexToOklch(hex: string): [number, number, number] {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** OKLCH → sRGB hex (inverse of the above; out-of-gamut channels are clamped). */
function oklchToHex(L: number, C: number, h: number): string {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = linearToByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = linearToByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

const DIR_LUT: string[] = (() => {
  const an = DIR_ANCHORS.map((a) => hexToOklch(a.hex));
  const lut = new Array<string>(360);
  for (let d = 0; d < 360; d++) {
    const seg = Math.floor(d / 90) % 4;
    const a = an[seg];
    const b = an[(seg + 1) % 4];
    const f = (d - seg * 90) / 90;
    let dh = b[2] - a[2];
    if (dh > Math.PI) dh -= 2 * Math.PI;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    lut[d] = oklchToHex(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + dh * f);
  }
  return lut;
})();

/** Cyclical "swell comes-from" colour — N teal · E blue · S gold · W pink, smoothly
 *  wrapped (0°≡360°). Returns a `#rrggbb` hex; append an alpha suffix (e.g. `+ '22'`)
 *  for a translucent fill. */
export function dirColor(deg: number): string {
  return DIR_LUT[((Math.round(deg) % 360) + 360) % 360];
}

export type Freshness = 'fresh' | 'aging' | 'stale';

export function freshness(ageMs: number): Freshness {
  const hours = ageMs / 3_600_000;
  if (hours <= 2) return 'fresh';
  if (hours <= 6) return 'aging';
  return 'stale';
}

/** Human "N hours ago" / "N days ago" using Intl.RelativeTimeFormat. */
export function relativeAgo(ms: number, locale: Locale, now: number): string {
  const diffSec = Math.round((ms - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}

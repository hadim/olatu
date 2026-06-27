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

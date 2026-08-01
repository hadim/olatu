// Month-grid helpers shared by the two calendar popovers: the date-range `DatePicker`
// (which day of history am I looking at) and the tide calendar (`TideCalendar`).
//
// Days are addressed by a **day index** = whole days since the epoch, so a grid cell is a
// plain integer. `di * DAY_MS` is that day's UTC midnight, which is also how a day gets
// labelled (`Intl` with `timeZone: 'UTC'`). Grids are Monday-first.

export const DAY_MS = 86_400_000;

export interface MonthCell {
  /** Day of month, 1-based — the cell's label. */
  day: number;
  /** Day index (days since the epoch). */
  di: number;
}

/** Day index of a UTC instant (ms). */
export const utcDayIndex = (ms: number) => Math.floor(ms / DAY_MS);

/** Normalise a possibly-overflowing month (`mo = 12` → next January). */
export function normalizeMonth(y: number, mo: number): { y: number; m: number } {
  const k = y * 12 + mo;
  return { y: Math.floor(k / 12), m: ((k % 12) + 12) % 12 };
}

/** `y*12 + m` — one comparable integer, for the month-nav bounds. */
export const monthKey = (y: number, m: number) => y * 12 + m;

/** The month a day index falls in. */
export function monthOf(di: number): { y: number; m: number } {
  const d = new Date(di * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

/** Monday-first month grid; the leading `null`s pad the first week. */
export function monthCells(y: number, mo: number): (MonthCell | null)[] {
  const { y: yy, m: mm } = normalizeMonth(y, mo);
  const lead = (new Date(Date.UTC(yy, mm, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  const cells: (MonthCell | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push({ day: d, di: utcDayIndex(Date.UTC(yy, mm, d)) });
  return cells;
}

/** Narrow weekday initials, Monday-first, in `locale`. */
export function weekdayNarrow(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i)))); // 2024-01-01 = Monday
}

/** "August 2026" in `locale` (month may overflow). */
export function monthLabel(y: number, mo: number, locale: string): string {
  const { y: yy, m: mm } = normalizeMonth(y, mo);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(yy, mm, 1)));
}

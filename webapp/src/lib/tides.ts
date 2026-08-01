// Pure, framework-agnostic tide logic (spec 0008, + §8.2/§8.3 revision). Fed by the shared,
// per-port `tides.parquet` tier (high/low **extrema** derived by ingest/tides.py from
// api-maree.fr — IFREMER / PREVIMER, CC-BY) plus the port meta from the buoy's manifest
// `tide` block. The smooth water-level curve is reconstructed here at runtime.
//
// Reconstruction is the **raised-cosine** half-sine between consecutive extrema — the
// theoretical tide shape, not the literal predicted curve (nearshore shallow-water
// asymmetry is not modelled). The same primitive drives the banner arc and the chart panel.

export type TideKind = 'high' | 'low';

/** One tide extremum. `t` is epoch **milliseconds** (UTC); `h` is metres. */
export interface TideEvent {
  t: number;
  h: number;
  kind: TideKind;
}

export interface TideRangeRef {
  neap: number;
  spring: number;
}

export interface TideSource {
  provider: string;
  upstream: string;
  license: string;
  credit: string;
  url?: string;
}

/** The buoy manifest's `tide` block (ingest/build.py): which port, how far, gauge ref +
 *  attribution. `null` on the manifest when no port is within range → tide empty-state. */
export interface TideMeta {
  port: string;
  label: string;
  distance_km: number;
  range_ref: TideRangeRef | null;
  source: TideSource | null;
}

/** One tide.parquet row (epoch **seconds**). */
export interface TideRow {
  t: number;
  h: number;
  k: TideKind;
}

/** Runtime tide model: port meta (from the manifest) + extrema (from the Parquet tier). */
export interface Tides {
  label: string;
  distanceKm: number | null;
  rangeRef: TideRangeRef | null;
  source: TideSource | null;
  /** Sorted ascending, `t` in ms. */
  events: TideEvent[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Raised-cosine (half-sine) interpolation between two extrema at fraction `p` ∈ [0,1]. */
export const raisedCosine = (a: number, b: number, p: number) => a + ((b - a) * (1 - Math.cos(Math.PI * p))) / 2;

/** Combine the manifest port meta with the Parquet rows into the runtime model. Rows carry
 *  epoch **seconds**; we keep ms internally (matches `now` in `tidePhase`). */
export function buildTides(meta: TideMeta, rows: TideRow[]): Tides {
  const events = rows
    .map((r) => ({ t: r.t * 1000, h: r.h, kind: r.k }))
    .sort((a, b) => a.t - b.t);
  return {
    label: meta.label,
    distanceKm: meta.distance_km ?? null,
    rangeRef: meta.range_ref ?? null,
    source: meta.source ?? null,
    events,
  };
}

export type TidePhaseLabel = 'near-low' | 'rising' | 'near-high' | 'falling';

export interface TidePhase {
  /** Most recent extremum at or before `now`. */
  previous: TideEvent;
  /** Next extremum strictly after `now`. */
  next: TideEvent;
  /** Fraction of the current half-cycle elapsed, in [0, 1]. */
  progress: number;
  /** True when the water is rising (heading toward a high). */
  rising: boolean;
  /** Marnage of the current half-cycle, in metres. */
  amplitude: number;
  /** Interpolated current sea level (m), raised-cosine. */
  height: number;
  /** Milliseconds until the next extremum. */
  msToNext: number;
  label: TidePhaseLabel;
}

/**
 * Bracket `now` (epoch ms) between the previous and next extremum and derive the live
 * phase (progress, direction, marnage, interpolated height). Returns `null` when `now`
 * isn't bracketed — before the first known extremum or after the dataset's last one
 * (drives the banner empty-state).
 */
export function tidePhase(events: TideEvent[], now: number): TidePhase | null {
  let previous: TideEvent | null = null;
  let next: TideEvent | null = null;
  for (const e of events) {
    if (e.t <= now) previous = e;
    else {
      next = e;
      break;
    }
  }
  if (!previous || !next) return null;

  const span = next.t - previous.t;
  const progress = span > 0 ? clamp01((now - previous.t) / span) : 0;
  const amplitude = Math.abs(next.h - previous.h);
  const height = raisedCosine(previous.h, next.h, progress);
  const rising = next.kind === 'high';

  let label: TidePhaseLabel;
  if (progress < 0.15) label = rising ? 'near-low' : 'near-high';
  else if (progress > 0.85) label = rising ? 'near-high' : 'near-low';
  else label = rising ? 'rising' : 'falling';

  return { previous, next, progress, rising, amplitude, height, msToNext: next.t - now, label };
}

/** Reconstructed water level (m) at epoch **seconds**, raised-cosine between the bracketing
 *  extrema. `null` when `sec` isn't bracketed (before the first / after the last extremum). */
export function tideHeightAt(events: TideEvent[], sec: number): number | null {
  const ms = sec * 1000;
  let prev: TideEvent | null = null;
  let next: TideEvent | null = null;
  for (const e of events) {
    if (e.t <= ms) prev = e;
    else {
      next = e;
      break;
    }
  }
  if (!prev || !next) return null;
  const span = next.t - prev.t;
  return span > 0 ? raisedCosine(prev.h, next.h, (ms - prev.t) / span) : prev.h;
}

export interface TideSeries {
  t: number[];
  h: (number | null)[];
}

/**
 * Sample the reconstructed water-level curve over [xmin, xmax] (epoch **seconds**) at
 * ~`stepSec` — the smooth tide shape for narrow windows (spec 0008 §8.3). A hole in the
 * extrema wider than `gapSec` (missing predictions) breaks the line. Returns seconds +
 * metres so it drops straight into the chart's second-axis units.
 */
export function reconstructCurve(
  events: TideEvent[],
  xminSec: number,
  xmaxSec: number,
  stepSec: number,
  gapSec = 12 * 3600,
): TideSeries {
  const t: number[] = [];
  const h: (number | null)[] = [];
  let last = -Infinity;
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const next = events[i];
    const aSec = prev.t / 1000;
    const bSec = next.t / 1000;
    if (bSec < xminSec) continue;
    if (aSec > xmaxSec) break;
    if (bSec - aSec > gapSec) {
      if (t.length && h[h.length - 1] !== null) {
        t.push(aSec + 1);
        h.push(null);
      }
      continue;
    }
    const from = Math.max(aSec, xminSec);
    const to = Math.min(bSec, xmaxSec);
    const dt = next.t - prev.t;
    for (let s = from; s <= to + stepSec; s += stepSec) {
      const ss = Math.min(s, to);
      if (ss <= last) continue;
      t.push(ss);
      h.push(raisedCosine(prev.h, next.h, (ss * 1000 - prev.t) / dt));
      last = ss;
    }
  }
  return { t, h };
}

/**
 * The extrema within [xmin, xmax] (epoch **seconds**), to be connected directly — the cheap
 * wide-window series whose vertices are the PM/BM and whose upper/lower edges trace the
 * spring↔neap envelope. (Undersampling the raised-cosine at wide zoom would alias, so we
 * don't — we draw the real extrema instead.) A hole wider than `gapSec` breaks the line.
 */
export function extremaSeries(events: TideEvent[], xminSec: number, xmaxSec: number, gapSec = 12 * 3600): TideSeries {
  const t: number[] = [];
  const h: (number | null)[] = [];
  let lastSec: number | null = null;
  for (const e of events) {
    const s = e.t / 1000;
    if (s < xminSec || s > xmaxSec) continue;
    if (lastSec !== null && s - lastSec > gapSec) {
      t.push(lastSec + 1);
      h.push(null);
    }
    t.push(s);
    h.push(e.h);
    lastSec = s;
  }
  return { t, h };
}

// --- Calendar grouping (spec 0008 §10) ---------------------------------------------------

/** The longest plausible gap between two consecutive extrema (semi-diurnal ≈ 6 h 12).
 *  A wider hole means missing predictions, not a real half-cycle — no marnage across it. */
const MAX_HALF_CYCLE_MS = 12 * 3_600_000;

/** An extremum inside a calendar day, carrying the marnage of the half-cycle that **ends**
 *  on it (|Δh| to the previous extremum); `null` across a hole / for the first extremum. */
export interface TideDayEvent extends TideEvent {
  range: number | null;
}

/** One calendar day of tides, keyed by its **zoned** day index. */
export interface TideDay {
  di: number;
  events: TideDayEvent[];
  /** The day's biggest half-cycle range (m) — what "big tide today?" reads. */
  marnage: number | null;
}

/** The `Intl` formatter behind `zonedDayIndex` — build it once and pass it when looping. */
export const zonedDayFormatter = (tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Calendar-day index (days since the epoch) of an instant **as seen in `tz`**. Tides are
 * read as local dates, so a 23:40 UTC high tide belongs to the *next* Paris day — grouping
 * on UTC days would file it under the wrong date. `di * 86_400_000` is that local date's
 * UTC midnight, so it labels with `timeZone: 'UTC'` (see `lib/calendar.ts`).
 */
export function zonedDayIndex(ms: number, tz: string, fmt: Intl.DateTimeFormat = zonedDayFormatter(tz)): number {
  const parts = fmt.formatToParts(new Date(ms));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Math.round(Date.UTC(pick('year'), pick('month') - 1, pick('day')) / 86_400_000);
}

/** Bucket the extrema into calendar days of `tz`, each with its own marnage. */
export function groupTidesByDay(events: TideEvent[], tz: string): Map<number, TideDay> {
  const fmt = zonedDayFormatter(tz);
  const days = new Map<number, TideDay>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const prev = i > 0 ? events[i - 1] : null;
    const range = prev && e.t - prev.t <= MAX_HALF_CYCLE_MS ? Math.abs(e.h - prev.h) : null;
    const di = zonedDayIndex(e.t, tz, fmt);
    let day = days.get(di);
    if (!day) {
      day = { di, events: [], marnage: null };
      days.set(di, day);
    }
    day.events.push({ ...e, range });
    if (range != null) day.marnage = Math.max(day.marnage ?? 0, range);
  }
  return days;
}

export type TideMagLabel = 'neap' | 'small' | 'average' | 'large' | 'spring';

const DEFAULT_REF: TideRangeRef = { neap: 1.2, spring: 4.5 };

/**
 * Classify a tidal range (m) against the site's neap→spring envelope so the UI can answer
 * "is this a big tide?" at a glance. `t` drives the gauge fill; `label` buckets it.
 * Metres only — no French coefficient (spec 0008 decision 2).
 */
export function tideMagnitude(range: number, ref: TideRangeRef | null): { t: number; label: TideMagLabel } {
  const r = ref ?? DEFAULT_REF;
  const span = r.spring - r.neap;
  const t = span > 0 ? clamp01((range - r.neap) / span) : 0;
  const label: TideMagLabel =
    t < 0.15 ? 'neap' : t < 0.4 ? 'small' : t < 0.65 ? 'average' : t < 0.88 ? 'large' : 'spring';
  return { t, label };
}

// Pure, framework-agnostic tide logic (spec 0008). Ported from the sibling project
// wave-monitor (`src/lib/tides.ts`). Fed by the per-campaign `tides.json` tier, which
// carries only the high/low **extrema** derived by ingest/tides.py from api-maree.fr
// (IFREMER / PREVIMER, CC-BY); the smooth curve is reconstructed here at runtime.
//
// The reconstruction is the **raised-cosine** half-sine between consecutive extrema —
// the theoretical tide shape, not the literal predicted curve (nearshore shallow-water
// asymmetry is not modelled). Same primitive drives the banner arc and the chart panel.

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

/** Parsed `tides.json`. Events are sorted ascending, `t` in ms. */
export interface Tides {
  site: string;
  siteLabel: string;
  timezone: string;
  generatedAt: string;
  rangeRef: TideRangeRef | null;
  source: TideSource | null;
  events: TideEvent[];
}

/** Raw wire shape of `tides.json` (see ingest/tides.py `_write_tides_json`). */
export interface RawTides {
  site: string;
  site_label?: string;
  timezone: string;
  generated_at?: string;
  range_ref?: TideRangeRef | null;
  source?: TideSource | null;
  events?: { t: number; h: number; k: TideKind }[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Wire → runtime. `events[].t` arrives in epoch **seconds**; we keep ms internally. */
export function parseTides(raw: RawTides): Tides {
  return {
    site: raw.site,
    siteLabel: raw.site_label ?? raw.site,
    timezone: raw.timezone,
    generatedAt: raw.generated_at ?? '',
    rangeRef: raw.range_ref ?? null,
    source: raw.source ?? null,
    events: (raw.events ?? []).map((e) => ({ t: e.t * 1000, h: e.h, kind: e.k })),
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
  const height = previous.h + ((next.h - previous.h) * (1 - Math.cos(Math.PI * progress))) / 2;
  const rising = next.kind === 'high';

  let label: TidePhaseLabel;
  if (progress < 0.15) label = rising ? 'near-low' : 'near-high';
  else if (progress > 0.85) label = rising ? 'near-high' : 'near-low';
  else label = rising ? 'rising' : 'falling';

  return { previous, next, progress, rising, amplitude, height, msToNext: next.t - now, label };
}

/**
 * Tidal range (**marnage**) over time — the chart-panel series (spec 0008). One point per
 * extremum, valued at the |Δheight| to the previous extremum, timed at the extremum
 * (epoch **seconds**). Unlike the fast water-level oscillation this is a slowly-varying
 * signal that traces the spring↔neap cycle and reads at any zoom, and it accumulates with
 * the forward-growing tide history. A gap in the extrema (> `gapSec`, i.e. missing
 * predictions) inserts a null so the line breaks instead of inventing a range.
 */
export function marnageSeries(events: TideEvent[], gapSec = 12 * 3600): { t: number[]; m: (number | null)[] } {
  const t: number[] = [];
  const m: (number | null)[] = [];
  for (let i = 1; i < events.length; i++) {
    const aSec = events[i - 1].t / 1000;
    const bSec = events[i].t / 1000;
    if (bSec - aSec > gapSec) {
      if (t.length && m[m.length - 1] !== null) {
        t.push(aSec + 1);
        m.push(null);
      }
      continue;
    }
    t.push(bSec);
    m.push(Math.abs(events[i].h - events[i - 1].h));
  }
  return { t, m };
}

/** Marnage (m) of the tide cycle bracketing `sec` — the |Δheight| of its two extrema. */
export function marnageAt(events: TideEvent[], sec: number): number | null {
  let prev: number | null = null;
  let next: number | null = null;
  for (const e of events) {
    const s = e.t / 1000;
    if (s <= sec) prev = e.h;
    else {
      next = e.h;
      break;
    }
  }
  return prev != null && next != null ? Math.abs(next - prev) : null;
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

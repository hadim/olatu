// Banner tide strip (spec 0008, + §8.4 revision): a compact, single band at the bottom of
// the current-conditions card. It answers, at a glance: where we are in the tide cycle (a
// half-sine arc with a marker riding it + a rising/falling word), the previous and next
// high/low with a live countdown, the marnage (m) with a neap↔spring fill, and the day's
// sunrise/sunset. Renders nothing when there's no tide data for the buoy.

import { useLocale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { fmtNumber, fmtTimeOfDay } from '../lib/format';
import { useNow } from '../lib/useNow';
import { sunTimes } from '../lib/sun';
import { tideMagnitude, tidePhase, type TidePhaseLabel, type Tides } from '../lib/tides';
import { TideIcon } from './icons';
import InfoPopover from './InfoPopover';

const PHASE_KEY: Record<TidePhaseLabel, MessageKey> = {
  rising: 'tide_rising',
  falling: 'tide_falling',
  'near-high': 'tide_near_high',
  'near-low': 'tide_near_low',
};

// Half-sine arc geometry. The marker rides the reconstructed tide shape between the
// previous and next extremum, so the dot literally climbs on a flood and descends on an ebb.
const ARC_W = 92;
const ARC_H = 34;
const PADX = 5;
const PADY = 6;
const SAMPLES = 32;

function TideArc({ prevH, nextH, progress, hue }: { prevH: number; nextH: number; progress: number; hue: string }) {
  const lo = Math.min(prevH, nextH);
  const dh = Math.abs(nextH - prevH) || 1;
  const at = (p: number): [number, number] => {
    const h = prevH + (nextH - prevH) * (1 - Math.cos(Math.PI * p)) / 2;
    const x = PADX + p * (ARC_W - 2 * PADX);
    const y = PADY + (1 - (h - lo) / dh) * (ARC_H - 2 * PADY);
    return [x, y];
  };
  let d = '';
  for (let i = 0; i <= SAMPLES; i++) {
    const [x, y] = at(i / SAMPLES);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  const [mx, my] = at(progress);
  const fill = `${d}L${(ARC_W - PADX).toFixed(1)} ${ARC_H}L${PADX} ${ARC_H}Z`;
  return (
    <svg viewBox={`0 0 ${ARC_W} ${ARC_H}`} width={ARC_W} height={ARC_H} className="shrink-0" aria-hidden="true">
      {/* fillOpacity, NOT a `${hue}22` string — hue is a `var(--…)` and CSS can't take an
          appended alpha hex, which silently fell back to a solid black fill. */}
      <path d={fill} style={{ fill: hue }} fillOpacity={0.13} />
      <path d={d} fill="none" style={{ stroke: hue }} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={mx} cy={my} r={3.2} style={{ fill: hue }} />
      <circle cx={mx} cy={my} r={5.5} fill="none" style={{ stroke: hue }} strokeOpacity={0.35} strokeWidth={1.5} />
    </svg>
  );
}

/** A sunrise/sunset glyph: a sun disc over a horizon with an up (rise) or down (set) arrow. */
function SunGlyph({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} className="shrink-0" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
      <line x1="1.5" y1="13" x2="14.5" y2="13" />
      <path d="M4.5 10a3.5 3.5 0 0 1 7 0" />
      <line x1="8" y1={up ? 1.5 : 5} x2="8" y2={up ? 5 : 1.5} />
      {up ? <path d="M6 3.5 8 1.5 10 3.5" /> : <path d="M6 3 8 5 10 3" />}
    </svg>
  );
}

/** Compact "2 h 08" / "14 min" countdown; the exact clock time carries the precise info. */
function countdown(ms: number, connector: string): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const dur = h > 0 ? `${h} h ${String(min).padStart(2, '0')}` : `${min} min`;
  return `${connector} ${dur}`;
}

export default function TideStrip({ tides, tz, lat, lon }: { tides: Tides | null; tz: string; lat: number; lon: number }) {
  const { locale } = useLocale();
  const now = useNow(30_000);
  if (!tides) return null;
  const phase = tidePhase(tides.events, now);
  if (!phase) return null;

  const mag = tideMagnitude(phase.amplitude, tides.rangeRef);
  const nextHigh = phase.next.kind === 'high';
  const prevHigh = phase.previous.kind === 'high';
  // The dot/arc share the accent so the strip reads as part of the instrument; a spring
  // tide nudges warm to flag "big tide" without adding a second concept.
  const hue = mag.label === 'spring' || mag.label === 'large' ? 'var(--warm)' : 'var(--accent)';
  const sun = sunTimes(now, lat, lon, tz);

  const arrow = (high: boolean) => (
    <span aria-hidden="true" style={{ color: high ? 'var(--accent)' : 'var(--text-3)' }}>
      {high ? '▲' : '▼'}
    </span>
  );

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4">
      <span className="inline-flex items-center text-[0.78rem] uppercase tracking-[0.06em] text-faint">
        <TideIcon className="mr-1.5 shrink-0" style={{ color: 'var(--accent)' }} />
        {m.tide_title()}
        <InfoPopover title={m.tide_title()} body={m.def_tide()} />
      </span>

      <div className="flex items-center gap-3">
        <TideArc prevH={phase.previous.h} nextH={phase.next.h} progress={phase.progress} hue={hue} />
        <div className="flex flex-col gap-[0.1rem] leading-tight">
          <span className="font-display text-[1.05rem] font-medium text-fg">{m[PHASE_KEY[phase.label]]()}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0 font-mono text-[0.82rem] text-muted">
            {/* previous extremum (muted) → next extremum + live countdown */}
            <span className="inline-flex items-center gap-1 text-faint" title={prevHigh ? m.tide_high() : m.tide_low()}>
              {arrow(prevHigh)}
              {fmtTimeOfDay(phase.previous.t, locale, tz)}
            </span>
            <span aria-hidden="true" className="text-faint">→</span>
            <span className="inline-flex items-center gap-1" title={nextHigh ? m.tide_high() : m.tide_low()}>
              {arrow(nextHigh)}
              {nextHigh ? m.tide_high() : m.tide_low()} · {fmtTimeOfDay(phase.next.t, locale, tz)}
            </span>
            <span className="text-faint">· {countdown(phase.msToNext, m.tide_in())}</span>
          </span>
        </div>
      </div>

      {/* Sunrise / sunset for the buoy's day (astronomical, no tide dependency). */}
      <div className="flex items-center gap-3 text-[0.82rem] text-muted">
        {sun.sunrise != null && (
          <span className="inline-flex items-center gap-1" title={m.sun_sunrise()}>
            <span style={{ color: 'var(--warm)' }}><SunGlyph up /></span>
            <span className="font-mono">{fmtTimeOfDay(sun.sunrise, locale, tz)}</span>
          </span>
        )}
        {sun.sunset != null && (
          <span className="inline-flex items-center gap-1" title={m.sun_sunset()}>
            <span className="text-faint"><SunGlyph up={false} /></span>
            <span className="font-mono">{fmtTimeOfDay(sun.sunset, locale, tz)}</span>
          </span>
        )}
      </div>

      <div className="ml-auto flex flex-col gap-[0.25rem] max-[720px]:ml-0">
        <span className="inline-flex items-baseline gap-1.5">
          <span className="text-[0.72rem] uppercase tracking-[0.06em] text-faint">{m.tide_marnage()}</span>
          <span className="font-display text-[1.05rem] font-medium text-fg [font-feature-settings:'tnum']">
            {fmtNumber(phase.amplitude, locale, 1)}
            <span className="text-[0.82rem] text-muted"> m</span>
          </span>
        </span>
        <div className="flex items-center gap-2">
          <div className="relative h-[6px] w-[68px] overflow-hidden rounded-full bg-surface-2" role="img" aria-label={m[`tide_mag_${mag.label}` as MessageKey]()}>
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.round(mag.t * 100)}%`, backgroundColor: hue }} />
          </div>
          <span className="font-mono text-[0.72rem] text-muted">{m[`tide_mag_${mag.label}` as MessageKey]()}</span>
        </div>
      </div>
    </div>
  );
}

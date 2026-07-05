// Banner tide strip (spec 0008): a compact, single band at the bottom of the current-
// conditions card. It answers, at a glance and without density: where we are in the tide
// cycle (a half-sine arc with a marker riding it + a rising/falling word), the next high/
// low with a live countdown, and the marnage (m) with a neap↔spring fill so you can tell a
// big tide from a small one. Renders nothing when there's no tide data for the buoy.

import { useLocale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { fmtNumber, fmtTimeOfDay } from '../lib/format';
import { useNow } from '../lib/useNow';
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
      <path d={fill} style={{ fill: `${hue}22` }} />
      <path d={d} fill="none" style={{ stroke: hue }} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={mx} cy={my} r={3.2} style={{ fill: hue }} />
      <circle cx={mx} cy={my} r={5.5} fill="none" style={{ stroke: hue }} strokeOpacity={0.35} strokeWidth={1.5} />
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

export default function TideStrip({ tides, tz }: { tides: Tides | null; tz: string }) {
  const { locale } = useLocale();
  const now = useNow(30_000);
  if (!tides) return null;
  const phase = tidePhase(tides.events, now);
  if (!phase) return null;

  const mag = tideMagnitude(phase.amplitude, tides.rangeRef);
  const nextHigh = phase.next.kind === 'high';
  // The dot/arc share the accent so the strip reads as part of the instrument; a spring
  // tide nudges warm to flag "big tide" without adding a second concept.
  const hue = mag.label === 'spring' || mag.label === 'large' ? 'var(--warm)' : 'var(--accent)';

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
          <span className="inline-flex items-center gap-1 font-mono text-[0.82rem] text-muted">
            <span aria-hidden="true" style={{ color: nextHigh ? 'var(--accent)' : 'var(--text-3)' }}>
              {nextHigh ? '▲' : '▼'}
            </span>
            {nextHigh ? m.tide_high() : m.tide_low()} · {fmtTimeOfDay(phase.next.t, locale, tz)}
            <span className="text-faint"> · {countdown(phase.msToNext, m.tide_in())}</span>
          </span>
        </div>
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

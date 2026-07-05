// Banner tide strip (spec 0008, + §8.4 / §8.6 revisions). A compact band at the bottom of
// the current-conditions card, reorganised into two clearly separated groups so nothing
// reads as ambiguous (spec §8.6):
//
//   ── TIDE ──────────────────────────────────  │  ── SUN ──
//   an integrated tide-CURVE timeline: the raised-cosine between the previous and next
//   extremum, with a "now" dot riding it. Past is literally to the LEFT (where we came
//   from), the future to the RIGHT (where we're heading) — the endpoints are labelled with
//   their kind (▼ low / ▲ high) + time, and the next one also carries the live countdown.
//   Beside it: the marnage (m) + neap↔spring fill.  The SUN group (sunrise/sunset) sits in
//   its own titled zone behind a divider — no longer wedged between tide facts.
//
// Renders nothing when there's no tide data for the buoy.

import type { ReactNode } from 'react';
import { useLocale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { fmtNumber, fmtTimeOfDay } from '../lib/format';
import { useNow } from '../lib/useNow';
import { sunTimes } from '../lib/sun';
import { tideMagnitude, tidePhase, raisedCosine, type TideEvent, type TidePhaseLabel, type Tides } from '../lib/tides';
import { TideIcon } from './icons';
import InfoPopover from './InfoPopover';

const PHASE_KEY: Record<TidePhaseLabel, MessageKey> = {
  rising: 'tide_rising',
  falling: 'tide_falling',
  'near-high': 'tide_near_high',
  'near-low': 'tide_near_low',
};

// Tide-curve timeline geometry. The curve is the reconstructed raised-cosine between the
// previous extremum (left, at its height) and the next (right, at its height); within one
// half-cycle it eases monotonically, so an up-to-the-right slope = flooding, down = ebbing.
const CURVE_W = 176;
const CURVE_H = 46;
const CPADX = 9; // keep the endpoint/now dots off the edges
const CPADY = 8;
const SAMPLES = 40;

function TideCurve({
  prev,
  next,
  progress,
  hue,
  ariaLabel,
}: {
  prev: TideEvent;
  next: TideEvent;
  progress: number;
  hue: string;
  ariaLabel: string;
}) {
  const lo = Math.min(prev.h, next.h);
  const dh = Math.abs(next.h - prev.h) || 1;
  const at = (p: number): [number, number] => {
    const h = raisedCosine(prev.h, next.h, p);
    const x = CPADX + p * (CURVE_W - 2 * CPADX);
    const y = CPADY + (1 - (h - lo) / dh) * (CURVE_H - 2 * CPADY);
    return [x, y];
  };
  let d = '';
  for (let i = 0; i <= SAMPLES; i++) {
    const [x, y] = at(i / SAMPLES);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  const [lx, ly] = at(0);
  const [rx, ry] = at(1);
  const [nx, ny] = at(progress);
  const fill = `${d}L${rx.toFixed(1)} ${CURVE_H}L${lx.toFixed(1)} ${CURVE_H}Z`;
  return (
    <svg viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} width={CURVE_W} height={CURVE_H} className="shrink-0" role="img" aria-label={ariaLabel}>
      {/* fillOpacity, NOT a `${hue}22` string — hue is a `var(--…)` and CSS can't take an
          appended alpha hex (it silently fell back to a solid black fill). */}
      <path d={fill} style={{ fill: hue }} fillOpacity={0.12} />
      <path d={d} fill="none" style={{ stroke: hue }} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      {/* now → baseline guide, so the moment reads against the timeline */}
      <line x1={nx} y1={ny} x2={nx} y2={CURVE_H} style={{ stroke: hue }} strokeOpacity={0.28} strokeWidth={1} strokeDasharray="2 2" />
      {/* previous extremum: hollow + muted ("where we came from") */}
      <circle cx={lx} cy={ly} r={3} className="fill-surface" style={{ stroke: 'var(--text-3)' }} strokeWidth={1.5} />
      {/* next extremum: filled hue ("where we're heading") */}
      <circle cx={rx} cy={ry} r={3.2} style={{ fill: hue }} />
      {/* now: the live marker riding the curve */}
      <circle cx={nx} cy={ny} r={5.5} fill="none" style={{ stroke: hue }} strokeOpacity={0.35} strokeWidth={1.5} className="motion-safe:animate-[pulse_2.4s_ease-out_infinite]" />
      <circle cx={nx} cy={ny} r={3.4} style={{ fill: hue }} className="stroke-surface [stroke-width:1.5]" />
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
function countdown(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h > 0 ? `${h} h ${String(min).padStart(2, '0')}` : `${min} min`;
}

/** Small heading used by both groups: an icon + an uppercase label (+ optional info). */
function GroupLabel({ icon, label, body }: { icon: ReactNode; label: string; body?: string }) {
  return (
    <span className="inline-flex items-center text-[0.72rem] uppercase tracking-[0.07em] text-faint">
      {icon}
      {label}
      {body && <InfoPopover title={label} body={body} />}
    </span>
  );
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
  // The curve/dots share the accent so the strip reads as part of the instrument; a spring
  // tide nudges warm to flag "big tide" without adding a second concept.
  const hue = mag.label === 'spring' || mag.label === 'large' ? 'var(--warm)' : 'var(--accent)';
  const sun = sunTimes(now, lat, lon, tz);

  const prevWord = prevHigh ? m.tide_high() : m.tide_low();
  const nextWord = nextHigh ? m.tide_high() : m.tide_low();
  const arrow = (high: boolean) => (
    <span aria-hidden="true" className="text-[0.72em]" style={{ color: high ? 'var(--accent)' : 'var(--text-3)' }}>
      {high ? '▲' : '▼'}
    </span>
  );
  const curveAria = `${m[PHASE_KEY[phase.label]]()} — ${m.tide_previous()} ${prevWord} ${fmtTimeOfDay(phase.previous.t, locale, tz)}, ${m.tide_next()} ${nextWord} ${fmtTimeOfDay(phase.next.t, locale, tz)} ${m.tide_in()} ${countdown(phase.msToNext)}`;

  return (
    <div className="mt-5 flex flex-wrap items-stretch gap-x-8 gap-y-5 border-t border-line pt-4">
      {/* ── TIDE group: phase + curve timeline + range ────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
        {/* phase word + the integrated prev→now→next curve */}
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2">
            <GroupLabel icon={<TideIcon className="mr-1.5 shrink-0" style={{ color: 'var(--accent)' }} />} label={m.tide_title()} body={m.def_tide()} />
            <span className="font-display text-[1.05rem] font-medium leading-none text-fg">{m[PHASE_KEY[phase.label]]()}</span>
          </span>
          <div className="flex flex-col gap-1">
            <TideCurve prev={phase.previous} next={phase.next} progress={phase.progress} hue={hue} ariaLabel={curveAria} />
            {/* endpoint captions, justified so each hugs its end of the curve */}
            <div className="flex items-start justify-between font-mono text-[0.76rem]" style={{ width: CURVE_W }}>
              <span className="inline-flex items-center gap-1 text-faint" title={`${m.tide_previous()} · ${prevWord}`}>
                {arrow(prevHigh)}
                {fmtTimeOfDay(phase.previous.t, locale, tz)}
              </span>
              <span className="flex flex-col items-end leading-tight" title={`${m.tide_next()} · ${nextWord}`}>
                <span className="inline-flex items-center gap-1 text-fg">
                  {arrow(nextHigh)}
                  {fmtTimeOfDay(phase.next.t, locale, tz)}
                </span>
                <span className="text-[0.7rem] text-accent">{m.tide_in()} {countdown(phase.msToNext)}</span>
              </span>
            </div>
          </div>
        </div>

        {/* marnage + neap↔spring fill — the "how big" readout */}
        <div className="flex flex-col gap-[0.3rem] self-center">
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

      {/* ── SUN group: its own titled zone, separated by a divider ─────────────── */}
      {(sun.sunrise != null || sun.sunset != null) && (
        <div className="ml-auto flex flex-col justify-center gap-1.5 border-l border-line pl-8 max-[720px]:ml-0 max-[720px]:border-l-0 max-[720px]:pl-0 max-[720px]:border-t max-[720px]:pt-4 max-[720px]:w-full">
          <GroupLabel icon={<span className="mr-1.5 text-warm"><SunGlyph up /></span>} label={m.sun_title()} />
          <div className="flex items-center gap-5 text-[0.84rem] text-muted">
            {sun.sunrise != null && (
              <span className="inline-flex items-center gap-1.5" title={m.sun_sunrise()}>
                <span className="text-warm"><SunGlyph up /></span>
                <span className="font-mono">{fmtTimeOfDay(sun.sunrise, locale, tz)}</span>
              </span>
            )}
            {sun.sunset != null && (
              <span className="inline-flex items-center gap-1.5" title={m.sun_sunset()}>
                <span className="text-faint"><SunGlyph up={false} /></span>
                <span className="font-mono">{fmtTimeOfDay(sun.sunset, locale, tz)}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Tide calendar popover (spec 0008 §10) — the small calendar button beside the live tide
// phase in `TideStrip`. The banner answers "what is the tide doing *now*"; this answers
// "and what about tomorrow morning / last Saturday".
//
//   [month grid]                    │  [the selected day's tides]
//   Mon-first, only days the        │  ▲ high 04:12   4.12 m  95  ← the coefficient rides
//   predictions cover are           │  ▼ low  10:31   0.86 m        its PM (spec §11); the
//   selectable; each cell carries   │  ▲ high 16:38   4.05 m  92    next tide carries the
//   a marnage bar, so the           │  ▼ low  22:55   0.91 m        live countdown
//   spring↔neap rhythm of the
//   month reads at a glance.
//
// Days are the buoy's **local** calendar days (`zonedDayIndex`), not UTC ones. Bounds come
// from the data itself — the accumulator holds ~J+30 forward and everything ingest has ever
// seen backwards — so the calendar can never offer a day it has no tides for.

import { useMemo, useState } from 'react';
import { useLocale, type MessageKey } from '@/lib/i18n';
import { useUnits } from '@/lib/units';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DAY_MS, monthCells, monthKey, monthLabel, monthOf, weekdayNarrow } from '../lib/calendar';
import { fmtCountdown, fmtNumber, fmtTimeOfDay } from '../lib/format';
import { groupTidesByDay, tideMagnitude, zonedDayIndex, type TideMagLabel, type Tides } from '../lib/tides';
import { CalendarIcon } from './icons';
import InfoPopover from './InfoPopover';

/** Same rule as the strip: a big tide goes warm, everything else stays accent. */
const magHue = (label: TideMagLabel) => (label === 'spring' || label === 'large' ? 'var(--warm)' : 'var(--accent)');

const CHEVRON =
  'inline-flex h-[1.6rem] w-[1.6rem] cursor-pointer items-center justify-center rounded-[0.4rem] border border-line bg-transparent text-[1.05rem] leading-none text-fg hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-30';

export default function TideCalendar({ tides, tz, now }: { tides: Tides; tz: string; now: number }) {
  const { locale } = useLocale();
  const { units } = useUnits();
  const [open, setOpen] = useState(false);

  const days = useMemo(() => groupTidesByDay(tides.events, tz), [tides.events, tz]);
  const bounds = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const di of days.keys()) {
      if (di < lo) lo = di;
      if (di > hi) hi = di;
    }
    return days.size ? { lo, hi } : null;
  }, [days]);

  const todayDi = zonedDayIndex(now, tz);
  /** The day with data closest to `target` — today, unless the predictions don't cover it. */
  const nearest = (target: number) => {
    let best = target;
    let bestGap = Infinity;
    for (const di of days.keys()) {
      const gap = Math.abs(di - target);
      if (gap < bestGap) {
        best = di;
        bestGap = gap;
      }
    }
    return best;
  };

  const [sel, setSel] = useState(todayDi);
  const [view, setView] = useState(() => monthOf(todayDi));

  // The next extremum overall — the one the banner counts down to. Highlighted in the list
  // when the selected day happens to contain it.
  const nextT = useMemo(() => tides.events.find((e) => e.t > now)?.t ?? null, [tides.events, now]);

  if (!bounds) return null;

  const goto = (di: number) => {
    setSel(di);
    setView(monthOf(di));
  };
  const onOpenChange = (o: boolean) => {
    if (o) goto(nearest(todayDi)); // always reopens on today
    setOpen(o);
  };

  const viewKey = monthKey(view.y, view.m);
  const minKey = monthKey(monthOf(bounds.lo).y, monthOf(bounds.lo).m);
  const maxKey = monthKey(monthOf(bounds.hi).y, monthOf(bounds.hi).m);
  const shiftMonth = (delta: number) => {
    const k = Math.min(maxKey, Math.max(minKey, viewKey + delta));
    setView({ y: Math.floor(k / 12), m: ((k % 12) + 12) % 12 });
  };

  const weekdays = weekdayNarrow(locale);
  const dayTitle = (di: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(di * DAY_MS));
  const shortDate = (di: number) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(di * DAY_MS));

  const selDay = days.get(sel);
  const selMag = selDay?.marnage != null ? tideMagnitude(selDay.marnage, tides.rangeRef) : null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={m.tide_calendar()}
          title={m.tide_calendar()}
          className="inline-flex h-[1.45rem] w-[1.45rem] shrink-0 cursor-pointer items-center justify-center rounded-[0.4rem] border border-line bg-transparent text-faint transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:border-accent data-[state=open]:text-accent"
        >
          <CalendarIcon size={13} />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" role="dialog" aria-label={m.tide_calendar()} className="max-h-[80vh] w-auto max-w-[92vw] overflow-y-auto p-3.5">
        <div className="mb-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => shiftMonth(-1)} disabled={viewKey <= minKey} aria-label={m.date_prev_month()} className={CHEVRON}>
              ‹
            </button>
            <span className="min-w-[8.2rem] text-center font-display text-[0.88rem] font-semibold capitalize">{monthLabel(view.y, view.m, locale)}</span>
            <button type="button" onClick={() => shiftMonth(1)} disabled={viewKey >= maxKey} aria-label={m.date_next_month()} className={CHEVRON}>
              ›
            </button>
          </div>
          <button
            type="button"
            onClick={() => goto(nearest(todayDi))}
            disabled={sel === todayDi}
            className="cursor-pointer rounded-[0.4rem] border border-line bg-transparent px-2 py-[0.2rem] font-mono text-[0.72rem] text-muted hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:text-muted"
          >
            {m.tide_today()}
          </button>
        </div>

        <div className="flex gap-4 max-[560px]:flex-col max-[560px]:items-center">
          {/* ── month grid: one cell per day, with its marnage bar ─────────────── */}
          <div className="grid grid-cols-[repeat(7,2rem)] gap-px">
            {weekdays.map((w, i) => (
              <span key={`w${i}`} className="pb-[0.2rem] text-center font-mono text-[0.62rem] text-faint">
                {w}
              </span>
            ))}
            {monthCells(view.y, view.m).map((c, i) => {
              if (!c) return <span key={`b${i}`} className="h-[2.15rem] w-[2rem]" />;
              const day = days.get(c.di);
              const mag = day?.marnage != null ? tideMagnitude(day.marnage, tides.rangeRef) : null;
              const isSel = c.di === sel;
              const isToday = c.di === todayDi;
              return (
                <button
                  key={c.di}
                  type="button"
                  disabled={!day}
                  aria-pressed={isSel}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={
                    `${dayTitle(c.di)}` +
                    `${mag ? ` · ${m.tide_marnage()} ${fmtNumber(day!.marnage!, locale, 1)} m` : ''}` +
                    `${day?.coef != null ? ` · ${m.tide_coef()} ${day.coef}` : ''}`
                  }
                  onClick={() => setSel(c.di)}
                  className={cn(
                    'relative inline-flex h-[2.15rem] w-[2rem] flex-col items-center justify-start rounded-[0.35rem] border-0 bg-transparent pt-[0.28rem] font-mono text-[0.76rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    day
                      ? 'cursor-pointer text-fg hover:bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]'
                      : 'cursor-default text-muted opacity-30',
                    isToday && !isSel && 'ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent)_55%,transparent)]',
                    isSel && 'bg-accent text-bg',
                  )}
                >
                  {c.day}
                  {mag && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none absolute bottom-[4px] left-1/2 h-[3px] w-[1.15rem] -translate-x-1/2 overflow-hidden rounded-full',
                        isSel ? 'bg-[color-mix(in_oklab,var(--bg)_35%,transparent)]' : 'bg-surface-2',
                      )}
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(12, Math.round(mag.t * 100))}%`, backgroundColor: isSel ? 'var(--bg)' : magHue(mag.label) }}
                      />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── the selected day's tides ───────────────────────────────────────── */}
          <div className="flex min-w-[11.5rem] flex-col gap-1.5 border-l border-line pl-4 max-[560px]:w-full max-[560px]:border-l-0 max-[560px]:border-t max-[560px]:pl-0 max-[560px]:pt-3">
            <div className="flex flex-col gap-[0.1rem]">
              {/* first-letter, NOT `capitalize` — that would title-case the month too
                  ("Samedi 1 Août"), which is wrong in FR/ES. */}
              <span className="font-display text-[0.88rem] font-semibold text-fg first-letter:uppercase">{dayTitle(sel)}</span>
              {selMag && selDay?.marnage != null ? (
                <span className="inline-flex flex-wrap items-baseline gap-x-1.5 font-mono text-[0.72rem] text-muted">
                  <span className="uppercase tracking-[0.06em] text-faint">{m.tide_marnage()}</span>
                  <span className="text-fg">{fmtNumber(selDay.marnage, locale, 1)} m</span>
                  <span style={{ color: magHue(selMag.label) }}>· {m[`tide_mag_${selMag.label}` as MessageKey]()}</span>
                  {selDay.coef != null && (
                    <span className="inline-flex items-baseline">
                      <span className="mr-1.5 text-faint" aria-hidden="true">
                        ·
                      </span>
                      {m.tide_coef_short()}
                      <span className="ml-1 text-fg">{selDay.coef}</span>
                      <InfoPopover title={m.tide_coef()} body={m.tide_coef_help()} />
                    </span>
                  )}
                </span>
              ) : (
                <span className="font-mono text-[0.72rem] text-faint">{m.tide_chart_empty()}</span>
              )}
            </div>

            {selDay && (
              <ul className="m-0 flex list-none flex-col gap-[0.2rem] p-0">
                {selDay.events.map((e) => {
                  const high = e.kind === 'high';
                  const isNext = e.t === nextT;
                  return (
                    <li
                      key={e.t}
                      className={cn(
                        'flex items-baseline gap-2 rounded-[0.3rem] px-1.5 py-[0.2rem] text-[0.78rem]',
                        e.t < now && 'opacity-55',
                        isNext && 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] opacity-100',
                      )}
                    >
                      <span aria-hidden="true" className="text-[0.7em]" style={{ color: high ? 'var(--accent)' : 'var(--text-3)' }}>
                        {high ? '▲' : '▼'}
                      </span>
                      <span className="flex flex-col leading-tight">
                        <span className={isNext ? 'text-fg' : 'text-muted'}>{high ? m.tide_high() : m.tide_low()}</span>
                        {isNext && (
                          <span className="font-mono text-[0.68rem] text-accent">
                            {m.tide_in()} {fmtCountdown(e.t - now)}
                          </span>
                        )}
                      </span>
                      <span className="ml-auto font-mono text-fg [font-feature-settings:'tnum']">{fmtTimeOfDay(e.t, locale, tz, units.clock)}</span>
                      <span className="w-[3.2rem] text-right font-mono text-[0.74rem] text-muted [font-feature-settings:'tnum']">
                        {fmtNumber(e.h, locale, 2)} m
                      </span>
                      {/* The coefficient belongs to the PM, tide-table style — the column
                          stays reserved on BM rows so the times/heights keep their grid. */}
                      <span
                        className="w-[1.6rem] text-right font-mono text-[0.72rem] text-faint [font-feature-settings:'tnum']"
                        title={e.coef != null ? m.tide_coef() : undefined}
                      >
                        {e.coef ?? ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2 text-[0.68rem] text-faint">
          <span>{m.tide_coverage()}</span>
          <span className="font-mono">
            {shortDate(bounds.lo)} – {shortDate(bounds.hi)}
          </span>
          <span className="ml-auto inline-flex items-center gap-[0.35rem]">
            <span className="h-[3px] w-[1.15rem] overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full w-1/2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
            </span>
            {m.tide_marnage()}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

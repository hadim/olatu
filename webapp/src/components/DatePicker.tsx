// Calendar date-range cherry-picker (spec 0001 §6.3 / 0003 N2) on the Radix Popover
// primitive (spec 0006 §4: focus return, Esc, outside-click). A dual-month panel that
// replaces the raw <input type=date> pair. Days that carry data are dotted and big-swell
// days flagged, so you can see at a glance where it's worth looking. Two-click range
// selection (anchor → end), all in UTC days to match the daily tier.

import { useMemo, useState } from 'react';
import { useLocale } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const DAY = 86_400;
const dayIndex = (sec: number) => Math.floor(sec / DAY);
/** UTC day-index → epoch-seconds at that day's midnight (the inverse of dayIndex). */
const dayStart = (di: number) => di * DAY;
const BIG_SWELL_M = 4; // the "big" sea-state band (specs/0002 §6)

interface Props {
  min: number; // current range start (epoch seconds)
  max: number; // current range end (epoch seconds)
  t0: number; // earliest selectable instant
  tn: number; // latest selectable instant
  dayHs: Map<number, number>; // UTC day-index → daily significant wave height
  onChange: (min: number, max: number) => void;
}

interface Cell {
  day: number;
  di: number;
}

function monthCells(year: number, month: number): (Cell | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (Cell | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push({ day: d, di: dayIndex(Date.UTC(year, month, d) / 1000) });
  return cells;
}

export default function DatePicker({ min, max, t0, tn, dayHs, onChange }: Props) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  // Show two months ending at the selection's end (so "now" is on the right pane, with
  // the preceding month for context) rather than a mostly-empty future month.
  const viewEndingAt = (sec: number) => {
    const d = new Date(sec * 1000);
    const k = d.getUTCFullYear() * 12 + d.getUTCMonth() - 1;
    return { y: Math.floor(k / 12), m: ((k % 12) + 12) % 12 };
  };
  const [view, setView] = useState(() => viewEndingAt(max));
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const loDi = dayIndex(t0);
  const hiDi = dayIndex(tn);

  // The selected (or in-progress) range, as a [lo, hi] pair of day-indices.
  const [selLo, selHi] = useMemo(() => {
    if (anchor != null) {
      const other = hover ?? anchor;
      return [Math.min(anchor, other), Math.max(anchor, other)];
    }
    return [dayIndex(min), dayIndex(max)];
  }, [anchor, hover, min, max]);

  const openPicker = () => {
    setView(viewEndingAt(max));
    setAnchor(null);
    setHover(null);
    setOpen(true);
  };

  const pick = (di: number) => {
    if (di < loDi || di > hiDi) return;
    if (anchor == null) {
      setAnchor(di);
      setHover(di);
      return;
    }
    const a = Math.min(anchor, di);
    const b = Math.max(anchor, di);
    setAnchor(null);
    setOpen(false);
    onChange(dayStart(a), dayStart(b) + DAY - 1);
  };

  const monthLabel = (y: number, mo: number) =>
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo, 1)));
  const rangeLabel = (sec: number) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(sec * 1000));

  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i)))); // 2024-01-01 = Monday
  }, [locale]);

  // Bounds for the prev/next chevrons: the left pane never goes before t0's month, and
  // the right pane (view.m + 1) never goes past tn's month.
  const viewKey = view.y * 12 + view.m;
  const minKey = new Date(t0 * 1000).getUTCFullYear() * 12 + new Date(t0 * 1000).getUTCMonth();
  const maxKey = new Date(tn * 1000).getUTCFullYear() * 12 + new Date(tn * 1000).getUTCMonth() - 1;
  const shift = (delta: number) => {
    const k = Math.min(maxKey, Math.max(minKey, viewKey + delta));
    setView({ y: Math.floor(k / 12), m: ((k % 12) + 12) % 12 });
  };

  const renderMonth = (y: number, mo: number) => {
    const mm = ((mo % 12) + 12) % 12;
    const yy = y + Math.floor(mo / 12);
    return (
      <div key={`${yy}-${mm}`}>
        <div className="mb-[0.4rem] text-center font-display text-[0.86rem] font-semibold capitalize">{monthLabel(yy, mm)}</div>
        <div className="grid grid-cols-[repeat(7,1.85rem)] gap-px">
          {weekdays.map((w, i) => (
            <span key={`w${i}`} className="pb-[0.2rem] text-center font-mono text-[0.62rem] text-faint">
              {w}
            </span>
          ))}
          {monthCells(yy, mm).map((c, i) => {
            if (!c) return <span key={`b${i}`} className="h-[1.85rem] w-[1.85rem]" />;
            const disabled = c.di < loDi || c.di > hiDi;
            const hs = dayHs.get(c.di);
            const hasData = hs != null;
            const isBig = hs != null && hs >= BIG_SWELL_M;
            const inRange = c.di >= selLo && c.di <= selHi;
            const isStart = c.di === selLo;
            const isEnd = c.di === selHi;
            const isEndpoint = isStart || isEnd;
            const rounding =
              isStart && isEnd ? 'rounded-[0.35rem]' : isStart ? 'rounded-l-[0.35rem] rounded-r-none' : isEnd ? 'rounded-r-[0.35rem] rounded-l-none' : inRange ? 'rounded-none' : 'rounded-[0.35rem]';
            return (
              <button
                key={c.di}
                type="button"
                disabled={disabled}
                aria-pressed={inRange}
                onClick={() => pick(c.di)}
                onPointerEnter={() => anchor != null && setHover(c.di)}
                className={cn(
                  'relative inline-flex h-[1.85rem] w-[1.85rem] items-center justify-center border-0 bg-transparent font-mono text-[0.76rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  rounding,
                  disabled
                    ? 'cursor-default text-muted opacity-30'
                    : 'cursor-pointer text-muted hover:bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] hover:text-fg',
                  hasData && !inRange && !disabled && 'text-fg',
                  inRange && !isEndpoint && 'bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-fg',
                  isEndpoint && 'bg-accent text-bg',
                )}
              >
                {c.day}
                {hasData && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute bottom-[2px] left-1/2 -translate-x-1/2 rounded-full',
                      isBig ? 'h-[4px] w-[4px]' : 'h-[3px] w-[3px]',
                      isEndpoint ? 'bg-bg' : isBig ? 'bg-danger' : 'bg-accent',
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => (o ? openPicker() : setOpen(false))}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-[0.4rem] rounded-[0.45rem] border border-line bg-surface px-[0.55rem] py-[0.3rem] font-mono text-[0.78rem] text-fg hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-faint">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
          <span>
            {rangeLabel(min)} – {rangeLabel(max)}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" role="dialog" aria-label={m.date_pick_range()} className="max-h-[80vh] w-auto overflow-y-auto p-[0.8rem]">
        <div className="mb-[0.2rem] flex justify-between">
          <button
            type="button"
            onClick={() => shift(-1)}
            disabled={viewKey <= minKey}
            aria-label={m.date_prev_month()}
            className="inline-flex h-[1.7rem] w-[1.7rem] cursor-pointer items-center justify-center rounded-[0.4rem] border border-line bg-transparent text-[1.1rem] leading-none text-fg hover:border-accent disabled:cursor-default disabled:opacity-30"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            disabled={viewKey >= maxKey}
            aria-label={m.date_next_month()}
            className="inline-flex h-[1.7rem] w-[1.7rem] cursor-pointer items-center justify-center rounded-[0.4rem] border border-line bg-transparent text-[1.1rem] leading-none text-fg hover:border-accent disabled:cursor-default disabled:opacity-30"
          >
            ›
          </button>
        </div>
        <div className="flex gap-[1.1rem] max-[720px]:flex-col max-[720px]:items-center">
          {renderMonth(view.y, view.m)}
          {renderMonth(view.y, view.m + 1)}
        </div>
        <div className="mt-[0.6rem] flex gap-4 text-[0.7rem] text-faint">
          <span className="inline-flex items-center gap-[0.35rem]">
            <span className="h-[4px] w-[4px] rounded-full bg-accent" /> {m.date_has_data()}
          </span>
          <span className="inline-flex items-center gap-[0.35rem]">
            <span className="h-[5px] w-[5px] rounded-full bg-danger" /> {m.date_big_swell()}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

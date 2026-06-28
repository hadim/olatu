// Calendar date-range cherry-picker (spec 0001 §6.3 / 0003 N2): a dual-month popover
// that replaces the raw <input type=date> pair. Days that carry data are dotted and
// big-swell days are flagged, so you can see at a glance where it's worth looking.
// Two-click range selection (anchor → end), all in UTC days to match the daily tier.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';

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
  const { t, locale } = useI18n();
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
  const rootRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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

  const monthLabel = (y: number, m: number) =>
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m, 1)));
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

  const renderMonth = (y: number, m: number) => {
    const mm = ((m % 12) + 12) % 12;
    const yy = y + Math.floor(m / 12);
    return (
      <div className="dp-month" key={`${yy}-${mm}`}>
        <div className="dp-month-label">{monthLabel(yy, mm)}</div>
        <div className="dp-grid">
          {weekdays.map((w, i) => (
            <span key={`w${i}`} className="dp-weekday">{w}</span>
          ))}
          {monthCells(yy, mm).map((c, i) => {
            if (!c) return <span key={`b${i}`} className="dp-blank" />;
            const disabled = c.di < loDi || c.di > hiDi;
            const hs = dayHs.get(c.di);
            const inRange = c.di >= selLo && c.di <= selHi;
            const cls = [
              'dp-day',
              disabled ? 'dp-day--off' : '',
              hs != null ? 'dp-day--data' : '',
              hs != null && hs >= BIG_SWELL_M ? 'dp-day--big' : '',
              inRange ? 'dp-day--in' : '',
              c.di === selLo ? 'dp-day--start' : '',
              c.di === selHi ? 'dp-day--end' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={c.di}
                type="button"
                className={cls}
                disabled={disabled}
                aria-pressed={inRange}
                onClick={() => pick(c.di)}
                onPointerEnter={() => anchor != null && setHover(c.di)}
              >
                {c.day}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="dp" ref={rootRef}>
      <button type="button" className="dp-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? setOpen(false) : openPicker())}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
        <span className="dp-trigger-text">{rangeLabel(min)} – {rangeLabel(max)}</span>
      </button>

      {open && (
        <div className="dp-panel" role="dialog" aria-label={t('date.pickRange')}>
          <div className="dp-nav">
            <button type="button" className="dp-chev" onClick={() => shift(-1)} disabled={viewKey <= minKey} aria-label={t('date.prevMonth')}>‹</button>
            <button type="button" className="dp-chev" onClick={() => shift(1)} disabled={viewKey >= maxKey} aria-label={t('date.nextMonth')}>›</button>
          </div>
          <div className="dp-months">
            {renderMonth(view.y, view.m)}
            {renderMonth(view.y, view.m + 1)}
          </div>
          <div className="dp-legend">
            <span className="dp-legend-item"><span className="dp-dot" /> {t('date.hasData')}</span>
            <span className="dp-legend-item"><span className="dp-dot dp-dot--big" /> {t('date.bigSwell')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

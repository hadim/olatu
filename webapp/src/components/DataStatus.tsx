// The data-loading indicator (spec 0019): one small widget that makes every fetch visible.
//
// Two states, same widget:
//   • COLD (nothing painted yet) — a determinate top bar + a pill counting the tiers in, so the
//     first paint reads as "3 of 5 loaded", not as a silent freeze behind the skeletons.
//   • WARM (the page is already showing cached data) — the same bar, thinner in attention: the
//     pill only appears if the refresh takes longer than a blink, and it confirms with a short
//     "updated" flash only when the refresh actually brought something new.
//
// It reads lib/progress (which every tier fetch registers with), so no loader knows about it.

import { useEffect, useRef, useState } from 'react';
import { useLoadProgress } from '@/lib/progress';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';

// A warm refresh under this is invisible: a 200 ms poll that finds nothing shouldn't blink at you.
const WARM_DELAY_MS = 500;
// How long the "updated" confirmation stays after a refresh that changed something.
const FLASH_MS = 2200;
// Loads started within this window of the page opening are part of OPENING the page (the eager
// tiers, then the detail tiers they unlock). Only later bursts — the 5-min poll, a tab regaining
// focus, a buoy switch — are "a refresh" worth confirming.
const OPENING_MS = 6000;

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="motion-safe:animate-spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function DataStatus({ hasData, refreshError }: { hasData: boolean; refreshError?: boolean }) {
  const { active, done, total, changed, burst } = useLoadProgress();
  const [showPill, setShowPill] = useState(false);
  const [flash, setFlash] = useState(false);
  const lastBurst = useRef(burst);
  // Whether the page already had data when this burst STARTED. A cold load ends with
  // "changed = true" by definition, and confirming a page that just filled itself in would
  // be noise — only a refresh of something already on screen is worth a confirmation.
  const prevActive = useRef(0);
  const warmBurst = useRef(false);
  const mountedAt = useRef(0);
  if (mountedAt.current === 0) mountedAt.current = Date.now();

  useEffect(() => {
    if (prevActive.current === 0 && active > 0) {
      warmBurst.current = hasData && Date.now() - mountedAt.current > OPENING_MS;
    }
    prevActive.current = active;
  }, [active, hasData]);

  // Pill visibility. Cold: immediate (the skeletons are already up, the pill explains them).
  // Warm: only once the refresh is slow enough to be worth mentioning.
  useEffect(() => {
    if (active === 0) {
      setShowPill(false);
      return;
    }
    if (!hasData) {
      setShowPill(true);
      return;
    }
    const id = window.setTimeout(() => setShowPill(true), WARM_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [active, hasData]);

  // "Updated" confirmation — only for a WARM burst that actually changed something. A cold load
  // needs no confirmation: the page filling in IS the confirmation.
  useEffect(() => {
    if (burst === lastBurst.current) return;
    lastBurst.current = burst;
    if (!warmBurst.current || !changed) return;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), FLASH_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst]);

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const barVisible = active > 0;
  // Never sit at 0 %: a bar that hasn't moved reads as broken. It fills to 100 % on the last task.
  const barPct = active > 0 ? Math.max(8, pct) : 100;

  const visible = showPill || flash || !!refreshError;
  const label = refreshError
    ? m.load_offline()
    : flash
      ? m.load_updated()
      : hasData
        ? m.load_refreshing()
        : m.load_progress();

  return (
    <>
      {/* Progress rail, pinned to the top of the viewport. Decorative — the pill carries the
          announcement, so screen readers hear it once, as text. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] transition-opacity duration-300',
          barVisible ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div
          className="h-full bg-accent shadow-[0_0_8px_-1px_var(--accent)] transition-[width] duration-500 ease-out"
          style={{ width: `${barPct}%` }}
        />
      </div>

      <div
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed left-1/2 top-[0.55rem] z-[60] -translate-x-1/2 transition-all duration-200',
          visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
        )}
      >
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-[0.3rem] text-[0.76rem] shadow-[0_6px_18px_-10px_rgba(0,0,0,0.8)] backdrop-blur',
            refreshError
              ? 'border-[color-mix(in_oklab,var(--danger)_45%,var(--divider))] bg-[color-mix(in_oklab,var(--danger)_10%,var(--surface))] text-fg'
              : 'border-line bg-[color-mix(in_oklab,var(--surface)_88%,transparent)] text-muted',
          )}
        >
          {refreshError ? null : flash ? <CheckIcon /> : <Spinner />}
          <span>{visible ? label : ''}</span>
          {!hasData && !refreshError && done > 0 && (
            <span className="font-mono text-[0.7rem] text-faint tabular-nums">{pct}%</span>
          )}
        </span>
      </div>
    </>
  );
}

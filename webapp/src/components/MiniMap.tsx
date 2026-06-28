// Static mini-map: a committed CARTO tile mosaic centred on the buoy (dark/light per
// theme), instant, no runtime map. Clicking opens the interactive MapLibre map, which
// is lazy-loaded (its ~200 KB runtime never touches first paint).

import { Suspense, lazy, useState } from 'react';
import { useTheme } from '../lib/theme';
import { useLocale } from '@/lib/i18n';
import { m } from '@/paraglide/messages';

const ExpandedMap = lazy(() => import('./ExpandedMap'));
const BASE = import.meta.env.BASE_URL;

export default function MiniMap({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const { theme } = useTheme();
  useLocale();
  const [open, setOpen] = useState(false);
  const src = `${BASE}map/buoy-${theme}.png`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${m.map_title()} — ${label}`}
        className="group relative block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-2xl border border-line bg-surface-2 p-0 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <img className="block h-full w-full object-cover" src={src} alt="" width={640} height={400} loading="lazy" />
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_28%,transparent),0_0_12px_var(--accent)]"
          aria-hidden="true"
        >
          <span className="absolute -inset-1 rounded-full border border-accent motion-safe:animate-[marker-pulse_2.6s_ease-out_infinite]" />
        </span>
        <span className="absolute right-[7px] top-[7px] flex h-[1.6rem] w-[1.6rem] items-center justify-center rounded-[0.4rem] bg-[color-mix(in_oklab,var(--surface)_74%,transparent)] text-muted group-hover:text-accent" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2v-4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M3 9V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="absolute bottom-[5px] right-[6px] rounded-[4px] bg-[color-mix(in_oklab,var(--surface)_72%,transparent)] px-1.5 py-px font-mono text-[0.62rem] text-muted">© OpenStreetMap · CARTO</span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <ExpandedMap lat={lat} lon={lon} label={label} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

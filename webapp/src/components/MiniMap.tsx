// Static mini-map: a committed CARTO tile mosaic centred on the buoy (dark/light per
// theme), instant, no runtime map. Clicking opens the interactive MapLibre map, which
// is lazy-loaded (its ~200 KB runtime never touches first paint).

import { Suspense, lazy, useState } from 'react';
import { useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

const ExpandedMap = lazy(() => import('./ExpandedMap'));
const BASE = import.meta.env.BASE_URL;

export default function MiniMap({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const src = `${BASE}map/buoy-${theme}.png`;

  return (
    <>
      <button type="button" className="minimap" onClick={() => setOpen(true)} aria-label={`${t('map.title')} — ${label}`}>
        <img className="minimap-img" src={src} alt="" width={640} height={400} loading="lazy" />
        <span className="minimap-marker" aria-hidden="true" />
        <span className="minimap-expand" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2v-4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M3 9V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="minimap-attrib">© OpenStreetMap · CARTO</span>
      </button>
      {open && (
        <Suspense fallback={null}>
          <ExpandedMap lat={lat} lon={lon} label={label} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

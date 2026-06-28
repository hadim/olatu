// Interactive expanded map (spec 0001 §6.4 / Phase 4) on the Radix Dialog primitive
// (spec 0006 §4: focus trap, Esc, scroll-lock). Lazy-loaded on demand so the MapLibre
// runtime (~200 KB) never touches first paint. Keyless: a raster style over CARTO tiles
// (same look as the static mini-map), theme-aware, with a marker on the buoy.

import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '../lib/theme';
import { useLocale } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function rasterStyle(theme: string): unknown {
  const base = theme === 'dark' ? 'dark_all' : 'light_all';
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [`https://basemaps.cartocdn.com/${base}/{z}/{x}/{y}@2x.png`],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
  };
}

export default function ExpandedMap({ lat, lon, label, onClose }: { lat: number; lon: number; label: string; onClose: () => void }) {
  const { theme } = useTheme();
  useLocale();
  const mapEl = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=11/${lat}/${lon}`;

  useEffect(() => {
    let map: MlMap | undefined;
    let cancelled = false;
    (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled || !mapEl.current) return;
      map = new maplibre.Map({
        container: mapEl.current,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style: rasterStyle(theme) as any,
        center: [lon, lat],
        zoom: 10,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38e1c6';
      new maplibre.Marker({ color: accent }).setLngLat([lon, lat]).addTo(map);
      map.on('load', () => {
        if (!cancelled) setLoading(false);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [theme, lat, lon]);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent aria-label={m.map_title()} className="h-[min(640px,86vh)] w-[min(920px,94vw)]">
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <DialogTitle className="m-0 font-display text-[1.05rem] font-semibold text-fg">
            {m.map_title()} — {label}
          </DialogTitle>
          <DialogClose asChild>
            <Button variant="outline" size="icon" aria-label={m.a11y_close()}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </Button>
          </DialogClose>
        </div>
        <div className="relative flex-1" ref={mapEl}>
          {loading && <div className="absolute inset-0 z-[1] flex items-center justify-center bg-surface-2 text-[0.9rem] text-muted">{m.map_loading()}</div>}
        </div>
        <div className="border-t border-line px-4 py-2.5 text-[0.82rem]">
          <a className="text-muted no-underline hover:text-accent" href={osm} target="_blank" rel="noopener noreferrer">
            {m.map_open_external()} ↗
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

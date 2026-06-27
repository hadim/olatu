// Interactive expanded map (spec 0001 §6.4 / Phase 4). Lazy-loaded on demand so the
// MapLibre runtime (~200 KB) never touches first paint. Keyless: a raster style over
// CARTO tiles (same look as the static mini-map), theme-aware, with a marker on the buoy.

import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

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
  const { t } = useI18n();
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="map-modal-backdrop" onClick={onClose}>
      <div className="map-modal" role="dialog" aria-modal="true" aria-label={t('map.title')} onClick={(e) => e.stopPropagation()}>
        <div className="map-modal-head">
          <h2>
            {t('map.title')} — {label}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('a11y.close')}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="map-modal-canvas" ref={mapEl}>
          {loading && <div className="map-loading">{t('map.loading')}</div>}
        </div>
        <div className="map-modal-foot">
          <a href={osm} target="_blank" rel="noopener noreferrer">
            {t('map.openExternal')} ↗
          </a>
        </div>
      </div>
    </div>
  );
}

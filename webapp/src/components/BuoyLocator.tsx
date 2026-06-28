// The map-based buoy picker (spec 0005 §5.2): a small interactive map showing BOTH
// buoys as markers — the active one highlighted, click an inactive one to switch.
//
// MapLibre (~200 KB) is dynamic-imported inside the effect so it code-splits and loads
// AFTER first paint, behind a themed placeholder — the banner-first paint is never
// taxed (spec 0001 §7.3). The always-instant, accessible selector is the segmented
// control in the station bar; this map is the visual companion. CARTO raster tiles
// (keyless), theme-aware (rebuilt on theme change), same look as the detail map.

import { useEffect, useRef } from 'react';
import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { BUOYS } from '../lib/buoys';

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

export default function BuoyLocator({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (campaign: string) => void;
}) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const mapEl = useRef<HTMLDivElement>(null);
  const markers = useRef<Record<string, HTMLButtonElement>>({});
  // Keep the latest onSelect/selected for the (theme-scoped) marker click handlers
  // without forcing a full map rebuild when only the selection changes.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Build the map once per theme (raster tiles differ dark/light), add a marker per buoy.
  useEffect(() => {
    let map: MlMap | undefined;
    const created: MlMarker[] = [];
    let cancelled = false;
    (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled || !mapEl.current) return;
      const lons = BUOYS.map((b) => b.lon);
      const lats = BUOYS.map((b) => b.lat);
      const bounds = new maplibre.LngLatBounds(
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      );
      map = new maplibre.Map({
        container: mapEl.current,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style: rasterStyle(theme) as any,
        bounds,
        fitBoundsOptions: { padding: { top: 54, bottom: 30, left: 64, right: 64 }, maxZoom: 11 },
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.scrollZoom.disable(); // a picker, not a pan/zoom surface — keep it calm
      map.touchZoomRotate.disableRotation();

      markers.current = {};
      for (const b of BUOYS) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'locator-marker';
        el.setAttribute('aria-label', b.name);
        const dot = document.createElement('span');
        dot.className = 'locator-dot';
        const name = document.createElement('span');
        name.className = 'locator-name';
        name.textContent = b.name; // static registry value (buoys.ts), not user input
        el.append(dot, name);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectRef.current(b.campaign_id);
        });
        markers.current[b.campaign_id] = el;
        created.push(new maplibre.Marker({ element: el, anchor: 'bottom' }).setLngLat([b.lon, b.lat]).addTo(map));
      }
      // initial active state
      for (const b of BUOYS) markers.current[b.campaign_id]?.classList.toggle('locator-marker--active', b.campaign_id === selected);
    })();
    return () => {
      cancelled = true;
      for (const m of created) m.remove();
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Reflect selection changes without rebuilding the map.
  useEffect(() => {
    for (const b of BUOYS) markers.current[b.campaign_id]?.classList.toggle('locator-marker--active', b.campaign_id === selected);
  }, [selected]);

  return (
    <div className="locator">
      <div className="locator-canvas" ref={mapEl} aria-label={t('picker.mapLabel')} role="group" />
      <span className="locator-hint">{t('picker.mapHint')}</span>
    </div>
  );
}

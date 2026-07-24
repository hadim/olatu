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
import { useLocale } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { BUOYS, buoyInfo } from '../lib/buoys';
import { STATIONS } from '../lib/stations';

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
  useLocale();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<Record<string, HTMLButtonElement>>({});
  // Skip the fly-to on the very first selection effect (mount): the map opens on the
  // all-buoys overview; only a real buoy *switch* should zoom/pan to the new buoy.
  const firstSelect = useRef(true);
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
      // Open zoomed on the *selected* buoy (like the old static mini-map), not the
      // all-buoys overview — the segmented control + a scroll-out reveal the others,
      // and switching flies between them. `selected` is captured per theme-rebuild.
      const here = buoyInfo(selected);
      map = new maplibre.Map({
        container: mapEl.current,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style: rasterStyle(theme) as any,
        center: [here.lon, here.lat],
        zoom: 9.5,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      mapRef.current = map;
      // Explore-able: scroll-wheel zoom + on-map +/- controls, no rotation.
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

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

      // Wind/air stations (spec 0013 rev): amber reference markers so you can see where each buoy's
      // paired station sits on land relative to the offshore buoy. Non-interactive — the station
      // picker lives in the station bar; here they're purely for spatial context.
      for (const s of STATIONS) {
        const el = document.createElement('div');
        el.className = 'locator-station';
        el.title = s.label; // static registry value (stations.ts), not user input
        const dot = document.createElement('span');
        dot.className = 'locator-station-dot';
        const name = document.createElement('span');
        name.className = 'locator-station-name';
        name.textContent = s.label;
        el.append(dot, name);
        created.push(new maplibre.Marker({ element: el, anchor: 'bottom' }).setLngLat([s.lon, s.lat]).addTo(map));
      }
    })();
    return () => {
      cancelled = true;
      for (const m of created) m.remove();
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Reflect selection changes without rebuilding the map, and fly to the newly-selected
  // buoy (zoom + pan) — but not on the initial mount, which keeps the all-buoys overview.
  useEffect(() => {
    for (const b of BUOYS) markers.current[b.campaign_id]?.classList.toggle('locator-marker--active', b.campaign_id === selected);
    if (firstSelect.current) {
      firstSelect.current = false;
      return;
    }
    const b = buoyInfo(selected);
    mapRef.current?.easeTo({ center: [b.lon, b.lat], zoom: 9.5, duration: 900 });
  }, [selected]);

  return (
    <div className="relative w-full">
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-line bg-surface-2"
        ref={mapEl}
        aria-label={m.picker_map_label()}
        role="group"
      />
      <span className="pointer-events-none absolute bottom-[0.5rem] left-[0.55rem] z-[1] rounded-[0.4rem] bg-[color-mix(in_oklab,var(--surface)_82%,transparent)] px-2 py-[0.2rem] font-mono text-[0.66rem] text-muted">
        {m.picker_map_hint()}
      </span>
    </div>
  );
}

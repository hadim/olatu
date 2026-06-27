// Static mini-map: a committed CARTO tile mosaic centred on the buoy (dark/light per
// theme), with a marker at the exact centre and attribution. No runtime map runtime
// (no MapLibre/WebGL) — clicking opens the full map on openstreetmap.org. The lazy
// MapLibre expanded view comes in a later phase (spec 0001 §6.4).

import { useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';

const BASE = import.meta.env.BASE_URL;

export default function MiniMap({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const src = `${BASE}map/buoy-${theme}.png`;
  const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=11/${lat}/${lon}`;

  return (
    <a
      className="minimap"
      href={osm}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${t('station.position')} — ${label}`}
    >
      <img className="minimap-img" src={src} alt="" width={640} height={400} loading="lazy" />
      <span className="minimap-marker" aria-hidden="true" />
      <span className="minimap-attrib">© OpenStreetMap · CARTO</span>
    </a>
  );
}

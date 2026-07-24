// Small, discreet line icons for the readouts (banner, chart panel titles, hover
// card). They inherit `currentColor`, so each call site tints them — we tie them to
// the chart series colours (the --c-* tokens in styles.css) so the banner and the
// charts read as one system. 24×24 grid, 2px round strokes.
//
// One source of truth (ICON_PATHS) feeds both the React components (banner, JSX) and
// `iconSvg()` (raw markup for the chart, which builds its titles/hover card via the DOM).

import type { SVGProps } from 'react';

export const ICON_PATHS = {
  /** Significant wave height — two stacked swell crests. */
  waveHeight:
    '<path d="M2 8c2 0 2.2-3 4-3s2 3 4 3 2-3 4-3 2 3 4 3"/><path d="M2 15c2 0 2.2-3 4-3s2 3 4 3 2-3 4-3 2 3 4 3"/>',
  /** Max wave — a single crest with an upward peak marker. */
  maxWave: '<path d="M2 16c2.5 0 2.5-3 5-3s2.5 3 5 3"/><path d="M19 16V6"/><path d="M16 9l3-3 3 3"/>',
  /** Swell period — a stopwatch (time between waves). */
  period: '<circle cx="12" cy="14" r="7"/><path d="M9 2h6"/><path d="M12 4v3"/><path d="M12 14l3-2"/>',
  /** Swell direction — a navigation arrow. */
  direction: '<path d="M3 11l19-9-9 19-2-8-8-2z"/>',
  /** Directional spread — a cone opening from a point. */
  spread: '<path d="M12 4l-6 12M12 4l6 12"/><path d="M6 16a8 8 0 0 0 12 0"/>',
  /** Sea temperature — a thermometer. */
  temp: '<path d="M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0z"/>',
  /** Tide (marée) — a swell crest over two shore/datum lines (water level rising/falling). */
  tide: '<path d="M2 9c2.4 0 2.4 3 4.8 3S9.2 9 11.6 9 14 12 16.4 12 18.8 9 21.2 9"/><path d="M3 15.5h18"/><path d="M3 19h18"/>',
  // --- Air realm (station / wind) — spec 0013 ---
  /** Wind (vent) — three flowing gusts with curl ends. */
  wind: '<path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h8a2 2 0 1 1-2 2"/>',
  /** Weather station — an anemometer: mast + three spokes ending in cups. */
  station: '<path d="M12 21v-8.5"/><path d="M12 12.5l5-2.6M12 12.5L7 9.9M12 12.5l1-5.4"/><path d="M17.4 9.4h.01M6.6 9.4h.01M13 6.6h.01"/>',
  /** Rain (pluie) — a cloud with three streaks. */
  rain: '<path d="M7 14a4.5 4.5 0 0 1 .8-8.9 5.5 5.5 0 0 1 10.4 1.5A3.7 3.7 0 0 1 17.5 14"/><path d="M8 17l-1 2.5M12 17l-1 2.5M16 17l-1 2.5"/>',
  /** Humidity (humidité) — a droplet. */
  humidity: '<path d="M12 3s6 6.4 6 10.4a6 6 0 1 1-12 0C6 9.4 12 3 12 3z"/>',
  /** Pressure (pression) — a barometer gauge with a needle. */
  pressure: '<circle cx="12" cy="12" r="9"/><path d="M12 12l4-2.5"/><path d="M12 4v1.6M20 12h-1.6"/>',
  /** Visibility toggle — an eye (used to hide a chart panel). */
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
  /** Drag handle — six dots (rendered as round line-caps). */
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ name, size = 14, ...props }: IconProps & { name: IconName }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
      {...props}
    />
  );
}

export const WaveHeightIcon = (p: IconProps) => <Icon {...p} name="waveHeight" />;
export const MaxWaveIcon = (p: IconProps) => <Icon {...p} name="maxWave" />;
export const PeriodIcon = (p: IconProps) => <Icon {...p} name="period" />;
export const DirectionIcon = (p: IconProps) => <Icon {...p} name="direction" />;
export const TempIcon = (p: IconProps) => <Icon {...p} name="temp" />;
export const TideIcon = (p: IconProps) => <Icon {...p} name="tide" />;
export const WindIcon = (p: IconProps) => <Icon {...p} name="wind" />;
export const StationIcon = (p: IconProps) => <Icon {...p} name="station" />;
export const RainIcon = (p: IconProps) => <Icon {...p} name="rain" />;
export const HumidityIcon = (p: IconProps) => <Icon {...p} name="humidity" />;
export const PressureIcon = (p: IconProps) => <Icon {...p} name="pressure" />;
export const EyeIcon = (p: IconProps) => <Icon {...p} name="eye" />;
export const GripIcon = (p: IconProps) => <Icon {...p} name="grip" />;

/** Raw `<svg>` markup for DOM/innerHTML contexts (the uPlot panel titles + hover card). */
export function iconSvg(name: IconName, opts: { size?: number; color?: string; className?: string } = {}): string {
  const { size = 14, color, className } = opts;
  const cls = className ? ` class="${className}"` : '';
  const style = color ? ` style="color:${color}"` : '';
  return `<svg${cls}${style} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

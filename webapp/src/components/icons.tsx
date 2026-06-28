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

/** Raw `<svg>` markup for DOM/innerHTML contexts (the uPlot panel titles + hover card). */
export function iconSvg(name: IconName, opts: { size?: number; color?: string; className?: string } = {}): string {
  const { size = 14, color, className } = opts;
  const cls = className ? ` class="${className}"` : '';
  const style = color ? ` style="color:${color}"` : '';
  return `<svg${cls}${style} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

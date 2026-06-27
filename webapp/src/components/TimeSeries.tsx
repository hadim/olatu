// Synced multi-panel time-series (uPlot, canvas). One instance per panel, sharing
// the x-axis + crosshair. Theme-aware (re-created when the theme changes).
// v1 feeds from daily means (full history); 30-min detail + direction glyphs come later.

import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import type { Columnar } from '../lib/parquet';

const SYNC_KEY = 'olatu-ts';
const DAY = 86_400;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

interface PanelDef {
  titleKey: string;
  series: { key: string; colorVar: string; width?: number; fill?: boolean }[];
  points?: boolean; // render markers instead of a connected line (direction)
  range?: [number, number];
  ySplits?: number[];
  yValues?: (v: number) => string;
}

const PANELS: PanelDef[] = [
  {
    titleKey: 'cc.waveHeight',
    series: [
      { key: 'significant_wave_height_m', colorVar: '--c-height', width: 2, fill: true },
      { key: 'max_wave_height_m', colorVar: '--c-max', width: 1 },
    ],
  },
  { titleKey: 'cc.period', series: [{ key: 'peak_period_s', colorVar: '--c-period', width: 2 }] },
  {
    titleKey: 'cc.direction',
    series: [{ key: 'peak_direction_deg', colorVar: '--c-dir' }],
    points: true,
    range: [0, 360],
    ySplits: [0, 90, 180, 270, 360],
  },
  { titleKey: 'cc.seaTemp', series: [{ key: 'sea_temperature_c', colorVar: '--c-temp', width: 2, fill: true }] },
];

const PRESETS: { key: string; days: number | null }[] = [
  { key: '1M', days: 30 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
  { key: '5Y', days: 365 * 5 },
  { key: 'All', days: null },
];

export default function TimeSeries({ data }: { data: Columnar }) {
  const { theme } = useTheme();
  const { locale, t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState<string>('1Y');

  const dirLocale = (deg: number) => {
    const tok = ['N', 'E', 'S', 'W'][Math.round(deg / 90) % 4];
    return locale === 'en' ? tok : tok === 'W' ? 'O' : tok;
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || data.t.length === 0) return;
    host.innerHTML = '';

    const xs = data.t;
    const xmax = xs[xs.length - 1];
    const preDays = PRESETS.find((p) => p.key === preset)?.days ?? null;
    const xmin = preDays == null ? xs[0] : xmax - preDays * DAY;

    const axisColor = cssVar('--text-3');
    const gridColor = cssVar('--hairline');
    const plots: uPlot[] = [];
    let syncing = false;

    // Skip panels whose data is essentially absent (e.g. sea temperature, which only
    // exists in the realtime feed and accumulates forward over time).
    const visible = PANELS.filter((panel) =>
      panel.series.some((s) => (data[s.key] as (number | null)[]).filter((v) => v != null).length >= 10),
    );

    visible.forEach((panel, idx) => {
      const isLast = idx === visible.length - 1;
      const wrap = document.createElement('div');
      wrap.className = 'chart-panel';
      const heading = document.createElement('div');
      heading.className = 'chart-panel-title';
      heading.textContent = t(panel.titleKey as 'cc.waveHeight');
      host.appendChild(heading);
      host.appendChild(wrap);

      const chartData: uPlot.AlignedData = [
        xs,
        ...panel.series.map((s) => data[s.key] as (number | null)[]),
      ];

      const series: uPlot.Series[] = [
        {},
        ...panel.series.map((s) => {
          const color = cssVar(s.colorVar);
          const base: uPlot.Series = { label: s.key, stroke: color, width: s.width ?? 2, value: (_u, v) => (v == null ? '—' : v.toFixed(1)) };
          if (panel.points) {
            base.paths = () => null;
            base.points = { show: true, size: 3, fill: color, stroke: color };
          }
          if (s.fill) base.fill = color + '22';
          return base;
        }),
      ];

      const yAxis: uPlot.Axis = {
        scale: 'y',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
        size: 46,
        font: '11px IBM Plex Mono, monospace',
      };
      if (panel.ySplits) yAxis.splits = () => panel.ySplits!;
      if (panel.titleKey === 'cc.direction') yAxis.values = (_u, splits) => splits.map((s) => dirLocale(s));

      const xAxis: uPlot.Axis = {
        scale: 'x',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
        font: '11px IBM Plex Mono, monospace',
        show: isLast,
        size: isLast ? 34 : 8,
      };

      const opts: uPlot.Options = {
        width: host.clientWidth || 800,
        height: panel.points ? 130 : 120,
        scales: {
          x: { time: true, min: xmin, max: xmax },
          y: panel.range ? { range: () => panel.range! } : {},
        },
        axes: [xAxis, yAxis],
        series,
        legend: { show: false },
        cursor: { sync: { key: SYNC_KEY }, points: { size: 6 } },
        hooks: {
          setScale: [
            (u, key) => {
              if (key !== 'x' || syncing) return;
              syncing = true;
              const { min, max } = u.scales.x;
              for (const o of plots) if (o !== u && min != null && max != null) o.setScale('x', { min, max });
              syncing = false;
            },
          ],
        },
      };

      plots.push(new uPlot(opts, chartData, wrap));
    });

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      for (const p of plots) p.setSize({ width: w, height: p.height });
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      for (const p of plots) p.destroy();
    };
  }, [data, theme, locale, preset, t]);

  return (
    <section className="charts-section">
      <div className="charts-toolbar">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`chip ${preset === p.key ? 'chip--active' : ''}`}
            onClick={() => setPreset(p.key)}
          >
            {p.key}
          </button>
        ))}
      </div>
      <div ref={hostRef} className="charts" />
    </section>
  );
}

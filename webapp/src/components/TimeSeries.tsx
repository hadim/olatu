// Synced multi-panel time-series (uPlot, canvas). One instance per panel, sharing
// the x-axis + crosshair. Theme-aware (re-created when the theme changes).
// v1 feeds from daily means (full history); 30-min detail + direction glyphs come later.
//
// Spec 0003 batch 1: year-aware x-axis ticks, clipped points, always-present temp panel
// with an empty-state overlay, a discreet hover value card, a visible zoom selection,
// a translucent ± spread band on the direction track, and a Raw/Light/Strong smoother.

import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '../lib/theme';
import { useI18n, type MessageKey } from '../lib/i18n';
import { compass, fmtNumber, fmtDateTime, fmtAxisTick } from '../lib/format';
import type { Columnar } from '../lib/parquet';

const SYNC_KEY = 'olatu-ts';
const DAY = 86_400;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

interface PanelDef {
  titleKey: MessageKey;
  series: { key: string; colorVar: string; width?: number; fill?: boolean }[];
  points?: boolean; // render markers instead of a connected line (direction)
  range?: [number, number];
  ySplits?: number[];
  spreadKey?: string; // draw a translucent ± band around the first series (direction)
  emptyKey?: MessageKey; // overlay message when the window has no data (sea temp)
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
    spreadKey: 'peak_directional_spread_deg',
  },
  {
    titleKey: 'cc.seaTemp',
    series: [{ key: 'sea_temperature_c', colorVar: '--c-temp', width: 2, fill: true }],
    emptyKey: 'chart.tempUnavailable',
  },
];

const PRESETS: { key: string; days: number | null }[] = [
  { key: '1M', days: 30 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
  { key: '5Y', days: 365 * 5 },
  { key: 'All', days: null },
];

type Smooth = 'raw' | 'light' | 'strong';
const SMOOTH_RADIUS: Record<Smooth, number> = { raw: 0, light: 2, strong: 7 };

/** Gap-aware centred moving average. Keeps nulls where the centre is missing. */
function movingAvg(arr: (number | null)[], radius: number): (number | null)[] {
  if (radius <= 0) return arr;
  const out: (number | null)[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) {
      out[i] = null;
      continue;
    }
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(arr.length - 1, i + radius); j++) {
      const v = arr[j];
      if (v != null) {
        sum += v;
        n += 1;
      }
    }
    out[i] = n ? sum / n : null;
  }
  return out;
}

// Compact metrics shown in the hover card (always the RAW value — "exact data").
const CARD_METRICS: { key: string; labelKey: MessageKey; unit?: string; digits?: number; dir?: boolean; pm?: boolean }[] = [
  { key: 'significant_wave_height_m', labelKey: 'cc.waveHeight', unit: 'm', digits: 1 },
  { key: 'max_wave_height_m', labelKey: 'cc.maxWave', unit: 'm', digits: 1 },
  { key: 'peak_period_s', labelKey: 'cc.period', unit: 's', digits: 1 },
  { key: 'peak_direction_deg', labelKey: 'cc.direction', dir: true },
  { key: 'peak_directional_spread_deg', labelKey: 'cc.spread', unit: '°', digits: 0, pm: true },
  { key: 'sea_temperature_c', labelKey: 'cc.seaTemp', unit: '°C', digits: 1 },
];

export default function TimeSeries({ data, tz }: { data: Columnar; tz: string }) {
  const { theme } = useTheme();
  const { locale, t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState<string>('1Y');
  const [smooth, setSmooth] = useState<Smooth>('raw');

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
    const radius = SMOOTH_RADIUS[smooth];

    const axisColor = cssVar('--text-3');
    const gridColor = cssVar('--hairline');
    const plots: uPlot[] = [];
    let syncing = false;

    // ---- hover value card -------------------------------------------------
    const timeEl = cardRef.current?.querySelector<HTMLElement>('.hover-time') ?? null;
    const statsEl = cardRef.current?.querySelector<HTMLElement>('.hover-stats') ?? null;
    const resetCard = () => {
      if (timeEl) timeEl.textContent = t('chart.hoverHint');
      if (statsEl) statsEl.innerHTML = '';
    };
    const renderCard = (idx: number | null | undefined) => {
      if (idx == null) {
        resetCard();
        return;
      }
      if (timeEl) timeEl.textContent = fmtDateTime(xs[idx] * 1000, locale, tz);
      if (!statsEl) return;
      const chips: string[] = [];
      for (const m of CARD_METRICS) {
        const col = data[m.key] as (number | null)[] | undefined;
        const v = col?.[idx];
        if (v == null) continue;
        let val: string;
        if (m.dir) val = `${compass(v, locale)} · ${Math.round(v)}°`;
        else val = `${m.pm ? '±' : ''}${fmtNumber(v, locale, m.digits ?? 1)}${m.unit ? ` ${m.unit}` : ''}`;
        chips.push(`<span class="hover-chip"><span class="hover-chip-label">${t(m.labelKey)}</span><span class="hover-chip-value">${val}</span></span>`);
      }
      statsEl.innerHTML = chips.join('');
    };
    resetCard();

    PANELS.forEach((panel, idx) => {
      const isLast = idx === PANELS.length - 1;
      const wrap = document.createElement('div');
      wrap.className = 'chart-panel';
      const heading = document.createElement('div');
      heading.className = 'chart-panel-title';
      heading.textContent = t(panel.titleKey);
      host.appendChild(heading);
      host.appendChild(wrap);

      // does this window actually contain data? (drives the temp empty-state)
      const inWindow = (key: string) => {
        const col = data[key] as (number | null)[];
        let n = 0;
        for (let i = 0; i < xs.length; i++) {
          if (xs[i] >= xmin && xs[i] <= xmax && col[i] != null) n += 1;
          if (n >= 2) return true;
        }
        return false;
      };
      const hasData = panel.series.some((s) => inWindow(s.key));

      // smoothing applies to value lines only; direction (circular) stays raw
      const plotted = (key: string) =>
        panel.points ? (data[key] as (number | null)[]) : movingAvg(data[key] as (number | null)[], radius);

      let chartData: uPlot.AlignedData;
      let series: uPlot.Series[];
      let bands: uPlot.Band[] | undefined;

      if (panel.spreadKey) {
        // direction panel: [hi, lo, dir] so the dir markers draw on top of the band
        const dir = data[panel.series[0].key] as (number | null)[];
        const sp = data[panel.spreadKey] as (number | null)[];
        const hi = dir.map((d, i) => (d == null || sp[i] == null ? null : Math.min(360, d + (sp[i] as number))));
        const lo = dir.map((d, i) => (d == null || sp[i] == null ? null : Math.max(0, d - (sp[i] as number))));
        const color = cssVar(panel.series[0].colorVar);
        const invisible = (): uPlot.Series => ({ stroke: 'transparent', width: 1, points: { show: false }, value: () => '' });
        chartData = [xs, hi, lo, dir];
        series = [
          {},
          invisible(),
          invisible(),
          { label: panel.series[0].key, stroke: color, width: 1, paths: () => null, points: { show: true, size: 3, fill: color, stroke: color }, value: (_u, v) => (v == null ? '—' : `${Math.round(v)}°`) },
        ];
        bands = [{ series: [1, 2], fill: color + '24' }];
      } else {
        chartData = [xs, ...panel.series.map((s) => plotted(s.key))];
        series = [
          {},
          ...panel.series.map((s) => {
            const color = cssVar(s.colorVar);
            const base: uPlot.Series = { label: s.key, stroke: color, width: s.width ?? 2, value: (_u, v) => (v == null ? '—' : v.toFixed(1)) };
            if (s.fill) base.fill = color + '22';
            return base;
          }),
        ];
      }

      const yAxis: uPlot.Axis = {
        scale: 'y',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
        size: 48,
        font: '12px IBM Plex Mono, monospace',
      };
      if (panel.ySplits) yAxis.splits = () => panel.ySplits!;
      if (panel.titleKey === 'cc.direction') yAxis.values = (_u, splits) => splits.map((s) => dirLocale(s));

      const xAxis: uPlot.Axis = {
        scale: 'x',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
        font: '12px IBM Plex Mono, monospace',
        show: isLast,
        size: isLast ? 38 : 8,
        values: (_u, splits, _ai, _space, incr) => splits.map((s) => fmtAxisTick(s * 1000, locale, tz, incr)),
      };

      const opts: uPlot.Options = {
        width: host.clientWidth || 800,
        height: panel.points ? 140 : 124,
        scales: {
          x: { time: true, min: xmin, max: xmax },
          y: panel.range ? { range: () => panel.range! } : {},
        },
        axes: [xAxis, yAxis],
        series,
        bands,
        legend: { show: false },
        cursor: { sync: { key: SYNC_KEY }, points: { size: 6 } },
        hooks: {
          setCursor: [(u) => renderCard(u.cursor.idx)],
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

      // empty-state overlay (sea temperature, mostly) — keep the x-axis visible
      if (panel.emptyKey && !hasData) {
        const overlay = document.createElement('div');
        overlay.className = 'chart-empty';
        overlay.style.bottom = isLast ? '38px' : '0';
        overlay.textContent = t(panel.emptyKey);
        wrap.appendChild(overlay);
      }
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
  }, [data, theme, locale, preset, smooth, tz, t]);

  return (
    <section className="charts-section">
      <div className="charts-toolbar">
        <div className="chip-group" role="group" aria-label={t('chart.range')}>
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
        <div className="chip-group smoother" role="group" aria-label={t('chart.smoothing')}>
          <span className="smoother-label">{t('chart.smoothing')}</span>
          {(['raw', 'light', 'strong'] as Smooth[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`chip ${smooth === s ? 'chip--active' : ''}`}
              onClick={() => setSmooth(s)}
            >
              {t(`chart.smooth.${s}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="hover-card" ref={cardRef} aria-live="off">
        <span className="hover-time" />
        <div className="hover-stats" />
      </div>
      <div ref={hostRef} className="charts" />
    </section>
  );
}

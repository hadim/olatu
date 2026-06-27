// Synced multi-panel time-series (uPlot, canvas). One instance per panel, sharing
// the x-axis + crosshair. Theme-aware (re-created when the theme changes).
// v1 feeds from daily means (full history); 30-min detail + direction glyphs come later.
//
// Spec 0003 batch 1: year-aware x-axis ticks, clipped points, always-present temp panel
// with an empty-state overlay, a discreet hover value card, a visible zoom selection,
// a translucent ± spread band on the direction track, and a Raw/Light/Strong smoother.
// Batch 2: a unified time navigator — presets + per-year/month jumps + a custom date
// range + a heat-ribbon overview.

import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '../lib/theme';
import { useI18n, type MessageKey } from '../lib/i18n';
import { compass, fmtNumber, fmtDateTime, fmtAxisTick } from '../lib/format';
import type { Columnar } from '../lib/parquet';
import HeatRibbon from './HeatRibbon';

const SYNC_KEY = 'olatu-ts';
const DAY = 86_400;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const yStart = (y: number) => Date.UTC(y, 0, 1) / 1000;
const yEnd = (y: number) => Date.UTC(y + 1, 0, 1) / 1000 - 1;
const mStart = (y: number, m: number) => Date.UTC(y, m, 1) / 1000;
const mEnd = (y: number, m: number) => Date.UTC(y, m + 1, 1) / 1000 - 1;
const toInput = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const fromInput = (val: string, end: boolean) => {
  const [Y, M, D] = val.split('-').map(Number);
  return Date.UTC(Y, M - 1, D) / 1000 + (end ? DAY - 1 : 0);
};

interface PanelDef {
  titleKey: MessageKey;
  series: { key: string; colorVar: string; width?: number; fill?: boolean }[];
  points?: boolean;
  range?: [number, number];
  ySplits?: number[];
  spreadKey?: string;
  emptyKey?: MessageKey;
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

/** Centred moving average that never crosses a null (a gap break): the window stops
 *  at the first null on each side, so smoothing can't bridge an outage. */
function movingAvg(arr: (number | null)[], radius: number): (number | null)[] {
  if (radius <= 0) return arr;
  const out: (number | null)[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) {
      out[i] = null;
      continue;
    }
    let sum = arr[i] as number;
    let n = 1;
    for (let j = i - 1; j >= Math.max(0, i - radius); j--) {
      if (arr[j] == null) break;
      sum += arr[j] as number;
      n += 1;
    }
    for (let j = i + 1; j <= Math.min(arr.length - 1, i + radius); j++) {
      if (arr[j] == null) break;
      sum += arr[j] as number;
      n += 1;
    }
    out[i] = sum / n;
  }
  return out;
}

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
  const [smooth, setSmooth] = useState<Smooth>('raw');

  const xs = data.t;
  const T0 = xs.length ? xs[0] : 0;
  const TN = xs.length ? xs[xs.length - 1] : 0;

  const [range, setRange] = useState<{ min: number; max: number }>(() => ({
    min: Math.max(T0, TN - 365 * DAY),
    max: TN,
  }));
  const [mode, setMode] = useState<string>('p:1Y');
  const [navYear, setNavYear] = useState<number | null>(null);

  const years = useMemo(() => {
    const a: number[] = [];
    for (let y = new Date(T0 * 1000).getUTCFullYear(); y <= new Date(TN * 1000).getUTCFullYear(); y++) a.push(y);
    return a;
  }, [T0, TN]);

  const monthsWithData = useMemo(() => {
    if (navYear == null) return new Set<number>();
    const s = new Set<number>();
    const hsCol = data.significant_wave_height_m as (number | null)[];
    for (let i = 0; i < xs.length; i++) {
      const d = new Date(xs[i] * 1000);
      if (d.getUTCFullYear() === navYear && hsCol[i] != null) s.add(d.getUTCMonth());
    }
    return s;
  }, [navYear, xs, data]);

  const apply = (min: number, max: number, m: string) => {
    setRange({ min: Math.max(T0, Math.min(min, TN - DAY)), max: Math.min(TN, Math.max(max, T0 + DAY)) });
    setMode(m);
  };

  const dirLocale = (deg: number) => {
    const tok = ['N', 'E', 'S', 'W'][Math.round(deg / 90) % 4];
    return locale === 'en' ? tok : tok === 'W' ? 'O' : tok;
  };

  const monthLabels = useMemo(
    () => Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, m, 1)))),
    [locale],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || xs.length === 0) return;
    host.innerHTML = '';

    const xmin = range.min;
    const xmax = range.max;
    const radius = SMOOTH_RADIUS[smooth];

    // Insert null break-points across real outages so the line never bridges a gap
    // (daily.parquet omits empty days). gxs/gcols are the gap-aware arrays the charts
    // AND the hover card read from — uPlot's cursor idx indexes into these.
    const cadence = (() => {
      let c = Infinity;
      for (let i = 1; i < xs.length; i++) {
        const d = xs[i] - xs[i - 1];
        if (d > 0 && d < c) c = d;
      }
      return Number.isFinite(c) ? c : DAY;
    })();
    const gapThreshold = 4 * cadence;
    const KEYS = Object.keys(data).filter((k) => k !== 't');
    const gxs: number[] = [];
    const gcols: Record<string, (number | null)[]> = {};
    for (const k of KEYS) gcols[k] = [];
    for (let i = 0; i < xs.length; i++) {
      if (i > 0 && xs[i] - xs[i - 1] > gapThreshold) {
        gxs.push(xs[i - 1] + cadence);
        for (const k of KEYS) gcols[k].push(null);
      }
      gxs.push(xs[i]);
      for (const k of KEYS) gcols[k].push((data[k] as (number | null)[])[i]);
    }

    const axisColor = cssVar('--text-3');
    const gridColor = cssVar('--hairline');
    const plots: uPlot[] = [];
    let syncing = false;

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
      if (timeEl) timeEl.textContent = fmtDateTime(gxs[idx] * 1000, locale, tz);
      if (!statsEl) return;
      const chips: string[] = [];
      for (const m of CARD_METRICS) {
        const col = gcols[m.key];
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

      const plotted = (key: string) =>
        panel.points ? gcols[key] : movingAvg(gcols[key], radius);

      let chartData: uPlot.AlignedData;
      let series: uPlot.Series[];
      let bands: uPlot.Band[] | undefined;

      if (panel.spreadKey) {
        const dir = gcols[panel.series[0].key];
        const sp = gcols[panel.spreadKey];
        const hi = dir.map((d, i) => (d == null || sp[i] == null ? null : Math.min(360, d + (sp[i] as number))));
        const lo = dir.map((d, i) => (d == null || sp[i] == null ? null : Math.max(0, d - (sp[i] as number))));
        const color = cssVar(panel.series[0].colorVar);
        const invisible = (): uPlot.Series => ({ stroke: 'transparent', width: 1, points: { show: false }, value: () => '' });
        chartData = [gxs, hi, lo, dir];
        series = [
          {},
          invisible(),
          invisible(),
          { label: panel.series[0].key, stroke: color, width: 1, paths: () => null, points: { show: true, size: 3, fill: color, stroke: color }, value: (_u, v) => (v == null ? '—' : `${Math.round(v)}°`) },
        ];
        bands = [{ series: [1, 2], fill: color + '24' }];
      } else {
        chartData = [gxs, ...panel.series.map((s) => plotted(s.key))];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, theme, locale, range.min, range.max, smooth, tz, t]);

  return (
    <section className="charts-section">
      <div className="charts-toolbar">
        <div className="chip-group" role="group" aria-label={t('chart.range')}>
          {PRESETS.map((p) => {
            const key = `p:${p.key}`;
            return (
              <button
                key={p.key}
                type="button"
                className={`chip ${mode === key ? 'chip--active' : ''}`}
                onClick={() => {
                  setNavYear(null);
                  apply(p.days == null ? T0 : TN - p.days * DAY, TN, key);
                }}
              >
                {p.key}
              </button>
            );
          })}
        </div>
        <div className="chip-group smoother" role="group" aria-label={t('chart.smoothing')}>
          <span className="smoother-label">{t('chart.smoothing')}</span>
          {(['raw', 'light', 'strong'] as Smooth[]).map((s) => (
            <button key={s} type="button" className={`chip ${smooth === s ? 'chip--active' : ''}`} onClick={() => setSmooth(s)}>
              {t(`chart.smooth.${s}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="time-nav">
        <div className="chip-row" role="group" aria-label="Year">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              className={`chip ${navYear === y || mode === `y:${y}` ? 'chip--active' : ''}`}
              onClick={() => {
                setNavYear(y);
                apply(yStart(y), yEnd(y), `y:${y}`);
              }}
            >
              {y}
            </button>
          ))}
        </div>
        <label className="custom-range">
          <input type="date" value={toInput(range.min)} min={toInput(T0)} max={toInput(range.max)} onChange={(e) => e.target.value && apply(fromInput(e.target.value, false), range.max, 'custom')} />
          <span className="range-sep">–</span>
          <input type="date" value={toInput(range.max)} min={toInput(range.min)} max={toInput(TN)} onChange={(e) => e.target.value && apply(range.min, fromInput(e.target.value, true), 'custom')} />
        </label>
      </div>

      {navYear != null && (
        <div className="chip-row months" role="group" aria-label={`${navYear}`}>
          {monthLabels.map((label, m) => (
            <button
              key={m}
              type="button"
              disabled={!monthsWithData.has(m)}
              className={`chip ${mode === `m:${navYear}-${m}` ? 'chip--active' : ''}`}
              onClick={() => apply(mStart(navYear, m), mEnd(navYear, m), `m:${navYear}-${m}`)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <HeatRibbon
        t={xs}
        hs={data.significant_wave_height_m as (number | null)[]}
        min={range.min}
        max={range.max}
        onChange={(min, max) => {
          setNavYear(null);
          apply(min, max, 'ribbon');
        }}
      />

      <div className="hover-card" ref={cardRef} aria-live="off">
        <span className="hover-time" />
        <div className="hover-stats" />
      </div>
      <div ref={hostRef} className="charts" />
    </section>
  );
}

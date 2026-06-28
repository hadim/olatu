// Synced multi-panel time-series (uPlot, canvas). One instance per panel, sharing
// the x-axis + crosshair. Theme-aware (re-created when the theme changes).
// Feeds from tiered files: 30-min detail on narrow windows, hourly/daily means on wider.
//
// Spec 0003 batch 1: year-aware x-axis ticks, clipped points, always-present temp panel
// with an empty-state overlay, a discreet hover value card, a visible zoom selection,
// and a Raw/Light/Strong smoother. Batch 2: a unified time navigator — presets +
// per-year/month jumps + a calendar date-range cherry-picker + a heat-ribbon overview.
// Phase 3: the direction track is a custom cyclical-hue arrow-glyph layer with a
// wrap-aware spread band (drawn straight onto the canvas; see drawDirectionLayer).

import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '../lib/theme';
import { useI18n, type MessageKey } from '../lib/i18n';
import { compass, dirColor, fmtNumber, fmtDateTime, fmtAxisTick } from '../lib/format';
import { loadParquetTier, type Columnar } from '../lib/parquet';
import { iconSvg, type IconName } from './icons';
import HeatRibbon from './HeatRibbon';
import DatePicker from './DatePicker';

const SYNC_KEY = 'olatu-ts';
const DAY = 86_400;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const yStart = (y: number) => Date.UTC(y, 0, 1) / 1000;
const yEnd = (y: number) => Date.UTC(y + 1, 0, 1) / 1000 - 1;
const mStart = (y: number, m: number) => Date.UTC(y, m, 1) / 1000;
const mEnd = (y: number, m: number) => Date.UTC(y, m + 1, 1) / 1000 - 1;
/** Custom direction track drawn straight onto uPlot's canvas: a wrap-aware translucent
 *  spread band (tiled per sample so the 0/360° seam is honest), with density-thinned
 *  arrow glyphs on top — each rotated to the swell's travel direction and coloured by
 *  its cyclical from-direction hue (spec 0001 §7.1, 0002 §4.6). Total pixel control is
 *  the whole point: a degree-line can't render the cyclical wrap or the arrow cue. */
function drawDirectionLayer(u: uPlot, xs: number[], dir: (number | null)[], spread: (number | null)[], dpr: number) {
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();

  const xAt = (i: number) => u.valToPos(xs[i], 'x', true);
  const yAt = (deg: number) => u.valToPos(deg, 'y', true);
  const inX = (px: number) => px >= left - 2 && px <= left + width + 2;

  // Spread band: one tile per sample (midpoint→midpoint), split at the wrap boundary so
  // dir ± spread crossing 0°/360° draws on both edges instead of clamping flat.
  for (let i = 0; i < xs.length; i++) {
    const d = dir[i];
    const sp = spread[i];
    if (d == null || sp == null) continue;
    const px = xAt(i);
    if (!inX(px)) continue;
    const xl = i > 0 && dir[i - 1] != null ? (xAt(i - 1) + px) / 2 : px - dpr;
    const xr = i < xs.length - 1 && dir[i + 1] != null ? (px + xAt(i + 1)) / 2 : px + dpr;
    const half = Math.min(Math.max(sp, 1), 80);
    ctx.fillStyle = dirColor(d) + '24';
    const seg = (lo: number, hi: number) => {
      const yT = yAt(hi);
      ctx.fillRect(xl, yT, Math.max(1, xr - xl), yAt(lo) - yT);
    };
    const lo = d - half;
    const hi = d + half;
    if (lo < 0) {
      seg(0, hi);
      seg(lo + 360, 360);
    } else if (hi > 360) {
      seg(lo, 360);
      seg(0, hi - 360);
    } else {
      seg(lo, hi);
    }
  }

  // Arrow glyphs, thinned to a minimum pixel spacing so they never overlap.
  const minGap = 17 * dpr;
  const s = 4.6 * dpr;
  let lastX = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = dir[i];
    if (d == null) continue;
    const px = xAt(i);
    if (!inX(px) || px - lastX < minGap) continue;
    lastX = px;
    ctx.save();
    ctx.translate(px, yAt(d));
    ctx.rotate(((d + 180) * Math.PI) / 180); // local "up" → the way the swell travels
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.66, s * 0.55);
    ctx.lineTo(s * 0.2, s * 0.55);
    ctx.lineTo(s * 0.2, s);
    ctx.lineTo(-s * 0.2, s);
    ctx.lineTo(-s * 0.2, s * 0.55);
    ctx.lineTo(-s * 0.66, s * 0.55);
    ctx.closePath();
    ctx.fillStyle = dirColor(d);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

interface PanelDef {
  titleKey: MessageKey;
  series: { key: string; colorVar: string; width?: number; fill?: boolean }[];
  glyph?: boolean;
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
  { titleKey: 'cc.period', series: [{ key: 'significant_period_s', colorVar: '--c-period', width: 2 }] },
  {
    titleKey: 'cc.direction',
    series: [{ key: 'peak_direction_deg', colorVar: '--c-dir' }],
    glyph: true,
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
  { key: '1D', days: 1 },
  { key: '2D', days: 2 },
  { key: '5D', days: 5 },
  { key: '10D', days: 10 },
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

const CARD_METRICS: { key: string; labelKey: MessageKey; unit?: string; digits?: number; dir?: boolean; pm?: boolean; icon: IconName; colorVar: string }[] = [
  { key: 'significant_wave_height_m', labelKey: 'cc.waveHeight', unit: 'm', digits: 1, icon: 'waveHeight', colorVar: '--c-height' },
  { key: 'max_wave_height_m', labelKey: 'cc.maxWave', unit: 'm', digits: 1, icon: 'maxWave', colorVar: '--c-max' },
  { key: 'significant_period_s', labelKey: 'cc.period', unit: 's', digits: 1, icon: 'period', colorVar: '--c-period' },
  { key: 'peak_direction_deg', labelKey: 'cc.direction', dir: true, icon: 'direction', colorVar: '--c-dir' },
  { key: 'peak_directional_spread_deg', labelKey: 'cc.spread', unit: '°', digits: 0, pm: true, icon: 'spread', colorVar: '--c-dir' },
  { key: 'sea_temperature_c', labelKey: 'cc.seaTemp', unit: '°C', digits: 1, icon: 'temp', colorVar: '--c-temp' },
];

// Panel title → icon (the wave-height panel carries both Hs and Hmax, so its title
// uses the wave-height glyph). Tinted with the panel's primary series colour.
const PANEL_ICON: Partial<Record<MessageKey, IconName>> = {
  'cc.waveHeight': 'waveHeight',
  'cc.period': 'period',
  'cc.direction': 'direction',
  'cc.seaTemp': 'temp',
};

const DETAIL_COLUMNS = [
  'significant_wave_height_m',
  'max_wave_height_m',
  'significant_period_s',
  'peak_direction_deg',
  'peak_directional_spread_deg',
  'sea_temperature_c',
];
// Tiered resolution by window span: ≤120 d → per-year 30-min files; ≤~2 yr → hourly
// means (one cached file); wider → daily means. Finer detail where it reads, lighter
// loads where it doesn't.
const DETAIL_30MIN = 120 * DAY;
const DETAIL_HOURLY = 800 * DAY;

function mergeColumnar(parts: Columnar[]): Columnar {
  const out: Columnar = { t: [] };
  for (const c of DETAIL_COLUMNS) out[c] = [];
  for (const p of parts) {
    for (let i = 0; i < p.t.length; i++) out.t.push(p.t[i]);
    for (const c of DETAIL_COLUMNS) {
      const a = (p[c] as (number | null)[]) ?? [];
      for (let i = 0; i < p.t.length; i++) out[c].push(a[i] ?? null);
    }
  }
  return out;
}

export default function TimeSeries({ campaign, data, tz, yearFiles, lastT }: { campaign: string; data: Columnar; tz: string; yearFiles: Record<number, string>; lastT?: number }) {
  const { theme } = useTheme();
  const { locale, t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [smooth, setSmooth] = useState<Smooth>('raw');

  const xs = data.t;
  const T0 = xs.length ? xs[0] : 0;
  // `data` is the daily tier — its last point is today's *daily bucket* (~00:00 UTC),
  // not the freshest 30-min reading. Bound the chart by the real latest timestamp
  // (manifest span end, same value the banner uses) so short windows reach "now".
  const TN = Math.max(xs.length ? xs[xs.length - 1] : 0, lastT ?? 0);

  const [range, setRange] = useState<{ min: number; max: number }>(() => ({
    min: Math.max(T0, TN - 1 * DAY),
    max: TN,
  }));
  const [mode, setMode] = useState<string>('p:1D');
  const [navYear, setNavYear] = useState<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [detail, setDetail] = useState<Columnar | null>(null);
  const detailCache = useRef<Map<number, Columnar>>(new Map());
  const hourlyCache = useRef<Columnar | null>(null);

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

  // Daily wave height keyed by UTC day-index — lets the calendar mark which days carry
  // data and flag the big-swell ones (it reads the same daily tier the charts plot).
  const dayHs = useMemo(() => {
    const m = new Map<number, number>();
    const hsCol = data.significant_wave_height_m as (number | null)[];
    for (let i = 0; i < xs.length; i++) {
      if (hsCol[i] != null) m.set(Math.floor(xs[i] / DAY), hsCol[i] as number);
    }
    return m;
  }, [xs, data]);

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

  // Tiered detail: narrow windows plot the per-year 30-min files; mid windows plot
  // hourly means (one cached file); wide windows fall back to the daily means passed
  // in. Loaded tiers are cached in memory.
  useEffect(() => {
    const span = range.max - range.min;
    let cancelled = false;
    (async () => {
      try {
        if (span <= DETAIL_30MIN) {
          const needed: number[] = [];
          for (let y = new Date(range.min * 1000).getUTCFullYear(); y <= new Date(range.max * 1000).getUTCFullYear(); y++) {
            if (yearFiles[y]) needed.push(y);
          }
          if (needed.length === 0) {
            if (!cancelled) setDetail(null);
            return;
          }
          const parts: Columnar[] = [];
          for (const y of needed) {
            let c = detailCache.current.get(y);
            if (!c) {
              c = await loadParquetTier(campaign, yearFiles[y], DETAIL_COLUMNS);
              detailCache.current.set(y, c);
            }
            parts.push(c);
          }
          if (!cancelled) setDetail(mergeColumnar(parts));
        } else if (span <= DETAIL_HOURLY) {
          if (!hourlyCache.current) hourlyCache.current = await loadParquetTier(campaign, 'hourly.parquet', DETAIL_COLUMNS);
          if (!cancelled) setDetail(hourlyCache.current);
        } else {
          if (!cancelled) setDetail(null);
        }
      } catch (e) {
        console.error('Failed to load detail tier:', e);
        if (!cancelled) setDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign, range.min, range.max, yearFiles]);

  useEffect(() => {
    const host = hostRef.current;
    const src = detail ?? data;
    const sxs = src.t;
    if (!host || sxs.length === 0) return;
    host.innerHTML = '';

    const xmin = range.min;
    const xmax = range.max;
    const radius = SMOOTH_RADIUS[smooth];
    // Breathing room so the first/last points (and y-extremes) aren't half-clipped at
    // the plot edges — uPlot clips series to the plot rect, so this lives in the SCALE,
    // not the outer padding. x-pad is identical on every panel, so x stays aligned.
    const xpad = Math.max((xmax - xmin) * 0.04, 1);
    const padY = (lo: number, hi: number, f: number): [number, number] => {
      const d = hi - lo || 1;
      return [lo - d * f, hi + d * f];
    };

    // Insert null break-points across real outages so the line never bridges a gap
    // (daily.parquet omits empty days). gxs/gcols are the gap-aware arrays the charts
    // AND the hover card read from — uPlot's cursor idx indexes into these.
    const cadence = (() => {
      let c = Infinity;
      for (let i = 1; i < sxs.length; i++) {
        const d = sxs[i] - sxs[i - 1];
        if (d > 0 && d < c) c = d;
      }
      return Number.isFinite(c) ? c : DAY;
    })();
    const gapThreshold = 4 * cadence;
    const KEYS = Object.keys(src).filter((k) => k !== 't');
    const gxs: number[] = [];
    const gcols: Record<string, (number | null)[]> = {};
    for (const k of KEYS) gcols[k] = [];
    for (let i = 0; i < sxs.length; i++) {
      if (i > 0 && sxs[i] - sxs[i - 1] > gapThreshold) {
        gxs.push(sxs[i - 1] + cadence);
        for (const k of KEYS) gcols[k].push(null);
      }
      gxs.push(sxs[i]);
      for (const k of KEYS) gcols[k].push((src[k] as (number | null)[])[i]);
    }

    const axisColor = cssVar('--text-3');
    const gridColor = cssVar('--hairline');
    const DPR = window.devicePixelRatio || 1; // uPlot draws in device px; glyphs match
    const plots: uPlot[] = [];
    let syncing = false;

    const timeEl = cardRef.current?.querySelector<HTMLElement>('.hover-time') ?? null;
    const statsEl = cardRef.current?.querySelector<HTMLElement>('.hover-stats') ?? null;
    const chipsHTML = (idx: number) => {
      const chips: string[] = [];
      for (const m of CARD_METRICS) {
        const v = gcols[m.key]?.[idx];
        if (v == null) continue;
        const val = m.dir
          ? `${compass(v, locale)} · ${Math.round(v)}°`
          : `${m.pm ? '±' : ''}${fmtNumber(v, locale, m.digits ?? 1)}${m.unit ? ` ${m.unit}` : ''}`;
        const icon = iconSvg(m.icon, { className: 'hover-chip-icon', color: `var(${m.colorVar})` });
        chips.push(`<span class="hover-chip">${icon}<span class="hover-chip-label">${t(m.labelKey)}</span><span class="hover-chip-value">${val}</span></span>`);
      }
      return chips.join('');
    };
    // Index of the most recent sample that has any data — the card's default content.
    const lastIdx = (() => {
      for (let i = gxs.length - 1; i >= 0; i--) {
        if (CARD_METRICS.some((m) => gcols[m.key]?.[i] != null)) return i;
      }
      return -1;
    })();
    // Default (no hover): keep the "hover to read" hint in the time slot, but ALWAYS
    // render the latest values so the card is at its full height from the start — no
    // layout jump when you hover (height is width-robust, not a guessed min-height).
    const resetCard = () => {
      if (timeEl) timeEl.textContent = t('chart.hoverHint');
      if (statsEl) statsEl.innerHTML = lastIdx >= 0 ? chipsHTML(lastIdx) : '';
    };
    const renderCard = (idx: number | null | undefined) => {
      if (idx == null) {
        resetCard();
        return;
      }
      if (timeEl) timeEl.textContent = fmtDateTime(gxs[idx] * 1000, locale, tz);
      if (statsEl) statsEl.innerHTML = chipsHTML(idx);
    };
    resetCard();

    PANELS.forEach((panel, idx) => {
      const isLast = idx === PANELS.length - 1;
      const wrap = document.createElement('div');
      wrap.className = 'chart-panel';
      const heading = document.createElement('div');
      heading.className = 'chart-panel-title';
      const panelIcon = PANEL_ICON[panel.titleKey];
      const titleIcon = panelIcon ? iconSvg(panelIcon, { className: 'label-icon', color: `var(${panel.series[0].colorVar})` }) : '';
      heading.innerHTML = `${titleIcon}<span>${t(panel.titleKey)}</span>`;
      host.appendChild(heading);
      host.appendChild(wrap);

      const inWindow = (key: string) => {
        const col = src[key] as (number | null)[];
        let n = 0;
        for (let i = 0; i < sxs.length; i++) {
          if (sxs[i] >= xmin && sxs[i] <= xmax && col[i] != null) n += 1;
          if (n >= 2) return true;
        }
        return false;
      };
      const hasData = panel.series.some((s) => inWindow(s.key));

      const plotted = (key: string) => movingAvg(gcols[key], radius);

      let chartData: uPlot.AlignedData;
      let series: uPlot.Series[];

      if (panel.glyph) {
        // Direction: an invisible data series feeds uPlot's scale + cursor index; the
        // visible band + arrow glyphs are painted in the draw hook (drawDirectionLayer).
        chartData = [gxs, gcols[panel.series[0].key]];
        series = [
          {},
          { label: panel.series[0].key, stroke: 'transparent', width: 0, points: { show: false }, paths: () => null, value: (_u, v) => (v == null ? '—' : `${Math.round(v)}°`) },
        ];
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

      const hooks: uPlot.Hooks.Arrays = {
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
      };
      if (panel.glyph) {
        const dirArr = gcols[panel.series[0].key];
        const spreadArr = gcols[panel.spreadKey!];
        hooks.draw = [(u) => drawDirectionLayer(u, gxs, dirArr, spreadArr, DPR)];
      }

      const opts: uPlot.Options = {
        width: host.clientWidth || 800,
        height: panel.glyph ? 140 : 124,
        // Fixed right padding on EVERY panel. Only the last panel shows x-axis labels,
        // and uPlot would otherwise auto-reserve right-edge space for its last tick
        // label on that panel alone — making it narrower than the others, so the same
        // timestamp lands at a different x and the curves look ~1 h misaligned.
        padding: [8, 12, 0, 0],
        scales: {
          x: { time: true, min: xmin - xpad, max: xmax + xpad },
          y: panel.range
            ? { range: () => padY(panel.range![0], panel.range![1], 0.08) }
            : { range: (_u, dMin, dMax) => padY(dMin, dMax, 0.12) },
        },
        // Place ticks on the buoy's timezone boundaries for every visitor (not the
        // browser's), so axis labels stay round regardless of where you open the app.
        tzDate: (ts: number) => uPlot.tzDate(new Date(ts * 1000), tz),
        axes: [xAxis, yAxis],
        series,
        legend: { show: false },
        cursor: { sync: { key: SYNC_KEY }, points: { size: 6 } },
        hooks,
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
  }, [data, detail, theme, locale, range.min, range.max, smooth, tz, t]);

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
          <button
            type="button"
            className={`chip jump-toggle ${showJump ? 'chip--active' : ''}`}
            aria-expanded={showJump}
            onClick={() => setShowJump((v) => !v)}
          >
            {t('chart.jumpTo')} {showJump ? '▾' : '▸'}
          </button>
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

      {showJump && (
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
        <DatePicker
          min={range.min}
          max={range.max}
          t0={T0}
          tn={TN}
          dayHs={dayHs}
          onChange={(mn, mx) => {
            setNavYear(null);
            apply(mn, mx, 'custom');
          }}
        />
      </div>
      )}

      {showJump && navYear != null && (
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
        <span className="hover-tz" title={t('time.buoyLocal')}>{tz}</span>
      </div>
      <div ref={hostRef} className="charts" />
    </section>
  );
}

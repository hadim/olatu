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
//
// Spec 0006 (Phase 7): an accessible per-window data summary (visually-hidden <table>)
// makes the canvases readable to assistive tech, and a touch pinch/drag plugin zooms &
// pans on phones with a Reset affordance.

import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '../lib/theme';
import { useLocale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';
import { compass, dirColor, fmtNumber, fmtDateTime, fmtAxisTick } from '../lib/format';
import { loadParquetTier, type Columnar } from '../lib/parquet';
import { iconSvg, type IconName } from './icons';
import { touchZoomPlugin } from '../lib/uplotTouch';
import HeatRibbon from './HeatRibbon';
import DatePicker from './DatePicker';

const SYNC_KEY = 'olatu-ts';
const DAY = 86_400;

const CHIP_BASE =
  'inline-flex shrink-0 items-center justify-center font-mono text-[0.78rem] rounded-[0.5rem] border px-[0.7rem] py-[0.32rem] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35 disabled:cursor-default disabled:pointer-events-none max-md:min-h-11';
const chipCls = (active: boolean) =>
  cn(CHIP_BASE, active ? 'border-accent bg-accent text-bg' : 'border-line bg-surface text-muted hover:border-accent hover:text-fg');

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const yStart = (y: number) => Date.UTC(y, 0, 1) / 1000;
const yEnd = (y: number) => Date.UTC(y + 1, 0, 1) / 1000 - 1;
const mStart = (y: number, mo: number) => Date.UTC(y, mo, 1) / 1000;
const mEnd = (y: number, mo: number) => Date.UTC(y, mo + 1, 1) / 1000 - 1;
/** Direction arrow glyphs drawn straight onto uPlot's canvas: density-thinned so they
 *  never overlap, each rotated to the swell's travel direction and coloured by its
 *  cyclical from-direction hue (spec 0001 §7.1, 0002 §4.6). Direction is CYCLICAL
 *  (0°≡360°), so it isn't projected onto a linear y-axis (which would print N twice and
 *  make a swell near north leap top↔bottom). Instead every arrow sits on ONE centred
 *  row — rotation + colour carry the direction, both inherently wrap-correct. */
function drawArrowGlyphs(u: uPlot, xs: number[], dir: (number | null)[], dpr: number) {
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();

  const xAt = (i: number) => u.valToPos(xs[i], 'x', true);
  const yc = top + height / 2; // single centred row — no linear direction axis
  const inX = (px: number) => px >= left - 2 && px <= left + width + 2;

  // Arrow glyphs, thinned to a minimum pixel spacing so they never overlap. These are
  // the hero of the panel, so they're drawn large; minGap scales with size to match.
  const minGap = 26 * dpr;
  const s = 7.5 * dpr;
  let lastX = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = dir[i];
    if (d == null) continue;
    const px = xAt(i);
    if (!inX(px) || px - lastX < minGap) continue;
    lastX = px;
    ctx.save();
    ctx.translate(px, yc);
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

/** UTC epochs (seconds) of every buoy-local midnight in [xmin, xmax]. Recomputed from
 *  calendar parts per day so DST transitions (a 23/25 h civil day) don't drift the
 *  boundary by an hour. Only meaningful on narrow windows; callers guard the span. */
function dayBoundaries(xmin: number, xmax: number, tz: string): number[] {
  const parts = (ts: number) => {
    const o: Record<string, number> = {};
    for (const x of new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(ts * 1000))) {
      if (x.type !== 'literal') o[x.type] = +x.value;
    }
    return o;
  };
  // Local midnight of a Y/M/D, as a UTC epoch: guess UTC-midnight, then subtract the
  // tz offset measured at that instant.
  const midnightUTC = (y: number, mo: number, da: number) => {
    const guess = Date.UTC(y, mo - 1, da) / 1000;
    const q = parts(guess);
    const asUTC = Date.UTC(q.year, q.month - 1, q.day, q.hour % 24, q.minute, q.second) / 1000;
    return guess - (asUTC - guess);
  };
  const out: number[] = [];
  const p0 = parts(xmin);
  const cal = new Date(Date.UTC(p0.year, p0.month - 1, p0.day));
  for (let i = 0; i < 400; i++) {
    const m = midnightUTC(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate());
    if (m > xmax) break;
    if (m >= xmin) out.push(m);
    cal.setUTCDate(cal.getUTCDate() + 1);
  }
  return out;
}

// Beyond this span, per-day separators are visual noise, so they're skipped.
const DAY_SEP_MAX = 45 * DAY;

interface PanelDef {
  titleKey: MessageKey;
  series: { key: string; colorVar: string; width?: number; fill?: boolean }[];
  glyph?: boolean; // direction: single centred arrow row, no linear y-axis
  zeroBased?: boolean; // y-axis anchored at 0 (spread magnitude)
  glued?: boolean; // no top gap — sits flush under the panel above
  emptyKey?: MessageKey;
}

const PANELS: PanelDef[] = [
  {
    titleKey: 'cc_wave_height',
    series: [
      { key: 'significant_wave_height_m', colorVar: '--c-height', width: 2, fill: true },
      { key: 'max_wave_height_m', colorVar: '--c-max', width: 1 },
    ],
  },
  { titleKey: 'cc_period', series: [{ key: 'significant_period_s', colorVar: '--c-period', width: 2 }] },
  {
    // Direction: a single row of colour+rotation arrows (see drawArrowGlyphs) — no y-axis.
    titleKey: 'cc_direction',
    series: [{ key: 'peak_direction_deg', colorVar: '--c-dir' }],
    glyph: true,
  },
  {
    // Étalement (spread): its own honest 0-based line, glued flush under the arrow row.
    titleKey: 'cc_spread',
    series: [{ key: 'peak_directional_spread_deg', colorVar: '--c-dir', width: 1.5 }],
    zeroBased: true,
    glued: true,
  },
  {
    titleKey: 'cc_sea_temp',
    series: [{ key: 'sea_temperature_c', colorVar: '--c-temp', width: 2, fill: true }],
    emptyKey: 'chart_temp_unavailable',
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

// The chosen range preset is remembered across sessions (spec 0006 UX polish). Default
// is 5D — a week-ish of context reads better than a single day on first open.
const RANGE_STORE = 'olatu.range';
const DEFAULT_PRESET = '5D';
function storedPreset(): string {
  try {
    const v = localStorage.getItem(RANGE_STORE);
    if (v && PRESETS.some((p) => p.key === v)) return v;
  } catch {
    /* storage unavailable (private mode) — fall back to the default */
  }
  return DEFAULT_PRESET;
}
function presetRange(key: string, t0: number, tn: number): { min: number; max: number } {
  const days = PRESETS.find((p) => p.key === key)?.days ?? 5;
  return { min: days == null ? t0 : Math.max(t0, tn - days * DAY), max: tn };
}

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
  { key: 'significant_wave_height_m', labelKey: 'cc_wave_height', unit: 'm', digits: 1, icon: 'waveHeight', colorVar: '--c-height' },
  { key: 'max_wave_height_m', labelKey: 'cc_max_wave', unit: 'm', digits: 1, icon: 'maxWave', colorVar: '--c-max' },
  { key: 'significant_period_s', labelKey: 'cc_period', unit: 's', digits: 1, icon: 'period', colorVar: '--c-period' },
  { key: 'peak_direction_deg', labelKey: 'cc_direction', dir: true, icon: 'direction', colorVar: '--c-dir' },
  { key: 'peak_directional_spread_deg', labelKey: 'cc_spread', unit: '°', digits: 0, pm: true, icon: 'spread', colorVar: '--c-dir' },
  { key: 'sea_temperature_c', labelKey: 'cc_sea_temp', unit: '°C', digits: 1, icon: 'temp', colorVar: '--c-temp' },
];

// Panel title → icon (the wave-height panel carries both Hs and Hmax, so its title
// uses the wave-height glyph). Tinted with the panel's primary series colour.
const PANEL_ICON: Partial<Record<MessageKey, IconName>> = {
  cc_wave_height: 'waveHeight',
  cc_period: 'period',
  cc_direction: 'direction',
  cc_spread: 'spread',
  cc_sea_temp: 'temp',
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
  const { locale } = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Live uPlot instances + their base x-scale, so the Reset control can undo a transient
  // touch/drag zoom without re-loading the window (spec 0006 §6).
  const plotsRef = useRef<uPlot[]>([]);
  const baseScaleRef = useRef<{ min: number; max: number } | null>(null);
  const [smooth, setSmooth] = useState<Smooth>('raw');

  const resetZoom = () => {
    const base = baseScaleRef.current;
    if (!base) return;
    for (const p of plotsRef.current) p.setScale('x', base);
  };

  const xs = data.t;
  const T0 = xs.length ? xs[0] : 0;
  // `data` is the daily tier — its last point is today's *daily bucket* (~00:00 UTC),
  // not the freshest 30-min reading. Bound the chart by the real latest timestamp
  // (manifest span end, same value the banner uses) so short windows reach "now".
  const TN = Math.max(xs.length ? xs[xs.length - 1] : 0, lastT ?? 0);

  const [mode, setMode] = useState<string>(() => `p:${storedPreset()}`);
  const [range, setRange] = useState<{ min: number; max: number }>(() => presetRange(mode.slice(2), T0, TN));
  const [navYear, setNavYear] = useState<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [detail, setDetail] = useState<Columnar | null>(null);
  // True while a finer tier (30-min year files / hourly means) is being fetched for the
  // current window — drives a spinner so narrow windows don't read as empty plots while
  // the daily fallback (too coarse to show much at a few days' zoom) is all that's loaded.
  const [detailLoading, setDetailLoading] = useState(false);
  // Accessible per-window summary rows (latest + min/max/range per metric).
  const [summary, setSummary] = useState<{ label: string; latest: string; lo: string; hi: string }[]>([]);
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
    const map = new Map<number, number>();
    const hsCol = data.significant_wave_height_m as (number | null)[];
    for (let i = 0; i < xs.length; i++) {
      if (hsCol[i] != null) map.set(Math.floor(xs[i] / DAY), hsCol[i] as number);
    }
    return map;
  }, [xs, data]);

  const apply = (min: number, max: number, mo: string) => {
    setRange({ min: Math.max(T0, Math.min(min, TN - DAY)), max: Math.min(TN, Math.max(max, T0 + DAY)) });
    setMode(mo);
  };

  const dirLocale = (deg: number) => {
    const tok = ['N', 'E', 'S', 'W'][Math.round(deg / 90) % 4];
    return locale === 'en' ? tok : tok === 'W' ? 'O' : tok;
  };

  const monthLabels = useMemo(
    () => Array.from({ length: 12 }, (_, mo) => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, mo, 1)))),
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
            if (!cancelled) {
              setDetail(null);
              setDetailLoading(false);
            }
            return;
          }
          // Spin only if something actually has to be fetched (cached tiers are instant).
          if (!cancelled && !needed.every((y) => detailCache.current.has(y))) setDetailLoading(true);
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
          if (!hourlyCache.current) {
            if (!cancelled) setDetailLoading(true);
            hourlyCache.current = await loadParquetTier(campaign, 'hourly.parquet', DETAIL_COLUMNS);
          }
          if (!cancelled) setDetail(hourlyCache.current);
        } else {
          if (!cancelled) setDetail(null);
        }
      } catch (e) {
        console.error('Failed to load detail tier:', e);
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
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

    // Day separators live on ONE overlay spanning the whole stack (behind the panels, via
    // z-order) so a day break reads as a single continuous line through every plot and the
    // gaps between them — a per-canvas line would break at each heading/margin. Inset to
    // match the host padding so overlay-x lines up with each canvas's valToPos.
    const dayOverlay = document.createElement('div');
    dayOverlay.className = 'pointer-events-none absolute left-4 right-4 top-3 bottom-4 z-0';
    dayOverlay.setAttribute('aria-hidden', 'true');
    host.appendChild(dayOverlay);
    const dpr = window.devicePixelRatio || 1;
    const renderDayOverlay = (u0: uPlot) => {
      dayOverlay.replaceChildren();
      const mn = u0.scales.x.min;
      const mx = u0.scales.x.max;
      if (mn == null || mx == null || mx - mn > DAY_SEP_MAX) return;
      for (const b of dayBoundaries(mn, mx, tz)) {
        // canvasPixels=true → position from the canvas left (incl. the y-axis gutter),
        // matching the overlay's left edge; /dpr converts device px back to CSS px.
        const line = document.createElement('div');
        line.style.cssText = `position:absolute;top:0;bottom:0;left:${u0.valToPos(b, 'x', true) / dpr}px;border-left:1px dashed var(--divider);`;
        dayOverlay.appendChild(line);
      }
    };

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
      for (const cm of CARD_METRICS) {
        const v = gcols[cm.key]?.[idx];
        if (v == null) continue;
        const val = cm.dir
          ? `${compass(v, locale)} · ${Math.round(v)}°`
          : `${cm.pm ? '±' : ''}${fmtNumber(v, locale, cm.digits ?? 1)}${cm.unit ? ` ${cm.unit}` : ''}`;
        const icon = iconSvg(cm.icon, { className: 'shrink-0', color: `var(${cm.colorVar})` });
        chips.push(
          `<span class="inline-flex items-center gap-[0.35rem]">${icon}<span class="text-[0.68rem] uppercase tracking-[0.05em] text-faint">${m[cm.labelKey]()}</span><span class="font-mono text-[0.84rem] text-muted">${val}</span></span>`,
        );
      }
      return chips.join('');
    };
    // Index of the most recent sample that has any data — the card's default content.
    const lastIdx = (() => {
      for (let i = gxs.length - 1; i >= 0; i--) {
        if (CARD_METRICS.some((cm) => gcols[cm.key]?.[i] != null)) return i;
      }
      return -1;
    })();
    // Default (no hover): keep the "hover to read" hint in the time slot, but ALWAYS
    // render the latest values so the card is at its full height from the start — no
    // layout jump when you hover (height is width-robust, not a guessed min-height).
    const resetCard = () => {
      if (timeEl) timeEl.textContent = m.chart_hover_hint();
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

    // Accessible summary: latest + window min/max/range per metric (spec 0006 §6).
    const summaryRows = CARD_METRICS.map((cm) => {
      let lo = Infinity;
      let hi = -Infinity;
      let latest: number | null = null;
      for (let i = 0; i < sxs.length; i++) {
        if (sxs[i] < xmin || sxs[i] > xmax) continue;
        const v = (src[cm.key] as (number | null)[])[i];
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        latest = v;
      }
      const fmt = (v: number) => (cm.dir ? `${compass(v, locale)} · ${Math.round(v)}°` : `${cm.pm ? '±' : ''}${fmtNumber(v, locale, cm.digits ?? 1)}${cm.unit ? ` ${cm.unit}` : ''}`);
      return {
        label: m[cm.labelKey](),
        latest: latest == null ? '—' : fmt(latest),
        lo: Number.isFinite(lo) ? fmt(lo) : '—',
        hi: Number.isFinite(hi) ? fmt(hi) : '—',
      };
    });
    setSummary(summaryRows);

    PANELS.forEach((panel, idx) => {
      const isLast = idx === PANELS.length - 1;
      const wrap = document.createElement('div');
      // z-10 keeps the panels (and headings) above the day-separator overlay (z-0).
      wrap.className = 'relative z-10 w-full overflow-hidden';
      const heading = document.createElement('div');
      // Glued panels (spread under direction) get no top gap so the pair reads as one block.
      heading.className = `${panel.glued ? 'mt-0' : 'mt-[0.6rem]'} mb-[0.1rem] ml-[0.2rem] relative z-10 flex w-full items-center text-[0.74rem] uppercase tracking-[0.07em] text-faint`;
      const panelIcon = PANEL_ICON[panel.titleKey];
      const titleIcon = panelIcon ? iconSvg(panelIcon, { className: 'mr-1.5 shrink-0', color: `var(${panel.series[0].colorVar})` }) : '';
      // Direction panel carries an inline colour legend (N/E/S/O) so the cyclical
      // from-direction hue is self-explanatory without opening the glossary.
      const legendHTML =
        panel.titleKey === 'cc_direction'
          ? '<span class="ml-auto flex items-center gap-[0.55rem] text-[0.66rem]">' +
            [0, 90, 180, 270]
              .map(
                (d) =>
                  `<span class="inline-flex items-center gap-[0.25rem]"><span class="inline-block h-[0.5rem] w-[0.5rem] rounded-full" style="background:${dirColor(d)}"></span>${dirLocale(d)}</span>`,
              )
              .join('') +
            '</span>'
          : '';
      heading.innerHTML = `${titleIcon}<span>${m[panel.titleKey]()}</span>${legendHTML}`;
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
      const hasData = panel.series.some((srs) => inWindow(srs.key));

      const plotted = (key: string) => movingAvg(gcols[key], radius);

      let chartData: uPlot.AlignedData;
      let series: uPlot.Series[];

      if (panel.glyph) {
        // Direction: no linear y-axis (it's cyclical). A constant series (0.5 on a [0,1]
        // scale) feeds uPlot's cursor index and pins the crosshair dot to the centred
        // row; the arrows themselves are painted in the draw hook. Rotation + colour carry
        // the direction, so the row needs no y-scale of its own.
        const dirArr = gcols[panel.series[0].key];
        chartData = [gxs, dirArr.map((v) => (v == null ? null : 0.5))];
        series = [
          {},
          { label: panel.series[0].key, stroke: 'transparent', width: 0, points: { show: false }, paths: () => null, value: (_u, _v, _si, di) => (di == null || dirArr[di] == null ? '—' : `${Math.round(dirArr[di]!)}°`) },
        ];
      } else {
        chartData = [gxs, ...panel.series.map((srs) => plotted(srs.key))];
        series = [
          {},
          ...panel.series.map((srs) => {
            const color = cssVar(srs.colorVar);
            const base: uPlot.Series = { label: srs.key, stroke: color, width: srs.width ?? 2, value: (_u, v) => (v == null ? '—' : v.toFixed(1)) };
            if (srs.fill) base.fill = color + '22';
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
      if (panel.glyph) {
        // Arrow row: reserve the same left gutter (keeps x aligned with the other panels)
        // but print no axis — direction is cyclical, there's nothing linear to label.
        yAxis.splits = () => [];
        yAxis.values = () => [];
        yAxis.grid = { show: false };
        yAxis.ticks = { show: false };
      }

      const xAxis: uPlot.Axis = {
        scale: 'x',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
        font: '12px IBM Plex Mono, monospace',
        show: isLast,
        size: isLast ? 38 : 8,
        values: (_u, splits, _ai, _space, incr) => splits.map((sp) => fmtAxisTick(sp * 1000, locale, tz, incr)),
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
            renderDayOverlay(u); // reposition the day lines on zoom/pan
          },
        ],
      };
      if (panel.glyph) {
        const dirArr = gcols[panel.series[0].key];
        hooks.draw = [(u) => drawArrowGlyphs(u, gxs, dirArr, DPR)];
      }

      const opts: uPlot.Options = {
        width: host.clientWidth || 800,
        // Arrow row is a single thin band; the glued spread line is short too.
        height: panel.glyph ? 56 : panel.glued ? 70 : 124,
        // Fixed right padding on EVERY panel. Only the last panel shows x-axis labels,
        // and uPlot would otherwise auto-reserve right-edge space for its last tick
        // label on that panel alone — making it narrower than the others, so the same
        // timestamp lands at a different x and the curves look ~1 h misaligned.
        padding: [8, 12, 0, 0],
        scales: {
          x: { time: true, min: xmin - xpad, max: xmax + xpad },
          y: panel.glyph
            ? { range: (): [number, number] => [0, 1] } // arrows sit at 0.5 (centre); axis unused
            : panel.zeroBased
              ? { range: (_u: uPlot, _dMin: number, dMax: number): [number, number] => [0, Math.max(dMax || 0, 1) * 1.12] }
              : { range: (_u, dMin, dMax) => padY(dMin, dMax, 0.12) },
        },
        // Place ticks on the buoy's timezone boundaries for every visitor (not the
        // browser's), so axis labels stay round regardless of where you open the app.
        tzDate: (ts: number) => uPlot.tzDate(new Date(ts * 1000), tz),
        axes: [xAxis, yAxis],
        series,
        legend: { show: false },
        cursor: {
          sync: { key: SYNC_KEY },
          points: { size: 6 },
          // Double-click resets to the active preset window (baseScaleRef), not uPlot's
          // default full-data autoscale — same behaviour as the ⟲ Reset control.
          bind: {
            dblclick: () => () => {
              resetZoom();
              return null;
            },
          },
        },
        plugins: [touchZoomPlugin()],
        hooks,
      };

      const u = new uPlot(opts, chartData, wrap);
      // Decorative to assistive tech — the accessible truth is the summary table below.
      u.root.setAttribute('role', 'img');
      u.root.setAttribute('aria-label', m[panel.titleKey]());
      plots.push(u);

      if (panel.emptyKey && !hasData) {
        const overlay = document.createElement('div');
        overlay.className = 'chart-empty';
        overlay.style.bottom = isLast ? '38px' : '0';
        overlay.textContent = m[panel.emptyKey]();
        wrap.appendChild(overlay);
      }
    });

    plotsRef.current = plots;
    baseScaleRef.current = { min: xmin - xpad, max: xmax + xpad };
    if (plots[0]) renderDayOverlay(plots[0]);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      for (const p of plots) p.setSize({ width: w, height: p.height });
      if (plots[0]) renderDayOverlay(plots[0]); // widths changed → recompute line x
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      for (const p of plots) p.destroy();
      plotsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, detail, theme, locale, range.min, range.max, smooth, tz]);

  return (
    <section className="mt-6">
      <div className="mb-[0.8rem] flex flex-wrap items-center justify-between gap-x-4 gap-y-[0.6rem]">
        <div className="flex flex-wrap items-center gap-[0.4rem]" role="group" aria-label={m.chart_range()}>
          {PRESETS.map((p) => {
            const key = `p:${p.key}`;
            return (
              <button
                key={p.key}
                type="button"
                className={chipCls(mode === key)}
                onClick={() => {
                  setNavYear(null);
                  try {
                    localStorage.setItem(RANGE_STORE, p.key);
                  } catch {
                    /* storage unavailable — the preset still applies for this session */
                  }
                  apply(p.days == null ? T0 : TN - p.days * DAY, TN, key);
                }}
              >
                {p.key}
              </button>
            );
          })}
          <button type="button" className={chipCls(showJump)} aria-expanded={showJump} onClick={() => setShowJump((v) => !v)}>
            {m.chart_jump_to()} {showJump ? '▾' : '▸'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-[0.4rem]" role="group" aria-label={m.chart_smoothing()}>
          <span className="mr-[0.15rem] text-[0.72rem] uppercase tracking-[0.06em] text-faint">{m.chart_smoothing()}</span>
          {(['raw', 'light', 'strong'] as Smooth[]).map((s) => (
            <button key={s} type="button" className={chipCls(smooth === s)} onClick={() => setSmooth(s)}>
              {m[`chart_smooth_${s}` as MessageKey]()}
            </button>
          ))}
          <button type="button" className={cn(chipCls(false), 'px-[0.5rem]')} onClick={resetZoom} aria-label={m.chart_reset()} title={m.chart_reset()}>
            ⟲
          </button>
        </div>
      </div>

      {showJump && (
        <div className="mb-[0.7rem] flex flex-wrap items-center justify-between gap-x-4 gap-y-[0.6rem]">
          <div className="flex gap-[0.4rem] overflow-x-auto pb-0.5 [scrollbar-width:thin]" role="group" aria-label="Year">
            {years.map((y) => (
              <button
                key={y}
                type="button"
                className={chipCls(navYear === y || mode === `y:${y}`)}
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
        <div className="mb-[0.8rem] flex gap-[0.4rem] overflow-x-auto pb-0.5 [scrollbar-width:thin]" role="group" aria-label={`${navYear}`}>
          {monthLabels.map((label, mo) => (
            <button key={mo} type="button" disabled={!monthsWithData.has(mo)} className={chipCls(mode === `m:${navYear}-${mo}`)} onClick={() => apply(mStart(navYear, mo), mEnd(navYear, mo), `m:${navYear}-${mo}`)}>
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

      {/* Fixed-column readout grid: 1fr tracks keep every chip in a stable slot so a
          value changing width (1,3 → 10,3 m) can't reflow the row and make it flicker. */}
      <div className="hover-card mb-[0.7rem] flex flex-col gap-[0.4rem] rounded-[0.7rem] border border-line bg-surface px-[0.85rem] py-[0.5rem]" ref={cardRef} aria-hidden="true">
        <div className="flex items-baseline justify-between gap-x-4">
          <span className="hover-time font-mono text-[0.82rem] text-fg" />
          <span className="shrink-0 cursor-help whitespace-nowrap font-mono text-[0.7rem] text-faint" title={m.time_buoy_local()}>
            ◷ {tz}
          </span>
        </div>
        <div className="hover-stats grid grid-cols-3 gap-x-4 gap-y-[0.35rem] max-[560px]:grid-cols-2 max-[380px]:grid-cols-1" />
      </div>
      <div className="relative">
        <div ref={hostRef} className="charts relative rounded-2xl border border-line bg-surface-2 px-4 pb-4 pt-3" />
        {detailLoading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/90 px-3.5 py-1.5 font-mono text-[0.76rem] text-muted shadow-[0_2px_12px_-4px_rgba(0,0,0,0.5)] backdrop-blur-sm">
              <svg className="h-4 w-4 text-accent motion-safe:animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              {m.state_loading()}
            </span>
          </div>
        )}
      </div>

      {/* Accessible per-window summary — the non-visual truth for the canvas panels. */}
      <table className="sr-only" aria-live="polite">
        <caption>{m.cc_title()}</caption>
        <thead>
          <tr>
            <th scope="col">{m.chart_range()}</th>
            <th scope="col">{m.cc_updated()}</th>
            <th scope="col">min</th>
            <th scope="col">max</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.latest}</td>
              <td>{r.lo}</td>
              <td>{r.hi}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

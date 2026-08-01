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
// pans on phones with a Reset affordance. A completed drag/pinch zoom commits its window
// (so a finer tier loads); an explicit navigator group (pan ‹ ›, zoom − +, ⟲ Reset) gives
// the same actions as discoverable, labelled buttons.

import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useTheme } from '../lib/theme';
import { useLocale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';
import { compass, dirColor, fmtNumber, fmtDateTime, fmtAxisTick } from '../lib/format';
import { useUnits, measureKind, measureSuffix, keySuffix, formatKeyValue, convertMeasure } from '../lib/units';
import { loadParquetTier, loadWindParquetTier, type Columnar } from '../lib/parquet';
import { reconstructCurve, extremaSeries, tideHeightAt, type TideEvent, type Tides } from '../lib/tides';
import { iconSvg, type IconName } from './icons';
import { touchZoomPlugin } from '../lib/uplotTouch';
import HeatRibbon from './HeatRibbon';
import DatePicker from './DatePicker';

const SYNC_KEY = 'olatu-ts';
const DAY = 86_400;
const HOUR = 3_600;
// Tightest window the presets / a drag-zoom may resolve to (sub-day is allowed now — spec 0013 rev).
const MIN_SPAN = HOUR;

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
function drawArrowGlyphs(u: uPlot, xs: number[], dir: (number | null)[], dpr: number, color?: string) {
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
    // Both direction rows (swell + wind) carry the cyclical from-direction hue: direction is
    // encoded by cardinal colour, realm by the panel's realm bar/tag (spec 0013 revision). The
    // optional `color` override is kept for callers that want a flat colour.
    ctx.fillStyle = color ?? dirColor(d);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Insert null break-points across real outages so a line never bridges a gap. A "gap" is a
 *  delta far larger than the LOCAL sampling cadence, tracked causally with an EWMA of the normal
 *  deltas — NOT the global minimum. That distinction is the whole point: a source can MIX
 *  cadences. The current-year wind file appends a 6-min live tail to an hourly history, so keying
 *  the threshold off the global-min (6 min) flagged every hourly history step (3600 s ≫ 4×360 s)
 *  as a gap and shattered the line into invisible dots — the reported "wind vanishes when I zoom
 *  into an older window" (at 1Y the uniform hourly-*means* tier loads, so it looked fine; zoomed
 *  in, the mixed-cadence year tier loaded). Because the coarse history always precedes the fine
 *  live tail chronologically, a causal EWMA stays coarse through all of the history and only
 *  sharpens in the tail, so neither regime is ever shattered — now or as the live feed grows.
 *  Returns the gap-aware x + per-key columns the charts and hover card read from. Shared by the
 *  buoy and wind-station sources (each has its own x-grid). */
const GAP_FACTOR = 4; // a delta > 4× the local cadence is a real outage → break the line
const GAP_EWMA_ALPHA = 0.15; // cadence tracker responsiveness (~adapts over a handful of samples)
function gapAware(src: Columnar): { gxs: number[]; gcols: Record<string, (number | null)[]> } {
  const sxs = src.t;
  const keys = Object.keys(src).filter((k) => k !== 't');
  const gxs: number[] = [];
  const gcols: Record<string, (number | null)[]> = {};
  for (const k of keys) gcols[k] = [];
  let cadence = 0; // EWMA of normal (non-gap) deltas; seeded from the first positive delta
  for (let i = 0; i < sxs.length; i++) {
    if (i > 0) {
      const d = sxs[i] - sxs[i - 1];
      if (cadence === 0 && d > 0) cadence = d; // seed → the first delta is never itself a gap
      if (cadence > 0 && d > GAP_FACTOR * cadence) {
        // A real outage: break the line with a null just after the last sample, and do NOT fold
        // this (huge) delta into the cadence estimate — that would poison the tracker.
        gxs.push(sxs[i - 1] + cadence);
        for (const k of keys) gcols[k].push(null);
      } else if (d > 0) {
        cadence = GAP_EWMA_ALPHA * d + (1 - GAP_EWMA_ALPHA) * cadence; // track the local cadence
      }
    }
    gxs.push(sxs[i]);
    for (const k of keys) gcols[k].push((src[k] as (number | null)[])[i]);
  }
  return { gxs, gcols };
}

// Tide extrema markers: ▲ above each high, ▼ below each low, riding the reconstructed
// water-level curve (spec 0008 §8.3). Density-thinned to a minimum pixel spacing like the
// direction glyphs; drawn only on narrow windows (the wide-window zig-zag already vertices
// at the extrema, so markers there would just clutter).
function drawTideMarkers(u: uPlot, events: TideEvent[], color: string, dpr: number) {
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.fillStyle = color;
  const minGap = 20 * dpr;
  const s = 4 * dpr;
  let lastX = -Infinity;
  for (const e of events) {
    const px = u.valToPos(e.t / 1000, 'x', true);
    if (px < left - 2 || px > left + width + 2 || px - lastX < minGap) continue;
    lastX = px;
    const py = u.valToPos(e.h, 'y', true);
    const high = e.kind === 'high';
    ctx.beginPath();
    if (high) {
      ctx.moveTo(px, py - s * 1.9);
      ctx.lineTo(px - s, py - s * 0.4);
      ctx.lineTo(px + s, py - s * 0.4);
    } else {
      ctx.moveTo(px, py + s * 1.9);
      ctx.lineTo(px - s, py + s * 0.4);
      ctx.lineTo(px + s, py + s * 0.4);
    }
    ctx.closePath();
    ctx.fill();
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
  /** Stable id for order/hidden persistence (spec 0013). */
  id: string;
  /** Data realm: `sea` reads the buoy source, `air` reads the paired wind station. */
  realm: 'sea' | 'air';
  titleKey: MessageKey;
  series: { key: string; colorVar: string; width?: number; fill?: boolean; dash?: number[] }[];
  glyph?: boolean; // direction: single centred arrow row, no linear y-axis
  tide?: boolean; // marée: an external reconstructed curve + PM/BM markers (spec 0008)
  zeroBased?: boolean; // y-axis anchored at 0 (spread magnitude)
  glued?: boolean; // no top gap — sits flush under the panel above (a child of the panel above)
  emptyKey?: MessageKey;
}

// Sea realm (buoy). `spread` is glued under `swelldir` — it's a child of that panel, so the two
// move + hide together (the reorder/hide units are the non-glued panels; spec 0013).
const SEA_PANELS: PanelDef[] = [
  {
    id: 'height',
    realm: 'sea',
    titleKey: 'cc_wave_height',
    series: [
      { key: 'significant_wave_height_m', colorVar: '--c-height', width: 2, fill: true },
      { key: 'max_wave_height_m', colorVar: '--c-max', width: 1 },
    ],
  },
  { id: 'period', realm: 'sea', titleKey: 'cc_period', series: [{ key: 'significant_period_s', colorVar: '--c-period', width: 2 }] },
  {
    // Direction: a single row of colour+rotation arrows (see drawArrowGlyphs) — no y-axis.
    id: 'swelldir',
    realm: 'sea',
    titleKey: 'cc_direction',
    series: [{ key: 'peak_direction_deg', colorVar: '--c-dir' }],
    glyph: true,
  },
  {
    // Étalement (spread): its own honest 0-based line, glued flush under the arrow row.
    id: 'spread',
    realm: 'sea',
    titleKey: 'cc_spread',
    series: [{ key: 'peak_directional_spread_deg', colorVar: '--c-dir', width: 1.5 }],
    zeroBased: true,
    glued: true,
  },
  {
    // Tide (marée): the reconstructed WATER LEVEL (m) over time with ▲ high / ▼ low markers
    // (spec 0008 §8.3), fed from the per-port tides.parquet (external to the wave Columnar).
    // Y is auto min/max (water sits well above chart datum). Empty-state only where there's
    // no tide data.
    id: 'tide',
    realm: 'sea',
    titleKey: 'tide_level',
    series: [{ key: 'tide', colorVar: '--c-tide', width: 2, fill: true }],
    tide: true,
    emptyKey: 'tide_chart_empty',
  },
  {
    id: 'seatemp',
    realm: 'sea',
    titleKey: 'cc_sea_temp',
    series: [{ key: 'sea_temperature_c', colorVar: '--c-temp', width: 2, fill: true }],
    emptyKey: 'chart_temp_unavailable',
  },
];

// Air realm (the paired wind station) — plotted on the SAME x-axis as the buoy (spec 0013).
const AIR_PANELS: PanelDef[] = [
  {
    id: 'wind',
    realm: 'air',
    titleKey: 'cc_wind',
    series: [
      { key: 'wind_speed_ms', colorVar: '--c-wind', width: 2, fill: true },
      { key: 'wind_gust_ms', colorVar: '--c-wind', width: 1, dash: [4, 4] },
    ],
    emptyKey: 'cc_wind_unavailable',
  },
  { id: 'winddir', realm: 'air', titleKey: 'cc_wind_dir', series: [{ key: 'wind_direction_deg', colorVar: '--c-wind' }], glyph: true, emptyKey: 'cc_wind_unavailable' },
  { id: 'airtemp', realm: 'air', titleKey: 'cc_air_temp', series: [{ key: 'air_temperature_c', colorVar: '--c-airtemp', width: 2, fill: true }], emptyKey: 'cc_wind_unavailable' },
  { id: 'rain', realm: 'air', titleKey: 'cc_rain', series: [{ key: 'precipitation_mm', colorVar: '--c-period', width: 1.5, fill: true }], zeroBased: true, emptyKey: 'cc_wind_unavailable' },
  // Humidity + pressure are NULLABLE (some stations drop them, per spec 0012): their own empty
  // message ("not measured at this station") is honester than the generic wind-unavailable band.
  { id: 'humidity', realm: 'air', titleKey: 'cc_humidity', series: [{ key: 'humidity_pct', colorVar: '--c-tide', width: 1.5 }], emptyKey: 'cc_hp_unavailable' },
  { id: 'pressure', realm: 'air', titleKey: 'cc_pressure', series: [{ key: 'pressure_msl_hpa', colorVar: '--c-dir', width: 1.5 }], emptyKey: 'cc_hp_unavailable' },
];

const WIND_DETAIL_COLUMNS = ['wind_speed_ms', 'wind_gust_ms', 'wind_direction_deg', 'air_temperature_c', 'precipitation_mm', 'humidity_pct', 'pressure_msl_hpa'];
const REALM_COLOR: Record<'sea' | 'air', string> = { sea: 'var(--accent)', air: 'var(--c-wind)' };

// Panel order + hidden set are remembered across sessions (spec 0013). Both are JSON arrays of
// unit ids; unknown/new ids are tolerated (a future panel just appends). The reorder/hide UNIT is
// a non-glued panel — a glued child (spread) always travels with its parent.
const CHARTS_ORDER_STORE = 'olatu.charts.order';
const CHARTS_HIDDEN_STORE = 'olatu.charts.hidden';
function storedIds(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function persistIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage unavailable — the change still applies for this session */
  }
}

// Imperative per-panel header controls (drag handle + hide eye), styled as a literal class string
// so Tailwind's source scanner keeps these utilities.
const TS_CTL =
  'inline-flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-faint transition-colors hover:border-line hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

// `days` may be fractional for the sub-day presets (2h/6h/12h — spec 0013 rev). null = All.
const PRESETS: { key: string; days: number | null }[] = [
  { key: '2H', days: 2 / 24 },
  { key: '6H', days: 6 / 24 },
  { key: '12H', days: 12 / 24 },
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

// The chosen smoothing is remembered across sessions, exactly like the range preset above.
const SMOOTH_STORE = 'olatu.smooth';
const DEFAULT_SMOOTH: Smooth = 'raw';
function storedSmooth(): Smooth {
  try {
    const v = localStorage.getItem(SMOOTH_STORE);
    if (v === 'raw' || v === 'light' || v === 'strong') return v;
  } catch {
    /* storage unavailable (private mode) — fall back to the default */
  }
  return DEFAULT_SMOOTH;
}

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

// The paired station's readout chips (Air realm) — surfaced beside the sea chips in the hover card
// so "which temperature / direction is which" reads at a glance (spec 0013 rev). Kept to the core
// four; the panels + on-plot bubbles carry rain / humidity / pressure.
const AIR_CARD_METRICS: { key: string; labelKey: MessageKey; dir?: boolean; icon: IconName; colorVar: string }[] = [
  { key: 'wind_speed_ms', labelKey: 'cc_wind', icon: 'wind', colorVar: '--c-wind' },
  { key: 'wind_gust_ms', labelKey: 'cc_gust', icon: 'wind', colorVar: '--c-wind' },
  { key: 'wind_direction_deg', labelKey: 'cc_wind_dir', dir: true, icon: 'wind', colorVar: '--c-dir' },
  { key: 'air_temperature_c', labelKey: 'cc_air_temp', icon: 'temp', colorVar: '--c-airtemp' },
];

// Fixed display unit for the non-convertible keys (the convertible speed/temp/pressure keys get
// their unit from keySuffix + the settings, spec 0014). Powers the per-panel heading unit tag +
// the hover chips / cursor bubble.
const FIXED_UNIT: Record<string, string> = {
  significant_wave_height_m: 'm',
  max_wave_height_m: 'm',
  significant_period_s: 's',
  peak_directional_spread_deg: '°',
  precipitation_mm: 'mm',
  humidity_pct: '%',
  tide: 'm',
};

// Panel title → icon (the wave-height panel carries both Hs and Hmax, so its title
// uses the wave-height glyph). Tinted with the panel's primary series colour.
const PANEL_ICON: Partial<Record<MessageKey, IconName>> = {
  cc_wave_height: 'waveHeight',
  cc_period: 'period',
  cc_direction: 'direction',
  cc_spread: 'spread',
  cc_sea_temp: 'temp',
  tide_level: 'tide',
  cc_wind: 'wind',
  cc_wind_dir: 'wind',
  cc_air_temp: 'temp',
  cc_rain: 'rain',
  cc_humidity: 'humidity',
  cc_pressure: 'pressure',
};

const DETAIL_COLUMNS = [
  'significant_wave_height_m',
  'max_wave_height_m',
  'significant_period_s',
  'peak_direction_deg',
  'peak_directional_spread_deg',
  'sea_temperature_c',
];
// Tiered resolution by window span: ≤120 d → per-year 30-min files; ≤~2 yr → per-year
// hourly means; wider → daily means. Finer detail where it reads, lighter loads where it
// doesn't — both fine tiers fetch only the years in view.
const DETAIL_30MIN = 120 * DAY;
const DETAIL_HOURLY = 800 * DAY;

function mergeColumnar(parts: Columnar[], cols: string[]): Columnar {
  const out: Columnar = { t: [] };
  for (const c of cols) out[c] = [];
  for (const p of parts) {
    for (let i = 0; i < p.t.length; i++) out.t.push(p.t[i]);
    for (const c of cols) {
      const a = (p[c] as (number | null)[]) ?? [];
      for (let i = 0; i < p.t.length; i++) out[c].push(a[i] ?? null);
    }
  }
  return out;
}

export default function TimeSeries({
  campaign,
  data,
  tz,
  yearFiles,
  hourlyFiles,
  lastT,
  tides,
  windStation = null,
  windHistory = null,
  windYearFiles = {},
  windHourlyFiles = {},
}: {
  campaign: string;
  data: Columnar;
  tz: string;
  yearFiles: Record<number, string>;
  hourlyFiles: Record<number, string>;
  lastT?: number;
  tides: Tides | null;
  windStation?: string | null;
  windHistory?: Columnar | null;
  windYearFiles?: Record<number, string>;
  windHourlyFiles?: Record<number, string>;
}) {
  const { theme } = useTheme();
  const { locale } = useLocale();
  const { units } = useUnits();
  const hostRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Live uPlot instances + their base x-scale (used for immediate visual reset).
  const plotsRef = useRef<uPlot[]>([]);
  const baseScaleRef = useRef<{ min: number; max: number } | null>(null);
  // The window set by the last preset/chip/picker navigation (not a drag/pinch zoom).
  // A drag-zoom commits its window to `range` so a finer tier loads (see the gesture-end
  // handler below); Reset / double-click return here — back to the active preset — which
  // reloads the coarser tier. Seeded lazily from the initial preset on first render.
  const presetBaseRef = useRef<{ min: number; max: number; mode: string } | null>(null);
  const [smooth, setSmooth] = useState<Smooth>(storedSmooth);

  const resetZoom = () => {
    const b = presetBaseRef.current;
    if (b) {
      // Snap the visuals immediately, then commit so the coarser tier reloads.
      for (const p of plotsRef.current) p.setScale('x', { min: b.min, max: b.max });
      apply(b.min, b.max, b.mode);
    } else if (baseScaleRef.current) {
      for (const p of plotsRef.current) p.setScale('x', baseScaleRef.current);
    }
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
  const hourlyCache = useRef<Map<number, Columnar>>(new Map());
  // Paired wind station: its own detail tiers (same tiering as the buoy, station-keyed) + caches.
  const [windDetail, setWindDetail] = useState<Columnar | null>(null);
  const windDetailCache = useRef<Map<number, Columnar>>(new Map());
  const windHourlyCache = useRef<Map<number, Columnar>>(new Map());
  // Sea panels always; the paired station's Air panels only when a station is resolved (spec 0013).
  const allPanels = useMemo(() => (windStation ? [...SEA_PANELS, ...AIR_PANELS] : SEA_PANELS), [windStation]);
  const panelById = useMemo(() => new Map(allPanels.map((p) => [p.id, p])), [allPanels]);

  // Panel order + hidden set (persisted). `order` is kept as the FULL reconciled unit list, so the
  // drag/hide handlers can splice it directly. Seed it reconciled to avoid an empty first paint.
  const [order, setOrder] = useState<string[]>(() => {
    const stored = storedIds(CHARTS_ORDER_STORE);
    const unitIds = (windStation ? [...SEA_PANELS, ...AIR_PANELS] : SEA_PANELS).filter((p) => !p.glued).map((p) => p.id);
    return [...stored.filter((id) => unitIds.includes(id)), ...unitIds.filter((id) => !stored.includes(id))];
  });
  const [hidden, setHidden] = useState<string[]>(() => storedIds(CHARTS_HIDDEN_STORE));
  // A reorder rebuilds the whole stack, so the focused drag band is destroyed: remember which unit
  // to re-focus afterwards, else keyboard reordering loses focus after a single arrow press.
  const focusBandRef = useRef<string | null>(null);

  // Keep `order` complete when the available panels change (e.g. the wind station resolves): append
  // any missing unit id, preserving the stored order for the rest.
  useEffect(() => {
    const unitIds = allPanels.filter((p) => !p.glued).map((p) => p.id);
    setOrder((prev) => {
      const next = [...prev.filter((id) => unitIds.includes(id)), ...unitIds.filter((id) => !prev.includes(id))];
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next;
    });
  }, [allPanels]);

  useEffect(() => persistIds(CHARTS_ORDER_STORE, order), [order]);
  useEffect(() => persistIds(CHARTS_HIDDEN_STORE, hidden), [hidden]);

  const hideUnit = (id: string) => setHidden((h) => (h.includes(id) ? h : [...h, id]));
  const showUnit = (id: string) => setHidden((h) => h.filter((x) => x !== id));
  const moveUnit = (from: string, to: string, after: boolean) =>
    setOrder((prev) => {
      if (from === to) return prev;
      const list = prev.filter((x) => x !== from);
      const ti = list.indexOf(to);
      if (ti < 0) return prev;
      list.splice(after ? ti + 1 : ti, 0, from);
      return list;
    });

  // The flat, ordered, visible panel list the render effect iterates: each visible unit followed
  // by its glued children (spread under swelldir). Hidden units are collected for the chip tray.
  const { visibleFlat, hiddenUnits } = useMemo(() => {
    const gluedAfter = new Map<string, PanelDef[]>();
    let lastUnit: string | null = null;
    for (const p of allPanels) {
      if (p.glued && lastUnit) gluedAfter.set(lastUnit, [...(gluedAfter.get(lastUnit) ?? []), p]);
      else lastUnit = p.id;
    }
    const hiddenSet = new Set(hidden);
    const flat: PanelDef[] = [];
    const hiddenU: string[] = [];
    for (const id of order) {
      const p = panelById.get(id);
      if (!p || p.glued) continue;
      if (hiddenSet.has(id)) {
        hiddenU.push(id);
        continue;
      }
      flat.push(p);
      for (const g of gluedAfter.get(id) ?? []) flat.push(g);
    }
    return { visibleFlat: flat, hiddenUnits: hiddenU };
  }, [allPanels, order, hidden, panelById]);

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

  // `isZoom` marks a window committed by a drag/pinch gesture: it navigates (loads the
  // matching tier) but must NOT become the Reset target — that stays the last preset.
  const apply = (min: number, max: number, mo: string, isZoom = false) => {
    // Clamp into [T0, TN] and guarantee a minimum span (so min<max) — but only MIN_SPAN (1 h),
    // NOT a whole day, so the 2h/6h/12h presets + fine drag-zooms keep their real width.
    let lo = Math.max(T0, Math.min(min, max));
    let hi = Math.min(TN, Math.max(min, max));
    if (hi - lo < MIN_SPAN) {
      if (hi >= TN) lo = Math.max(T0, TN - MIN_SPAN); // anchored to the latest reading
      else hi = Math.min(TN, lo + MIN_SPAN);
    }
    const clamped = { min: lo, max: hi };
    setRange(clamped);
    setMode(mo);
    if (!isZoom) presetBaseRef.current = { ...clamped, mode: mo };
  };

  // Seed the Reset target from the initial preset (once — the guard makes it render-safe).
  if (presetBaseRef.current === null) presetBaseRef.current = { min: range.min, max: range.max, mode };

  // Time-navigation controls: pan by half a window, zoom by ~1.6×, both clamped to the
  // series bounds. They navigate (load the matching tier) but pass isZoom so ⟲ Reset
  // still returns to the chosen preset, not an intermediate pan/zoom.
  const panBy = (frac: number) => {
    const shift = (range.max - range.min) * frac;
    let min = range.min + shift;
    let max = range.max + shift;
    if (min < T0) [min, max] = [T0, max + (T0 - min)];
    if (max > TN) [min, max] = [min - (max - TN), TN];
    apply(min, max, 'custom', true);
  };
  const zoomBy = (factor: number) => {
    const c = (range.min + range.max) / 2;
    const half = ((range.max - range.min) * factor) / 2;
    apply(c - half, c + half, 'custom', true);
  };
  const atStart = range.min <= T0 + 1;
  const atEnd = range.max >= TN - 1;
  const navBtn = 'grid h-7 w-7 place-items-center leading-none disabled:opacity-40 disabled:pointer-events-none';

  const dirLocale = (deg: number) => {
    const tok = ['N', 'E', 'S', 'W'][Math.round(deg / 90) % 4];
    return locale === 'en' ? tok : tok === 'W' ? 'O' : tok;
  };

  const monthLabels = useMemo(
    () => Array.from({ length: 12 }, (_, mo) => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, mo, 1)))),
    [locale],
  );

  // Tiered detail: narrow windows plot the per-year 30-min files; mid windows plot the
  // per-year hourly means; wide windows fall back to the daily means passed in. Loaded
  // tiers are cached in memory, one entry per year.
  useEffect(() => {
    const span = range.max - range.min;
    let cancelled = false;

    // Load the per-year tiles (30-min or hourly means) intersecting the window from
    // `files`, caching each year, and set the merged detail. Both fine tiers are chunked
    // per year so only the years actually in view are fetched.
    const loadTiles = async (files: Record<number, string>, cache: Map<number, Columnar>) => {
      const needed: number[] = [];
      for (let y = new Date(range.min * 1000).getUTCFullYear(); y <= new Date(range.max * 1000).getUTCFullYear(); y++) {
        if (files[y]) needed.push(y);
      }
      if (needed.length === 0) {
        if (!cancelled) setDetail(null);
        return;
      }
      // Spin only if something actually has to be fetched (cached tiles are instant).
      if (!cancelled && !needed.every((y) => cache.has(y))) setDetailLoading(true);
      const parts: Columnar[] = [];
      for (const y of needed) {
        let c = cache.get(y);
        if (!c) {
          c = await loadParquetTier(campaign, files[y], DETAIL_COLUMNS);
          cache.set(y, c);
        }
        parts.push(c);
      }
      if (!cancelled) setDetail(mergeColumnar(parts, DETAIL_COLUMNS));
    };

    (async () => {
      try {
        if (span <= DETAIL_30MIN) {
          await loadTiles(yearFiles, detailCache.current);
        } else if (span <= DETAIL_HOURLY) {
          await loadTiles(hourlyFiles, hourlyCache.current);
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
  }, [campaign, range.min, range.max, yearFiles, hourlyFiles]);

  // A station override (no campaign change → no remount) must not read the previous station's
  // per-year cache (both cache under the same year key), so clear it when the station changes.
  useEffect(() => {
    windDetailCache.current.clear();
    windHourlyCache.current.clear();
  }, [windStation]);

  // Wind detail tiers — the same tiering as the buoy (30-min → hourly → daily by span), keyed by
  // station via loadWindParquetTier. Best-effort; no station → no wind detail (daily fallback).
  useEffect(() => {
    if (!windStation) {
      setWindDetail(null);
      return;
    }
    const span = range.max - range.min;
    let cancelled = false;
    const loadTiles = async (files: Record<number, string>, cache: Map<number, Columnar>) => {
      const needed: number[] = [];
      for (let y = new Date(range.min * 1000).getUTCFullYear(); y <= new Date(range.max * 1000).getUTCFullYear(); y++) {
        if (files[y]) needed.push(y);
      }
      if (needed.length === 0) {
        if (!cancelled) setWindDetail(null);
        return;
      }
      const parts: Columnar[] = [];
      for (const y of needed) {
        let c = cache.get(y);
        if (!c) {
          c = await loadWindParquetTier(windStation, files[y], WIND_DETAIL_COLUMNS);
          cache.set(y, c);
        }
        parts.push(c);
      }
      if (!cancelled) setWindDetail(mergeColumnar(parts, WIND_DETAIL_COLUMNS));
    };
    (async () => {
      try {
        if (span <= DETAIL_30MIN) await loadTiles(windYearFiles, windDetailCache.current);
        else if (span <= DETAIL_HOURLY) await loadTiles(windHourlyFiles, windHourlyCache.current);
        else if (!cancelled) setWindDetail(null);
      } catch (e) {
        console.error('Failed to load wind detail tier:', e);
        if (!cancelled) setWindDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windStation, range.min, range.max, windYearFiles, windHourlyFiles]);

  useEffect(() => {
    const host = hostRef.current;
    const src = detail ?? data;
    const sxs = src.t;
    if (!host || sxs.length === 0) return;
    // The stack collapses to nothing while it is rebuilt, the document shrinks, and the browser
    // clamps the scroll to the top — a reorder/hide would yank you back up the page. The teardown
    // pins the old height on the host (see the cleanup below, which runs BEFORE this); here we
    // only have to hold it until the panels are back. `prevScroll` covers what still slips through.
    const prevScroll = window.scrollY;
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

    // Tide (marée) panel data (spec 0008 §8.3): the reconstructed WATER LEVEL (m) over the
    // window. Adaptive so it reads at every zoom — narrow windows get the smooth 10-min
    // raised-cosine curve (+ ▲/▼ markers), wider ones connect the raw extrema (the cheap
    // envelope zig-zag; undersampling the cosine would alias). Hover shows the level at the
    // cursor; the empty-state shows only where the window has no tide extrema.
    const tideEvents = tides?.events ?? [];
    const tideNarrow = xmax - xmin <= 21 * DAY;
    const tideCurve = tideEvents.length
      ? tideNarrow
        ? reconstructCurve(tideEvents, xmin, xmax, 600)
        : extremaSeries(tideEvents, xmin, xmax)
      : { t: [] as number[], h: [] as (number | null)[] };
    const tideColor = cssVar('--c-tide');
    const tideInWindow = tideEvents.some((e) => e.t / 1000 >= xmin && e.t / 1000 <= xmax);

    // Insert null break-points across real outages so the line never bridges a gap
    // (daily.parquet omits empty days). gxs/gcols are the gap-aware arrays the charts AND the
    // hover card read from — uPlot's cursor idx indexes into these. The wind station is a
    // SEPARATE source on its own x-grid (spec 0013), so it gets its own gap-aware arrays; Air
    // panels read those while sharing the same x-scale + crosshair sync as the buoy panels.
    const { gxs, gcols } = gapAware(src);
    const windSrc = windStation ? windDetail ?? windHistory : null;
    const windSxs = windSrc?.t ?? [];
    const wind = windSrc ? gapAware(windSrc) : { gxs: [] as number[], gcols: {} as Record<string, (number | null)[]> };
    const windGxs = wind.gxs;
    const windGcols = wind.gcols;

    const axisColor = cssVar('--text-3');
    const gridColor = cssVar('--hairline');
    const DPR = window.devicePixelRatio || 1; // uPlot draws in device px; glyphs match
    const plots: uPlot[] = [];
    let syncing = false;

    const timeEl = cardRef.current?.querySelector<HTMLElement>('.hover-time') ?? null;
    const statsEl = cardRef.current?.querySelector<HTMLElement>('.hover-stats') ?? null;
    // Units-aware value string for a metric (spec 0014): direction → compass; a convertible
    // measure (speed/temp/pressure) → converted value + its unit; else a fixed unit.
    const fmtMetric = (cm: { key: string; dir?: boolean; pm?: boolean; unit?: string; digits?: number }, v: number): string => {
      if (cm.dir) return `${compass(v, locale)} · ${Math.round(v)}°`;
      const kind = measureKind(cm.key);
      if (kind) return `${formatKeyValue(cm.key, v, units, locale)} ${measureSuffix(kind, units)}`;
      return `${cm.pm ? '±' : ''}${fmtNumber(v, locale, cm.digits ?? 1)}${cm.unit ? ` ${cm.unit}` : ''}`;
    };
    // The station rides its own x-grid, so the buoy-indexed hover card looks up its nearest sample
    // by TIME (windGxs is sorted ascending). Returns -1 when there is no wind series.
    const windIdxAt = (t: number): number => {
      if (windGxs.length === 0) return -1;
      let lo = 0;
      let hi = windGxs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (windGxs[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && Math.abs(windGxs[lo - 1] - t) < Math.abs(windGxs[lo] - t)) lo -= 1;
      return lo;
    };
    const chip = (cm: { labelKey: MessageKey; icon: IconName; colorVar: string }, valueHtml: string): string => {
      const icon = iconSvg(cm.icon, { className: 'shrink-0', color: `var(${cm.colorVar})` });
      return `<span class="inline-flex items-center gap-[0.35rem]">${icon}<span class="text-[0.72rem] uppercase tracking-[0.05em] text-faint">${m[cm.labelKey]()}</span><span class="font-mono text-[0.98rem] text-fg">${valueHtml}</span></span>`;
    };
    const chipsHTML = (idx: number) => {
      const chips: string[] = [];
      for (const cm of CARD_METRICS) {
        const v = gcols[cm.key]?.[idx];
        if (v != null) chips.push(chip(cm, fmtMetric(cm, v)));
      }
      // Reconstructed water level at the hovered time (from the extrema, not in gcols).
      const th = tides ? tideHeightAt(tides.events, gxs[idx]) : null;
      if (th != null) chips.push(chip({ labelKey: 'tide_level', icon: 'tide', colorVar: '--c-tide' }, `${fmtNumber(th, locale, 1)} m`));
      // Air chips (spec 0013 rev): the station's readings at the hovered TIME. Only when a station
      // is paired, so the card gains air values without ever pairing them to the buoy's index.
      if (windStation && windGxs.length) {
        const wi = windIdxAt(gxs[idx]);
        if (wi >= 0) {
          for (const cm of AIR_CARD_METRICS) {
            const v = windGcols[cm.key]?.[wi];
            if (v != null) chips.push(chip(cm, fmtMetric(cm, v)));
          }
        }
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
      if (timeEl) timeEl.textContent = fmtDateTime(gxs[idx] * 1000, locale, tz, units.clock);
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
      const fmt = (v: number) => fmtMetric(cm, v);
      return {
        label: m[cm.labelKey](),
        latest: latest == null ? '—' : fmt(latest),
        lo: Number.isFinite(lo) ? fmt(lo) : '—',
        hi: Number.isFinite(hi) ? fmt(hi) : '—',
      };
    });
    // Tide row: water level (m) lowest-low / highest-high / current, across the window.
    if (tideInWindow) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const e of tideEvents) {
        const s = e.t / 1000;
        if (s < xmin || s > xmax) continue;
        if (e.h < lo) lo = e.h;
        if (e.h > hi) hi = e.h;
      }
      const latest = tideHeightAt(tideEvents, xmax);
      summaryRows.push({
        label: m.tide_level(),
        latest: latest == null ? '—' : `${fmtNumber(latest, locale, 1)} m`,
        lo: Number.isFinite(lo) ? `${fmtNumber(lo, locale, 1)} m` : '—',
        hi: Number.isFinite(hi) ? `${fmtNumber(hi, locale, 1)} m` : '—',
      });
    }
    // Air (station) rows — latest/min/max per metric within the window, read from the station's
    // own series (its own x-grid), so assistive tech gets the air data too (spec 0013 rev).
    if (windStation && windSrc) {
      const wxs = windSrc.t;
      for (const cm of AIR_CARD_METRICS) {
        const col = windSrc[cm.key] as (number | null)[] | undefined;
        if (!col) continue;
        let lo = Infinity;
        let hi = -Infinity;
        let latest: number | null = null;
        for (let i = 0; i < wxs.length; i++) {
          if (wxs[i] < xmin || wxs[i] > xmax) continue;
          const v = col[i];
          if (v == null) continue;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
          latest = v;
        }
        if (latest == null) continue;
        summaryRows.push({
          label: m[cm.labelKey](),
          latest: fmtMetric(cm, latest),
          lo: Number.isFinite(lo) ? fmtMetric(cm, lo) : '—',
          hi: Number.isFinite(hi) ? fmtMetric(cm, hi) : '—',
        });
      }
    }
    setSummary(summaryRows);

    // ---- Reorder (spec 0013) --------------------------------------------------------------
    // One block per visible unit, in stack order — a glued child (spread) shares its parent's box,
    // so the pair drags as one. Filled by the render loop below.
    const blocks: { id: string; els: HTMLElement[] }[] = [];
    const bandEls = new Map<string, HTMLElement>();
    let unitBox: HTMLDivElement | null = null;
    let cancelDrag = () => {};

    const blockEdges = (b: { els: HTMLElement[] }) => ({
      top: b.els[0].getBoundingClientRect().top,
      bottom: b.els[b.els.length - 1].getBoundingClientRect().bottom,
    });

    // Pointer-based drag: the HTML5 drag-and-drop it replaces was inert on touch and offered only
    // the thin heading strip as a drop target. Here the drag band down the left of each panel is
    // the handle, the dragged unit dims in place, a chip rides the pointer, an accent line marks
    // the landing slot, and the page auto-scrolls near the viewport edges. Escape cancels.
    const beginDrag = (id: string, ev: PointerEvent) => {
      const from = blocks.findIndex((b) => b.id === id);
      if (from < 0) return;
      const def = panelById.get(id);
      const startX = ev.clientX;
      const startY = ev.clientY;
      let x = startX;
      let y = startY;
      let armed = false;
      let target = from;
      let speed = 0;
      let raf = 0;

      const line = document.createElement('div');
      line.setAttribute('aria-hidden', 'true');
      line.style.cssText = 'position:absolute;left:1rem;right:1rem;height:2px;border-radius:2px;background:var(--accent);box-shadow:0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);z-index:40;pointer-events:none;';
      const chipColor = def ? REALM_COLOR[def.realm] : 'var(--accent)';
      const chip = document.createElement('div');
      chip.setAttribute('aria-hidden', 'true');
      chip.textContent = def ? m[def.titleKey]() : '';
      chip.style.cssText = `position:fixed;z-index:60;pointer-events:none;transform:translate(-50%,-170%);padding:3px 9px;border-radius:999px;font:600 0.72rem/1.2 var(--font-mono);white-space:nowrap;color:${chipColor};background:color-mix(in oklab, var(--surface) 92%, transparent);border:1px solid color-mix(in oklab, ${chipColor} 45%, var(--hairline));box-shadow:0 8px 20px -8px rgba(0,0,0,0.6);`;

      // Landing slot = the first block whose midpoint sits below the pointer (else the end).
      const place = () => {
        const n = blocks.length;
        let idx = n;
        for (let i = 0; i < n; i++) {
          const e = blockEdges(blocks[i]);
          if (y < (e.top + e.bottom) / 2) {
            idx = i;
            break;
          }
        }
        target = idx;
        const at = idx < n ? blockEdges(blocks[idx]).top - 4 : blockEdges(blocks[n - 1]).bottom + 2;
        line.style.top = `${at - host.getBoundingClientRect().top}px`;
        chip.style.left = `${x}px`;
        chip.style.top = `${y}px`;
      };

      const tick = () => {
        if (speed) {
          window.scrollBy(0, speed);
          place();
        }
        raf = requestAnimationFrame(tick);
      };

      const arm = () => {
        armed = true;
        for (const el of blocks[from].els) el.style.opacity = '0.35';
        host.appendChild(line);
        document.body.appendChild(chip);
        document.body.style.userSelect = 'none';
        raf = requestAnimationFrame(tick);
      };

      const move = (e: PointerEvent) => {
        x = e.clientX;
        y = e.clientY;
        // A few pixels of slack so a plain click on the band doesn't flash the drag chrome.
        if (!armed) {
          if (Math.abs(y - startY) < 4 && Math.abs(x - startX) < 4) return;
          arm();
        }
        e.preventDefault(); // touch: keep the page from scrolling under the drag
        const margin = 90;
        speed = y < margin ? -Math.ceil((margin - y) / 6) : y > window.innerHeight - margin ? Math.ceil((y - (window.innerHeight - margin)) / 6) : 0;
        place();
      };

      const end = (commit: boolean) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', abort);
        window.removeEventListener('keydown', esc);
        cancelDrag = () => {};
        cancelAnimationFrame(raf);
        document.body.style.userSelect = '';
        line.remove();
        chip.remove();
        for (const el of blocks[from].els) el.style.opacity = '';
        // `from` and `from + 1` are both the slot it already occupies — neither is a move.
        if (commit && armed && target !== from && target !== from + 1) {
          if (target >= blocks.length) moveUnit(id, blocks[blocks.length - 1].id, true);
          else moveUnit(id, blocks[target].id, false);
        }
      };
      const up = () => end(true);
      const abort = () => end(false);
      const esc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') end(false);
      };

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', abort);
      window.addEventListener('keydown', esc);
      cancelDrag = abort;
    };

    visibleFlat.forEach((panel, idx) => {
      const isLast = idx === visibleFlat.length - 1;
      // Air panels read the wind station's source + x-grid; Sea panels read the buoy's. Both
      // share the x-scale + crosshair sync, so they line up at every zoom (spec 0013).
      const air = panel.realm === 'air';
      const pgxs = air ? windGxs : gxs;
      const pgcols = air ? windGcols : gcols;
      const psrc = air ? windSrc : src;
      const psxs = air ? windSxs : sxs;
      const wrap = document.createElement('div');
      // z-10 keeps the panels (and headings) above the day-separator overlay (z-0).
      wrap.className = 'relative z-10 w-full overflow-hidden';
      const heading = document.createElement('div');
      // Glued panels (spread under direction) get no top gap so the pair reads as one block.
      heading.className = `${panel.glued ? 'mt-0' : 'mt-[0.6rem]'} mb-[0.1rem] ml-[0.2rem] relative z-10 flex w-full items-center text-[0.74rem] uppercase tracking-[0.07em] text-faint`;
      const panelIcon = PANEL_ICON[panel.titleKey];
      const titleIcon = panelIcon ? iconSvg(panelIcon, { className: 'mr-1.5 shrink-0', color: `var(${panel.series[0].colorVar})` }) : '';
      // Realm cue (spec 0013): a coloured left bar + a Mer/Air chip so a long stack always reads
      // sea-vs-air at a glance. A glued child (spread) inherits its parent's — don't repeat it.
      const realmColor = REALM_COLOR[panel.realm];
      const realmBar = panel.glued
        ? ''
        : `<span aria-hidden="true" style="display:inline-block;width:3px;height:0.8rem;border-radius:2px;background:${realmColor};margin-right:0.5rem;flex:none"></span>`;
      const realmTag = panel.glued
        ? ''
        : `<span class="ml-2 rounded-[0.3rem] px-1.5 py-[0.05rem] text-[0.6rem] font-normal normal-case tracking-[0.03em]" style="color:${realmColor};background:color-mix(in oklab, ${realmColor} 14%, transparent)">${air ? m.ts_tag_air() : m.ts_tag_sea()}</span>`;
      // Both direction panels (swell + wind) carry an inline colour legend (N/E/S/O) so the
      // cyclical from-direction hue is self-explanatory without opening the glossary. The legend +
      // the per-panel controls share one right-aligned group.
      const legendInner =
        panel.glyph
          ? [0, 90, 180, 270]
              .map(
                (d) =>
                  `<span class="inline-flex items-center gap-[0.25rem]"><span class="inline-block h-[0.5rem] w-[0.5rem] rounded-full" style="background:${dirColor(d)}"></span>${dirLocale(d)}</span>`,
              )
              .join('')
          : '';
      // Unit tag beside the title (spec 0014): the display unit for a convertible measure, else the
      // fixed unit; direction panels show none (their N/E/S/O legend carries the meaning).
      const uKey = panel.series[0].key;
      const uSuffix = keySuffix(uKey, units) ?? FIXED_UNIT[uKey] ?? '';
      const unitTag = uSuffix ? `<span class="ml-1.5 font-mono text-[0.62rem] font-normal normal-case tracking-normal text-faint">${uSuffix}</span>` : '';
      heading.innerHTML = `${realmBar}${titleIcon}<span>${m[panel.titleKey]()}</span>${unitTag}${realmTag}<span class="ts-right ml-auto flex items-center gap-[0.55rem] text-[0.66rem]">${legendInner}</span>`;

      // Per-unit controls (spec 0013): a hide "eye" + a drag handle. Glued children (spread) get
      // none — they follow their parent. Wired imperatively since the panels live in this uPlot host.
      if (!panel.glued) {
        const right = heading.querySelector('.ts-right');
        const eye = document.createElement('button');
        eye.type = 'button';
        eye.className = TS_CTL;
        eye.setAttribute('aria-label', `${m.ts_hide()} · ${m[panel.titleKey]()}`);
        eye.title = m.ts_hide();
        eye.innerHTML = iconSvg('eye', { size: 15, color: 'currentColor' });
        eye.addEventListener('click', () => hideUnit(panel.id));
        right?.appendChild(eye);

      }

      // Each unit lives in its own positioned box so its drag band can span the full height of the
      // panel in the host's left gutter; a glued child (spread) joins its parent's box, so the pair
      // drags — and dims — as one. The band is the ONLY reorder control: a generous pointer target
      // that is also the keyboard one (focusable, ↑/↓ moves the unit), which is why the heading
      // carried a separate grip button only in the first cut.
      if (!panel.glued) {
        unitBox = document.createElement('div');
        unitBox.className = 'ts-unit relative';
        const band = document.createElement('div');
        band.className = 'ts-band';
        band.tabIndex = 0;
        band.setAttribute('role', 'button');
        band.setAttribute('aria-label', `${m.ts_reorder()} · ${m[panel.titleKey]()}`);
        band.title = m.ts_reorder();
        band.style.setProperty('--band', REALM_COLOR[panel.realm]);
        band.addEventListener('pointerdown', (e) => {
          if (e.button > 0) return;
          e.preventDefault(); // ...which also suppresses the default focus, so do it by hand
          band.focus({ preventScroll: true });
          beginDrag(panel.id, e);
        });
        // Keyboard equivalent — and the reliable way out when a drag feels fiddly.
        band.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const i = blocks.findIndex((b) => b.id === panel.id);
          const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= blocks.length) return;
          focusBandRef.current = panel.id;
          moveUnit(panel.id, blocks[j].id, e.key === 'ArrowDown');
        });
        bandEls.set(panel.id, band);
        unitBox.appendChild(band);
        host.appendChild(unitBox);
        blocks.push({ id: panel.id, els: [unitBox] });
      }
      (unitBox ?? host).appendChild(heading);
      (unitBox ?? host).appendChild(wrap);

      const inWindow = (key: string) => {
        if (!psrc) return false;
        const col = psrc[key] as (number | null)[];
        let n = 0;
        for (let i = 0; i < psxs.length; i++) {
          if (psxs[i] >= xmin && psxs[i] <= xmax && col[i] != null) n += 1;
          if (n >= 2) return true;
        }
        return false;
      };
      const hasData = panel.tide ? tideInWindow : panel.series.some((srs) => inWindow(srs.key));

      // Convert the plotted values to the chosen display unit (spec 0014); the °C→°F offset is
      // affine so it commutes with the moving-average smoothing above. Non-measures pass through.
      const plotted = (key: string) => {
        const arr = movingAvg(pgcols[key] ?? [], radius);
        const kind = measureKind(key);
        return kind ? arr.map((v) => (v == null ? null : convertMeasure(kind, v, units))) : arr;
      };

      let chartData: uPlot.AlignedData;
      let series: uPlot.Series[];

      if (panel.tide) {
        // External reconstructed water-level curve (already smooth — not run through the
        // Raw/Light/Strong control, which would damp the PM/BM peaks). No tide data anywhere
        // → keep the shared x so it's a framed, empty panel (like temp) and the overlay shows.
        chartData = tideCurve.t.length
          ? [tideCurve.t, tideCurve.h]
          : [gxs, gxs.map(() => null) as (number | null)[]];
        series = [
          {},
          { label: 'tide', stroke: tideColor, width: 2, fill: `${tideColor}22`, value: (_u, v) => (v == null ? '—' : `${v.toFixed(1)} m`) },
        ];
      } else if (panel.glyph) {
        // Direction: no linear y-axis (it's cyclical). A constant series (0.5 on a [0,1]
        // scale) feeds uPlot's cursor index and pins the crosshair dot to the centred
        // row; the arrows themselves are painted in the draw hook. Rotation + colour carry
        // the direction, so the row needs no y-scale of its own.
        const dirArr = pgcols[panel.series[0].key] ?? [];
        chartData = [pgxs, dirArr.map((v) => (v == null ? null : 0.5))];
        series = [
          {},
          { label: panel.series[0].key, stroke: 'transparent', width: 0, points: { show: false }, paths: () => null, value: (_u, _v, _si, di) => (di == null || dirArr[di] == null ? '—' : `${Math.round(dirArr[di]!)}°`) },
        ];
      } else {
        chartData = [pgxs, ...panel.series.map((srs) => plotted(srs.key))];
        series = [
          {},
          ...panel.series.map((srs) => {
            const color = cssVar(srs.colorVar);
            const base: uPlot.Series = { label: srs.key, stroke: color, width: srs.width ?? 2, value: (_u, v) => (v == null ? '—' : v.toFixed(1)) };
            if (srs.fill) base.fill = color + '22';
            if (srs.dash) base.dash = srs.dash;
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
      } else if (panel.zeroBased) {
        // Hide the sub-zero splits the range's bottom sliver introduces (see the scale below).
        yAxis.filter = (_u, splits) => splits.map((v) => (v < 0 ? null : v));
      }

      const xAxis: uPlot.Axis = {
        scale: 'x',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
        font: '12px IBM Plex Mono, monospace',
        show: isLast,
        size: isLast ? 38 : 8,
        values: (_u, splits, _ai, _space, incr) => splits.map((sp) => fmtAxisTick(sp * 1000, locale, tz, incr, units.clock)),
      };

      // On-plot cursor value: a small pill riding the crosshair that shows THIS panel's value as you
      // move along x — the readout "direct sur le plot" (spec 0013 rev). The element is created after
      // the plot (appended to u.over) and referenced here through the mutable holder.
      const cursorVal: { el: HTMLElement | null } = { el: null };
      const bubbleText = (idx: number): string => {
        if (panel.tide) {
          const h = tideCurve.h[idx];
          return h == null ? '' : `${fmtNumber(h, locale, 1)} m`;
        }
        const k = panel.series[0].key;
        const v = pgcols[k]?.[idx];
        if (v == null) return '';
        if (panel.glyph) return `${compass(v, locale)} · ${Math.round(v)}°`;
        const kind = measureKind(k);
        if (kind) return `${formatKeyValue(k, v, units, locale)} ${measureSuffix(kind, units)}`;
        const suf = FIXED_UNIT[k];
        return `${fmtNumber(v, locale, 1)}${suf ? ` ${suf}` : ''}`;
      };

      const hooks: uPlot.Hooks.Arrays = {
        // The tide + Air panels sit on their own x-grid, so their cursor idx would corrupt the
        // shared (buoy gxs-indexed) hover card, so only the buoy panels drive the card — but EVERY
        // panel updates its own on-plot bubble, and hovering any panel still moves every crosshair.
        setCursor: [
          (u) => {
            const el = cursorVal.el;
            if (el) {
              const idx = u.cursor.idx;
              const left = u.cursor.left;
              const txt = idx == null || left == null || left < 0 ? '' : bubbleText(idx);
              if (txt) {
                el.textContent = txt;
                el.style.left = `${left}px`;
                el.style.opacity = '1';
              } else {
                el.style.opacity = '0';
              }
            }
            if (!(panel.tide || air)) renderCard(u.cursor.idx);
          },
        ],
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
        const dirArr = pgcols[panel.series[0].key] ?? [];
        hooks.draw = [(u) => drawArrowGlyphs(u, pgxs, dirArr, DPR)];
      }
      if (panel.tide && tideNarrow && tideEvents.length) {
        hooks.draw = [(u) => drawTideMarkers(u, tideEvents, tideColor, DPR)];
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
              ? {
                  // Anchored at 0, but with a sliver of scale BELOW it: with the floor exactly on the
                  // plot's bottom edge a flat 0 line (rain: dry) is drawn half-clipped into the axis and
                  // the "0" tick label loses its lower half. The axis filter hides the negative splits.
                  range: (_u: uPlot, _dMin: number, dMax: number): [number, number] => {
                    const top = Math.max(dMax || 0, 1) * 1.12;
                    return [-top * 0.08, top];
                  },
                }
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

      // The on-plot value bubble (see setCursor above): appended into the cursor layer so its left
      // offset lines up with the crosshair; hidden until the cursor enters the plot.
      const bubble = document.createElement('div');
      const bColor = cssVar(panel.series[0].colorVar);
      bubble.setAttribute('aria-hidden', 'true');
      bubble.style.cssText = `position:absolute;top:2px;transform:translateX(-50%);pointer-events:none;opacity:0;transition:opacity .08s ease;white-space:nowrap;z-index:6;padding:3px 7px;border-radius:6px;font:600 0.82rem/1 var(--font-mono);background:color-mix(in oklab, var(--surface) 86%, transparent);color:${bColor};border:1px solid color-mix(in oklab, ${bColor} 42%, var(--hairline));`;
      u.over.appendChild(bubble);
      cursorVal.el = bubble;

      if (panel.emptyKey && !hasData) {
        const overlay = document.createElement('div');
        overlay.className = 'chart-empty';
        overlay.style.bottom = isLast ? '38px' : '0';
        overlay.textContent = m[panel.emptyKey]();
        wrap.appendChild(overlay);
      }
    });

    const timeTag = document.createElement('div');
    timeTag.setAttribute('aria-hidden', 'true');
    timeTag.style.cssText =
      'position:absolute;z-index:50;pointer-events:none;opacity:0;transition:opacity .08s ease;white-space:nowrap;transform:translate(-50%,0);padding:2px 7px;border-radius:6px;font:500 0.74rem/1.25 var(--font-mono);color:var(--text-2);background:color-mix(in oklab, var(--surface) 92%, transparent);border:1px solid var(--hairline);';
    host.appendChild(timeTag);
    const moveTimeTag = (e: PointerEvent) => {
      const u0 = plots[0];
      if (!u0) return;
      // Every panel shares one x-scale and one width, so plot 0 converts the pointer to a time.
      const pr = u0.over.getBoundingClientRect();
      const px = e.clientX - pr.left;
      if (px < 0 || px > pr.width) {
        timeTag.style.opacity = '0';
        return;
      }
      // Snap to the buoy grid, the same index the readout card and the value bubbles report — a
      // free-running pixel time would read 06:54 beside a card saying 07:00.
      const t = u0.posToVal(px, 'x');
      let lo = 0;
      let hi = gxs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (gxs[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && Math.abs(gxs[lo - 1] - t) < Math.abs(gxs[lo] - t)) lo -= 1;
      const hr = host.getBoundingClientRect();
      timeTag.textContent = fmtDateTime((gxs.length ? gxs[lo] : t) * 1000, locale, tz, units.clock);
      timeTag.style.left = `${e.clientX - hr.left}px`;
      timeTag.style.top = `${e.clientY - hr.top + 16}px`;
      timeTag.style.opacity = '1';
    };
    const hideTimeTag = () => {
      timeTag.style.opacity = '0';
    };
    host.addEventListener('pointermove', moveTimeTag);
    host.addEventListener('pointerleave', hideTimeTag);

    plotsRef.current = plots;
    // Release the pin only once the rebuilt stack has been laid out — the panels are still
    // collapsed this tick, so clearing it here would expose a short document and the scroll would
    // clamp (a scrollTo issued against that stale layout is clamped too, which is why we wait).
    const releaseHeight = requestAnimationFrame(() => {
      host.style.minHeight = '';
      if (window.scrollY !== prevScroll) window.scrollTo(window.scrollX, prevScroll);
    });
    if (focusBandRef.current) {
      bandEls.get(focusBandRef.current)?.focus({ preventScroll: true });
      focusBandRef.current = null;
    }
    baseScaleRef.current = { min: xmin - xpad, max: xmax + xpad };
    if (plots[0]) renderDayOverlay(plots[0]);

    // A finished drag/pinch zoom lives only in uPlot's x-scale (transient — see the
    // touch plugin + uPlot's own drag). Commit the narrowed window to `range` so the
    // matching finer tier (30-min / hourly) loads and the chart redraws at full detail.
    // Deferred a frame so uPlot's own zoom has applied the scale before we read it; only
    // a real zoom-IN commits — a plain click leaves the scale at the padded base (wider
    // than the window), so the width test skips it. Reset/preset chips undo it.
    let raf = 0;
    const commitGesture = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const u = plots[0];
        if (!u || u.scales.x.min == null || u.scales.x.max == null) return;
        if (u.scales.x.max - u.scales.x.min >= xmax - xmin - 1) return; // not a zoom-in
        apply(Math.round(u.scales.x.min), Math.round(u.scales.x.max), 'custom', true);
      });
    };
    host.addEventListener('mouseup', commitGesture);
    host.addEventListener('touchend', commitGesture);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      for (const p of plots) p.setSize({ width: w, height: p.height });
      if (plots[0]) renderDayOverlay(plots[0]); // widths changed → recompute line x
    });
    ro.observe(host);

    return () => {
      cancelDrag(); // a drag in flight would outlive the elements it dims
      // Destroying the plots empties the host: hold its height so the page doesn't shrink under
      // the reader (the rebuild that follows releases the pin). See the top of this effect.
      cancelAnimationFrame(releaseHeight);
      host.style.minHeight = `${host.offsetHeight}px`;
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', moveTimeTag);
      host.removeEventListener('pointerleave', hideTimeTag);
      host.removeEventListener('mouseup', commitGesture);
      host.removeEventListener('touchend', commitGesture);
      ro.disconnect();
      for (const p of plots) p.destroy();
      plotsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, detail, windHistory, windDetail, windStation, visibleFlat, theme, locale, units, range.min, range.max, smooth, tz, tides]);

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
            <button
              key={s}
              type="button"
              className={chipCls(smooth === s)}
              onClick={() => {
                try {
                  localStorage.setItem(SMOOTH_STORE, s);
                } catch {
                  /* storage unavailable — the choice still applies for this session */
                }
                setSmooth(s);
              }}
            >
              {m[`chart_smooth_${s}` as MessageKey]()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-[0.4rem]" role="group" aria-label={m.chart_navigate()}>
          <button type="button" disabled={atStart} className={cn(chipCls(false), navBtn)} onClick={() => panBy(-0.5)} aria-label={m.chart_pan_back()} title={m.chart_pan_back()}>
            ‹
          </button>
          <button type="button" className={cn(chipCls(false), navBtn)} onClick={() => zoomBy(2)} aria-label={m.chart_zoom_out()} title={m.chart_zoom_out()}>
            −
          </button>
          <button type="button" className={cn(chipCls(false), navBtn)} onClick={() => zoomBy(0.5)} aria-label={m.chart_zoom_in()} title={m.chart_zoom_in()}>
            +
          </button>
          <button type="button" disabled={atEnd} className={cn(chipCls(false), navBtn)} onClick={() => panBy(0.5)} aria-label={m.chart_pan_forward()} title={m.chart_pan_forward()}>
            ›
          </button>
          <button type="button" className={cn(chipCls(false), navBtn)} onClick={resetZoom} aria-label={m.chart_reset()} title={m.chart_reset()}>
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
          <span className="hover-time font-mono text-[0.92rem] text-fg" />
          <span className="shrink-0 cursor-help whitespace-nowrap font-mono text-[0.7rem] text-faint" title={m.time_buoy_local()}>
            ◷ {tz}
          </span>
        </div>
        <div className="hover-stats grid grid-cols-3 gap-x-4 gap-y-[0.35rem] max-[560px]:grid-cols-2 max-[380px]:grid-cols-1" />
      </div>
      {/* Series manager (spec 0013): hidden panels sit here as chips (click to restore); each
          visible panel has a drag handle to reorder + an eye to hide. Order + hidden persist. */}
      <div className="mb-[0.7rem] flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.66rem] uppercase tracking-[0.06em] text-faint">{m.ts_manage_hint()}</span>
        {hiddenUnits.length > 0 && (
          <>
            <span className="mx-1 h-3 w-px bg-divider" aria-hidden="true" />
            <span className="font-mono text-[0.66rem] uppercase tracking-[0.06em] text-faint">{m.ts_hidden()}:</span>
            {hiddenUnits.map((id) => {
              const p = panelById.get(id);
              if (!p) return null;
              const c = REALM_COLOR[p.realm];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => showUnit(id)}
                  aria-label={`${m.ts_show()} · ${m[p.titleKey]()}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 font-mono text-[0.72rem] text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ borderColor: `color-mix(in oklab, ${c} 40%, var(--hairline))` }}
                >
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: c }} aria-hidden="true" />
                  {m[p.titleKey]()}
                  <span className="text-faint" aria-hidden="true">+</span>
                </button>
              );
            })}
          </>
        )}
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

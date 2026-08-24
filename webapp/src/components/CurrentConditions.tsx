// Current Conditions — the live block at the top of the page.
//
// Two realm ZONES (Mer = teal, Air = amber) joined by the offshore/onshore verdict; the colour +
// glyph system is spec 0013. **Spec 0015** tightened the density: the dial shrank and stopped
// repeating the numbers it already prints, every measure became the same `Metric` tile in one
// full grid (no capped half-row), and the verdict moved into the header row. It stays a pure
// REAL-TIME snapshot — no trends, no history; that is what the chart stack below is for.

import type { ReactNode } from 'react';
import { useLocale, type Locale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { lastValue, latestTimestamp, type Manifest, type Series, type WindData } from '../lib/data';
import { compass, dirColor, fmtNumber, fmtClock, freshness, relativeAgo, type Freshness } from '../lib/format';
import { shoreRelation, shoreColorVar } from '../lib/wind';
import { stationInfo } from '../lib/stations';
import { useUnits, formatKeyValue, keySuffix } from '../lib/units';
import { useNow } from '../lib/useNow';
import {
  WaveHeightIcon, MaxWaveIcon, PeriodIcon, DirectionIcon, TempIcon,
  WindIcon, StationIcon, RainIcon, HumidityIcon, PressureIcon,
} from './icons';
import { BuoyMark } from './brands';
import InfoPopover from './InfoPopover';
import TideStrip from './TideStrip';
import type { Tides } from '../lib/tides';

const LABEL_ICON = 'mr-1.5 shrink-0';
// Inside a Metric label the icon sits in an inline wrapper that carries the gap, so the icon
// itself must not add one (see Metric).
const TILE_ICON = 'shrink-0';

// Annular ("ring") sector centred on "up" in the dial's local frame, half-angle =
// spread, drawn between radii ri..ro so it stays in the outer ring and never covers
// the centre readout. The group is rotated to the swell's from-direction.
function conePath(cx: number, cy: number, ri: number, ro: number, halfDeg: number): string {
  const half = Math.min(Math.max(halfDeg, 2), 80);
  const a1 = ((-90 - half) * Math.PI) / 180;
  const a2 = ((-90 + half) * Math.PI) / 180;
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(ro, a1)} A${ro} ${ro} 0 0 1 ${p(ro, a2)} L${p(ri, a2)} A${ri} ${ri} 0 0 0 ${p(ri, a1)} Z`;
}

/** Compass rose. `color` overrides the cyclical direction hue (used by the Air realm to fix the
 *  wind arrow to amber); `second` draws a faint secondary marker (the gust direction).
 *  Sized down to 128px by spec 0015 — it used to own a 176px column for one value, and the
 *  cardinal + degrees it prints are now the ONLY place those two appear. */
function CompassDial({
  deg, spread, locale, color, second,
}: { deg: number | null; spread: number | null; locale: Locale; color?: string; second?: number | null }) {
  const dirText = deg != null ? compass(deg, locale) : '—';
  const hue = color ?? (deg != null ? dirColor(deg) : null);
  return (
    <div className="relative aspect-square w-full max-w-[128px]" role="img" aria-label={deg != null ? `from ${compass(deg, locale)}` : 'no direction'}>
      <svg viewBox="0 0 120 120" width="100%" height="100%">
        <circle cx="60" cy="60" r="56" className="fill-none stroke-line [stroke-width:2]" />
        {['N', 'E', 'S', 'W'].map((c, i) => {
          const a = (i * 90 - 90) * (Math.PI / 180);
          // Cardinals carry the cyclical direction colour code (N teal · E blue · S gold · W pink),
          // identical on the swell and wind dials — direction is encoded by hue, realm by the zone
          // (spec 0013 revision). So wind direction reads "which way" at a glance, like the swell.
          return (
            <text key={c} x={60 + Math.cos(a) * 51} y={60 + Math.sin(a) * 51 + 3.5} className="font-mono text-[10px] font-semibold" textAnchor="middle" style={{ fill: dirColor(i * 90) }}>
              {locale === 'en' ? c : c === 'W' ? 'O' : c}
            </text>
          );
        })}
        {second != null && (
          <g transform={`rotate(${second + 180} 60 60)`}>
            <path d="M60 16 L56 29 L64 29 Z" style={hue ? { fill: hue, opacity: 0.4 } : undefined} className="fill-accent [opacity:0.4]" />
          </g>
        )}
        {deg != null && (
          <g transform={`rotate(${deg + 180} 60 60)`}>
            {spread != null && <path d={conePath(60, 60, 30, 50, spread)} style={hue ? { fill: `${hue}33` } : undefined} />}
            <path d="M60 13 L54.5 31 L65.5 31 Z" className="fill-accent" style={hue ? { fill: hue } : undefined} />
          </g>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[0.05rem]">
        <span className="font-display text-[1.35rem] font-bold leading-none tracking-[-0.01em] text-fg">{dirText}</span>
        {deg != null && <span className="font-mono text-[0.74rem] leading-none text-muted">{Math.round(deg)}°</span>}
      </div>
    </div>
  );
}

/**
 * One measure: label + value. Every reading in both zones is this same tile (spec 0015) — the
 * wave-height hero differs only in TYPE SIZE, not in structure, so the two zones share one grid
 * rhythm instead of a hero block plus two mismatched gauge rows.
 *
 * The label reserves two lines (`min-h`): several are long once translated, and letting them
 * wrap freely would stagger the value baselines across a row. `title` lets a tile show a short
 * label while the popover still names the measure in full (the two temperatures) — the Air row
 * only packs six-up because "Température de l'air" isn't printed in a 120px column.
 *
 * **The type scales with the TILE, not the viewport** (spec 0015 §2). Every tile is a
 * `@container`, so `cqw` resolves against its own grid cell: a Mer cell is ~190px and a six-up
 * Air cell ~124px at the same window, and a fixed size that filled one left the other looking
 * empty. Viewport units can't do this — the page is capped at `max-w-[1100px]`, so past ~1140px
 * a `vw`-sized number stops tracking the box it sits in entirely.
 */
// The percentages are set by the WIDEST string each tile must hold without wrapping — Air's
// "1 020 hPa" is why its floor can't rise, Mer's four-up cell is why its ceiling can. The max
// stops a one-column phone tile (~300px) from rendering a 60px number.
const VALUE_SIZE = 'text-[clamp(1.55rem,20cqw,2.35rem)]';
const VALUE_SIZE_HERO = 'text-[clamp(2.4rem,30cqw,3.6rem)]';
const UNIT_SIZE = 'text-[clamp(0.85rem,9cqw,1.15rem)]';
const UNIT_SIZE_HERO = 'text-[clamp(1rem,11cqw,1.5rem)]';

function Metric({
  label, value, unit, defKey, accent, icon, hero = false, title,
}: { label: string; value: string; unit?: string; defKey: MessageKey; accent?: string; icon?: ReactNode; hero?: boolean; title?: string }) {
  // Alignment is inherited from the grid (TILE_COL): left-aligned from 720px up, centred below —
  // where the zone stacks under a centred dial and a left column would read as mis-set (0017 §3).
  return (
    <div className="@container grid min-w-0 grid-rows-subgrid gap-[0.15rem] [grid-row:span_2]">
      {/* Inline flow, NOT flex: in a flex row the label text takes the whole line box, so once it
          wraps to two lines the `i` badge is shoved to the far right and reads as belonging to
          nothing. Inline, the icon · label · badge wrap together as one phrase. */}
      <span className="block self-start text-[0.66rem] uppercase leading-[1.2] tracking-[0.04em] text-faint">
        <span className="mr-1.5 inline-block align-[-0.2em]">{icon}</span>
        {label}
        <InfoPopover title={title ?? label} body={m[defKey]()} />
      </span>
      <span
        className={`self-end font-display leading-none [font-feature-settings:'tnum'] ${hero ? `${VALUE_SIZE_HERO} font-bold tracking-[-0.02em]` : `${VALUE_SIZE} font-medium`}`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
        {unit && <span className={`text-muted ${hero ? `ml-[0.15rem] ${UNIT_SIZE_HERO}` : UNIT_SIZE}`}> {unit}</span>}
      </span>
    </div>
  );
}

/** A small "comes-from" arrow for the offshore/onshore bridge (realm-coloured). */
function MiniArrow({ deg, color }: { deg: number | null; color: string }) {
  if (deg == null) return <span className="text-faint">—</span>;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`rotate(${deg} 12 12)`}>
        <path d="M12 3 L8 12 L12 10 L16 12 Z" style={{ fill: color }} />
        <line x1="12" y1="10" x2="12" y2="20.5" style={{ stroke: color }} strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

type Realm = 'sea' | 'air';

const ZONE: Record<Realm, string> = {
  sea: 'border-[color-mix(in_oklab,var(--accent)_22%,var(--hairline))] bg-[color-mix(in_oklab,var(--accent)_6%,var(--surface))]',
  air: 'border-[color-mix(in_oklab,var(--c-wind)_24%,var(--hairline))] bg-[color-mix(in_oklab,var(--c-wind)_7%,var(--surface))]',
};

/** Zone header: a coloured realm tag + a source chip (buoy or station attribution), and — since
 *  spec 0015 §7 — that realm's own freshness badge, pushed to the trailing edge. Each realm
 *  answers for its own source: the buoy and the station fail independently (CANDHIS can freeze
 *  for hours while Météo-France keeps reporting), so one shared badge could only ever be right
 *  about one of them. `min-[720px]:ml-auto` rather than a plain `ml-auto` — below 720px the whole
 *  header centres (spec 0017) and an auto margin would break that. */
function ZoneHeader({ realm, tag, badge, children }: { realm: Realm; tag: string; badge?: ReactNode; children: ReactNode }) {
  const bg = realm === 'sea' ? 'var(--accent)' : 'var(--c-wind)';
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 max-[720px]:justify-center max-[720px]:text-center">
      <span className="rounded-md px-2 py-[0.1rem] font-display text-[0.72rem] font-bold uppercase tracking-[0.05em]" style={{ background: bg, color: '#08201a' }}>
        {tag}
      </span>
      <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem] text-muted">{children}</span>
      {badge && <span className="min-[720px]:ml-auto">{badge}</span>}
    </div>
  );
}

/** The single caption under a dial: the direction label + its definition, then the realm's
 *  secondary direction fact (swell spread / gust direction). It no longer repeats the cardinal
 *  and degrees the dial already prints — that redundancy was a whole extra line (spec 0015). */
function DialCaption({ label, defKey, icon, children }: { label: string; defKey: MessageKey; icon: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-[0.1rem] text-center leading-tight">
      <span className="inline-flex items-baseline text-[0.78rem] text-muted">
        {icon}
        {label}
        <InfoPopover title={label} body={m[defKey]()} />
      </span>
      {children}
    </div>
  );
}

// `flex-wrap` + `max-w-full`: the pill holds two nowrap spans ("il y a 31 minutes" · "10 août,
// 18:00") that together are ~310px — wider than a 320px phone, and it overflowed the page rather
// than breaking between them (spec 0017 §2).
const STATUS_BADGE = 'inline-flex max-w-full flex-wrap items-center justify-center gap-x-[0.45rem] rounded-full border bg-surface-2 px-[0.7rem] py-[0.32rem] font-mono text-[0.78rem] text-muted cursor-pointer transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const STATUS_BORDER: Record<Freshness, string> = {
  fresh: 'border-[color-mix(in_oklab,var(--accent)_45%,var(--hairline))]',
  aging: 'border-[color-mix(in_oklab,var(--warning)_50%,var(--hairline))]',
  stale: 'border-[color-mix(in_oklab,var(--text-3)_45%,var(--hairline))]',
};
const STATUS_DOT: Record<Freshness, string> = {
  fresh: 'bg-accent motion-safe:animate-[pulse_2.4s_ease-out_infinite]',
  aging: 'bg-warning',
  stale: 'bg-faint',
};

function StalenessBadge({ realm, fresh, stampMs, tz, now }: { realm: Realm; fresh: Freshness; stampMs: number | null; tz: string; now: number }) {
  const { locale } = useLocale();
  const { units } = useUnits();
  const ago = stampMs != null ? relativeAgo(stampMs, locale, now) : null;
  const clock = stampMs != null ? fmtClock(stampMs, locale, tz, units.clock) : null;
  // The help text is source-agnostic; the reporting cadence that explains the age is what
  // differs between the realms (buoy every 30 min vs station every 6 min behind our refresh).
  const help = `${m[`cc_${fresh}_help` as MessageKey]()} ${m[`cc_cadence_${realm}` as MessageKey]()}`;
  const body = stampMs != null ? `${help} · ${m.cc_updated()} ${clock}` : help;
  const realmLabel = realm === 'sea' ? m.cc_realm_sea() : m.cc_realm_air();
  return (
    <InfoPopover title={`${realmLabel} · ${m[`cc_${fresh}` as MessageKey]()}`} body={body} align="end" triggerClassName={`${STATUS_BADGE} ${STATUS_BORDER[fresh]}`} triggerLabel={`${m.cc_freshness()} · ${realmLabel}`}>
      <span className={`h-[9px] w-[9px] rounded-full ${STATUS_DOT[fresh]}`} aria-hidden="true" />
      {ago && <span className="whitespace-nowrap">{ago}</span>}
      {clock && <span className="whitespace-nowrap text-faint">· {clock}</span>}
    </InfoPopover>
  );
}

/** The offshore/onshore verdict — the only cross-realm synthesis (station wind × buoy swell).
 *  Spec 0015 folded it into the card's header row: as its own full-width band it was three
 *  tokens and a pill on an otherwise empty line. */
function ShoreBridge({ swellDeg, windDeg, locale }: { swellDeg: number | null; windDeg: number | null; locale: Locale }) {
  const shore = shoreRelation(windDeg, swellDeg);
  const label = shore === 'offshore' ? m.cc_offshore() : shore === 'onshore' ? m.cc_onshore() : m.cc_cross_shore();
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="inline-flex items-center gap-1 font-mono text-[0.74rem] text-muted">
        <MiniArrow deg={swellDeg} color="var(--accent)" />
        {m.cc_swell()} {swellDeg != null && compass(swellDeg, locale)}
      </span>
      <span className="font-mono text-[0.72rem] text-faint">/</span>
      <span className="inline-flex items-center gap-1 font-mono text-[0.74rem] text-muted">
        <MiniArrow deg={windDeg} color="var(--c-wind)" />
        {m.cc_wind()} {windDeg != null && compass(windDeg, locale)}
      </span>
      {shore ? (
        // Softened verdict: a tinted pill with the shore colour as text + border, not a loud
        // solid fill — onshore's red in particular read as an alarm at full strength (spec 0013 rev).
        <span
          className="inline-flex items-center gap-1 rounded-full border px-2.5 py-[0.22rem] font-display text-[0.84rem] font-bold"
          style={{
            color: `var(${shoreColorVar(shore)})`,
            background: `color-mix(in oklab, var(${shoreColorVar(shore)}) 14%, var(--surface))`,
            borderColor: `color-mix(in oklab, var(${shoreColorVar(shore)}) 42%, var(--hairline))`,
          }}
        >
          {label}
          <InfoPopover title={m.cc_shore()} body={m.def_offshore()} triggerClassName="opacity-60 hover:opacity-100" />
        </span>
      ) : (
        <span className="font-mono text-[0.74rem] text-faint">{m.cc_shore()} —</span>
      )}
    </div>
  );
}

// Zone body: a narrow dial column + the tile grid. `items-center` keeps the tiles optically
// centred against the taller dial, so the dial's spare height reads as padding, not a hole.
const ZONE_GRID = 'grid grid-cols-[minmax(120px,0.4fr)_2.7fr] items-center gap-x-5 gap-y-4 max-[720px]:grid-cols-1 max-[720px]:justify-items-center';
// Below 720px the zone stacks under a CENTRED dial, so the tiles centre too (spec 0017 §3) — a
// left-aligned column under a centred dial reads as mis-set, which is exactly what it looked like.
// From 720px up the 0015 rule stands unchanged: left-aligned, values on a subgrid baseline.
// (`text-center` only — NOT `justify-items-center`: each tile is a `@container`, and shrink-wrapping
// a size-contained box collapses it, taking the `cqw` type scale down with it.)
const TILE_COL = 'border-l border-line pl-5 max-[720px]:w-full max-[720px]:border-l-0 max-[720px]:pl-0 max-[720px]:text-center';
// Sea 4-up, Air 6-up — each fills its grid EDGE TO EDGE at every breakpoint. No ragged last row,
// no `max-w` cap leaving half a row blank (what made the old Air zone read as empty), and no
// over-wide columns leaving rivers of white between the values.
// `auto-rows-auto` + each tile spanning two rows and adopting them via `grid-rows-subgrid` aligns
// every value baseline across a row WITHOUT reserving space: the label track is exactly as tall as
// the tallest label in that row. A `min-h` on the label did the same job but cost a blank line's
// height whenever no label actually wrapped, which is the common case.
// Sea keeps TWO columns to the narrowest phone (spec 0017 §3): one column left a hero value alone
// on a full-width row with an empty half beside it. The width freed in §2 pays for the second.
const SEA_TILES = `grid auto-rows-auto grid-cols-4 gap-x-5 gap-y-4 max-[1000px]:grid-cols-2 max-[420px]:gap-x-3 ${TILE_COL}`;
const AIR_TILES = `grid auto-rows-auto grid-cols-6 gap-x-4 gap-y-4 max-[1000px]:grid-cols-3 max-[560px]:grid-cols-2 max-[420px]:gap-x-3 ${TILE_COL}`;

export default function CurrentConditions({
  latest, manifest, tides, wind,
}: { latest: Series; manifest: Manifest; tides: Tides | null; wind: WindData | null }) {
  const { locale } = useLocale();
  const { units } = useUnits();
  const tz = manifest.timezone;
  const now = useNow(30_000);

  // Sea (buoy) realm
  const hs = lastValue(latest, 'significant_wave_height_m');
  const hmax = lastValue(latest, 'max_wave_height_m');
  const period = lastValue(latest, 'significant_period_s');
  const dir = lastValue(latest, 'peak_direction_deg');
  const spread = lastValue(latest, 'peak_directional_spread_deg');
  const seaTemp = lastValue(latest, 'sea_temperature_c');

  // Air (station) realm
  const wl = wind?.latest;
  const windSpeed = wl ? lastValue(wl, 'wind_speed_ms') : null;
  const windDir = wl ? lastValue(wl, 'wind_direction_deg') : null;
  const gust = wl ? lastValue(wl, 'wind_gust_ms') : null;
  const gustDir = wl ? lastValue(wl, 'wind_gust_direction_deg') : null;
  const airTemp = wl ? lastValue(wl, 'air_temperature_c') : null;
  const rain = wl ? lastValue(wl, 'precipitation_mm') : null;
  const humidity = wl ? lastValue(wl, 'humidity_pct') : null;
  const pressure = wl ? lastValue(wl, 'pressure_msl_hpa') : null;

  const num = (v: { value: number } | null, digits = 1) => (v ? fmtNumber(v.value, locale, digits) : '—');
  // Units-aware value for the convertible measures (speed · temperature · pressure) — spec 0014.
  // The matching unit suffix comes from keySuffix(key, units).
  const fmtU = (v: { value: number } | null, key: string) => (v ? formatKeyValue(key, v.value, units, locale) : '—');

  // One stamp PER REALM (spec 0015 §7). The two sources are unrelated feeds on unrelated
  // cadences and they stall independently, so neither one may stand in for the other.
  const seaStampMs = latestTimestamp(latest);
  const seaFresh = seaStampMs != null ? freshness(now - seaStampMs) : 'stale';
  const airStampMs = wl ? latestTimestamp(wl) : null;
  const airFresh = airStampMs != null ? freshness(now - airStampMs) : 'stale';

  const kind = wind ? stationInfo(wind.station)?.kind : undefined;
  const kindLabel = kind ? m[`station_kind_${kind.replaceAll('-', '_')}` as MessageKey]() : '';

  return (
    <section
      aria-label={m.cc_title()}
      className="relative flex flex-col gap-2 rounded-2xl border border-line bg-surface px-3 pb-4 pt-3.5 shadow-[0_0_40px_-28px_var(--accent)] sm:px-5 sm:pb-5 sm:pt-4"
    >
      {/* Header row: identity · the cross-realm verdict. The verdict rides here rather than in its
          own band (spec 0015); below 860px it drops to its own full-width line. Freshness used to
          sit here too, as ONE badge fed by the buoy alone — it now lives per zone (spec 0015 §7). */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="font-mono text-[0.74rem] uppercase tracking-[0.08em] text-faint">
          {m.cc_title()}
          <span className="text-muted"> · {manifest.buoy.name}</span>
        </span>
        {wind && (
          <div className="max-[860px]:order-3 max-[860px]:basis-full">
            <ShoreBridge swellDeg={dir?.value ?? null} windDeg={windDir?.value ?? null} locale={locale} />
          </div>
        )}
      </div>

      {/* ---- MER (buoy) zone ---- */}
      <div className={`rounded-xl border p-2.5 sm:p-3.5 ${ZONE.sea} ${seaFresh === 'stale' ? 'saturate-[0.55]' : ''}`}>
        <ZoneHeader realm="sea" tag={m.cc_realm_sea()} badge={<StalenessBadge realm="sea" fresh={seaFresh} stampMs={seaStampMs} tz={tz} now={now} />}>
          <BuoyMark size={15} className="text-accent" />
          {m.cc_buoy()} {manifest.buoy.campaign_id} · {manifest.buoy.network}
        </ZoneHeader>
        <div className={ZONE_GRID}>
          <div className="flex flex-col items-center gap-1.5">
            <CompassDial deg={dir?.value ?? null} spread={spread?.value ?? null} locale={locale} />
            <DialCaption label={m.cc_direction()} defKey="def_direction" icon={<DirectionIcon className={LABEL_ICON} style={{ color: 'var(--c-dir)' }} />}>
              {spread && (
                <span className="inline-flex items-center whitespace-nowrap font-mono text-[0.76rem] text-faint">
                  {m.cc_spread()} ±{Math.round(spread.value)}°
                  <InfoPopover title={m.cc_spread()} body={m.def_spread()} />
                </span>
              )}
            </DialCaption>
          </div>
          <div className={SEA_TILES}>
            <Metric label={m.cc_wave_height()} value={num(hs)} unit="m" defKey="def_wave_height" accent="var(--accent)" hero icon={<WaveHeightIcon className={TILE_ICON} style={{ color: 'var(--c-height)' }} />} />
            <Metric label={m.cc_max_wave()} value={num(hmax)} unit="m" defKey="def_max_wave" icon={<MaxWaveIcon className={TILE_ICON} style={{ color: 'var(--c-max)' }} />} />
            <Metric label={m.cc_period()} value={num(period)} unit="s" defKey="def_period" icon={<PeriodIcon className={TILE_ICON} style={{ color: 'var(--c-period)' }} />} />
            <Metric label={m.cc_sea_temp_short()} title={m.cc_sea_temp()} value={fmtU(seaTemp, 'sea_temperature_c')} unit={keySuffix('sea_temperature_c', units) ?? undefined} defKey="def_sea_temp" accent="var(--accent)" icon={<TempIcon className={TILE_ICON} style={{ color: 'var(--accent)' }} />} />
          </div>
        </div>
      </div>

      {/* ---- AIR (station) zone ---- */}
      {wind ? (
        <div className={`rounded-xl border p-2.5 sm:p-3.5 ${ZONE.air} ${airFresh === 'stale' ? 'saturate-[0.55]' : ''}`}>
          <ZoneHeader realm="air" tag={m.cc_realm_air()} badge={<StalenessBadge realm="air" fresh={airFresh} stampMs={airStampMs} tz={tz} now={now} />}>
            <StationIcon size={15} style={{ color: 'var(--c-wind)' }} />
            {m.cc_station()} {wind.manifest.station.label} <span className="text-faint">· {fmtNumber(wind.distanceKm, locale, 1)} km{kindLabel ? ` · ${kindLabel}` : ''} · {wind.manifest.source.provider}</span>
          </ZoneHeader>
          <div className={ZONE_GRID}>
            <div className="flex flex-col items-center gap-1.5">
              <CompassDial deg={windDir?.value ?? null} spread={null} second={gustDir?.value ?? null} locale={locale} />
              <DialCaption label={m.cc_wind_dir()} defKey="def_wind" icon={<WindIcon className={LABEL_ICON} style={{ color: 'var(--c-wind)' }} />}>
                {gustDir && (
                  <span className="whitespace-nowrap font-mono text-[0.76rem] text-faint">
                    {m.cc_gust().toLowerCase()} {compass(gustDir.value, locale)} · {Math.round(gustDir.value)}°
                  </span>
                )}
              </DialCaption>
            </div>
            <div className={AIR_TILES}>
              <Metric label={m.cc_wind()} value={fmtU(windSpeed, 'wind_speed_ms')} unit={keySuffix('wind_speed_ms', units) ?? undefined} defKey="def_wind" accent="var(--c-wind)" icon={<WindIcon className={TILE_ICON} style={{ color: 'var(--c-wind)' }} />} />
              <Metric label={m.cc_gust()} value={fmtU(gust, 'wind_gust_ms')} unit={keySuffix('wind_gust_ms', units) ?? undefined} defKey="def_gust" icon={<WindIcon className={TILE_ICON} style={{ color: 'var(--c-wind)', opacity: 0.7 }} />} />
              <Metric label={m.cc_air_temp_short()} title={m.cc_air_temp()} value={fmtU(airTemp, 'air_temperature_c')} unit={keySuffix('air_temperature_c', units) ?? undefined} defKey="def_air_temp" accent="var(--c-airtemp)" icon={<TempIcon className={TILE_ICON} style={{ color: 'var(--c-airtemp)' }} />} />
              <Metric label={m.cc_rain()} value={num(rain)} unit="mm/h" defKey="def_rain" icon={<RainIcon className={TILE_ICON} style={{ color: 'var(--c-period)' }} />} />
              <Metric label={m.cc_humidity()} value={humidity ? fmtNumber(humidity.value, locale, 0) : '—'} unit={humidity ? '%' : undefined} defKey="def_humidity" icon={<HumidityIcon className={TILE_ICON} style={{ color: 'var(--c-tide)' }} />} />
              <Metric label={m.cc_pressure()} value={fmtU(pressure, 'pressure_msl_hpa')} unit={pressure ? keySuffix('pressure_msl_hpa', units) ?? undefined : undefined} defKey="def_pressure" icon={<PressureIcon className={TILE_ICON} style={{ color: 'var(--c-dir)' }} />} />
            </div>
          </div>
        </div>
      ) : (
        <div className={`flex items-center gap-2.5 rounded-xl border border-dashed p-2.5 sm:p-3.5 ${ZONE.air}`}>
          <StationIcon size={16} style={{ color: 'var(--c-wind)' }} />
          <span className="font-mono text-[0.78rem] text-muted">{manifest.wind ? m.cc_wind_unavailable() : m.cc_wind_none()}</span>
        </div>
      )}

      <TideStrip tides={tides} tz={tz} lat={manifest.buoy.lat} lon={manifest.buoy.lon} />
    </section>
  );
}

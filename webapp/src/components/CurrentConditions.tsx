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
 *  wind arrow to amber); `second` draws a faint secondary marker (the gust direction). */
function CompassDial({
  deg, spread, locale, color, second,
}: { deg: number | null; spread: number | null; locale: Locale; color?: string; second?: number | null }) {
  const dirText = deg != null ? compass(deg, locale) : '—';
  const hue = color ?? (deg != null ? dirColor(deg) : null);
  return (
    <div className="relative aspect-square w-full max-w-[176px]" role="img" aria-label={deg != null ? `from ${compass(deg, locale)}` : 'no direction'}>
      <svg viewBox="0 0 120 120" width="100%" height="100%">
        <circle cx="60" cy="60" r="56" className="fill-none stroke-line [stroke-width:2]" />
        {['N', 'E', 'S', 'W'].map((c, i) => {
          const a = (i * 90 - 90) * (Math.PI / 180);
          // Cardinals carry the cyclical direction colour code (N teal · E blue · S gold · W pink),
          // identical on the swell and wind dials — direction is encoded by hue, realm by the zone
          // (spec 0013 revision). So wind direction reads "which way" at a glance, like the swell.
          return (
            <text key={c} x={60 + Math.cos(a) * 51} y={60 + Math.sin(a) * 51 + 3.5} className="font-mono text-[9px] font-semibold" textAnchor="middle" style={{ fill: dirColor(i * 90) }}>
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
        <span className="font-display text-[clamp(1.4rem,3.6vw,1.85rem)] font-bold leading-none tracking-[-0.01em] text-fg">{dirText}</span>
        {deg != null && <span className="font-mono text-[0.78rem] text-muted">{Math.round(deg)}°</span>}
      </div>
    </div>
  );
}

function Gauge({
  label, value, unit, defKey, accent, icon,
}: { label: string; value: string; unit?: string; defKey: MessageKey; accent?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col gap-[0.1rem] max-[720px]:items-center">
      <span className="inline-flex items-center text-[0.72rem] uppercase tracking-[0.05em] text-faint">
        {icon}
        {label}
        <InfoPopover title={label} body={m[defKey]()} />
      </span>
      <span className="font-display text-[1.5rem] font-medium [font-feature-settings:'tnum']" style={accent ? { color: accent } : undefined}>
        {value}
        {unit && <span className="text-[0.85rem] text-muted"> {unit}</span>}
      </span>
    </div>
  );
}

/** A small "comes-from" arrow for the offshore/onshore bridge (realm-coloured). */
function MiniArrow({ deg, color }: { deg: number | null; color: string }) {
  if (deg == null) return <span className="text-faint">—</span>;
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`rotate(${deg} 12 12)`}>
        <path d="M12 3 L8 12 L12 10 L16 12 Z" style={{ fill: color }} />
        <line x1="12" y1="10" x2="12" y2="20.5" style={{ stroke: color }} strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

const ZONE: Record<'sea' | 'air', string> = {
  sea: 'border-[color-mix(in_oklab,var(--accent)_22%,var(--hairline))] bg-[color-mix(in_oklab,var(--accent)_6%,var(--surface))]',
  air: 'border-[color-mix(in_oklab,var(--c-wind)_24%,var(--hairline))] bg-[color-mix(in_oklab,var(--c-wind)_7%,var(--surface))]',
};

/** Zone header: a coloured realm tag + a source chip (buoy or station attribution). */
function ZoneHeader({ realm, tag, children }: { realm: 'sea' | 'air'; tag: string; children: ReactNode }) {
  const bg = realm === 'sea' ? 'var(--accent)' : 'var(--c-wind)';
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="rounded-md px-2 py-[0.1rem] font-display text-[0.72rem] font-bold uppercase tracking-[0.05em]" style={{ background: bg, color: '#08201a' }}>
        {tag}
      </span>
      <span className="inline-flex items-center gap-1.5 font-mono text-[0.72rem] text-muted">{children}</span>
    </div>
  );
}

const STATUS_BADGE = 'inline-flex items-center gap-[0.45rem] rounded-full border bg-surface-2 px-[0.7rem] py-[0.32rem] font-mono text-[0.78rem] text-muted cursor-pointer transition-colors hover:border-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
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

function StalenessBadge({ fresh, stampMs, tz, now }: { fresh: Freshness; stampMs: number | null; tz: string; now: number }) {
  const { locale } = useLocale();
  const { units } = useUnits();
  const ago = stampMs != null ? relativeAgo(stampMs, locale, now) : null;
  const clock = stampMs != null ? fmtClock(stampMs, locale, tz, units.clock) : null;
  const help = m[`cc_${fresh}_help` as MessageKey]();
  const body = stampMs != null ? `${help} · ${m.cc_updated()} ${clock}` : help;
  return (
    <InfoPopover title={m[`cc_${fresh}` as MessageKey]()} body={body} align="end" triggerClassName={`${STATUS_BADGE} ${STATUS_BORDER[fresh]}`} triggerLabel={m.cc_freshness()}>
      <span className={`h-[9px] w-[9px] rounded-full ${STATUS_DOT[fresh]}`} aria-hidden="true" />
      {ago && <span className="whitespace-nowrap">{ago}</span>}
      {clock && <span className="whitespace-nowrap text-faint">· {clock}</span>}
    </InfoPopover>
  );
}

/** The offshore/onshore verdict — the only cross-realm synthesis (station wind × buoy swell). */
function ShoreBridge({ swellDeg, windDeg, locale }: { swellDeg: number | null; windDeg: number | null; locale: Locale }) {
  const shore = shoreRelation(windDeg, swellDeg);
  const label = shore === 'offshore' ? m.cc_offshore() : shore === 'onshore' ? m.cc_onshore() : m.cc_cross_shore();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-dashed border-divider bg-surface-2 px-3.5 py-2">
      <span className="inline-flex items-center gap-1.5 font-mono text-[0.74rem] text-muted">
        <MiniArrow deg={swellDeg} color="var(--accent)" />
        {m.cc_swell()} {swellDeg != null && compass(swellDeg, locale)}
      </span>
      <span className="font-mono text-[0.72rem] text-faint">/</span>
      <span className="inline-flex items-center gap-1.5 font-mono text-[0.74rem] text-muted">
        <MiniArrow deg={windDeg} color="var(--c-wind)" />
        {m.cc_wind()} {windDeg != null && compass(windDeg, locale)}
      </span>
      {shore ? (
        // Softened verdict: a tinted pill with the shore colour as text + border, not a loud
        // solid fill — onshore's red in particular read as an alarm at full strength (spec 0013 rev).
        <span
          className="ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-[0.3rem] font-display text-[0.88rem] font-bold"
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
        <span className="ml-auto font-mono text-[0.74rem] text-faint">{m.cc_shore()} —</span>
      )}
    </div>
  );
}

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

  const stampMs = latestTimestamp(latest);
  const fresh = stampMs != null ? freshness(now - stampMs) : 'stale';

  const kind = wind ? stationInfo(wind.station)?.kind : undefined;
  const kindLabel = kind ? m[`station_kind_${kind.replaceAll('-', '_')}` as MessageKey]() : '';

  return (
    <section
      aria-label={m.cc_title()}
      className={`relative flex flex-col gap-2 rounded-2xl border border-line bg-surface px-5 pb-5 pt-4 shadow-[0_0_40px_-28px_var(--accent)] ${fresh === 'stale' ? 'saturate-[0.55]' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="font-mono text-[0.74rem] uppercase tracking-[0.08em] text-faint">
          {m.cc_title()}
          <span className="text-muted"> · {manifest.buoy.name}</span>
        </span>
        <StalenessBadge fresh={fresh} stampMs={stampMs} tz={tz} now={now} />
      </div>

      {/* ---- offshore/onshore verdict (only with a paired station) — a conditions banner up top,
             not wedged between the two zones (spec 0013 revision) ---- */}
      {wind && <ShoreBridge swellDeg={dir?.value ?? null} windDeg={windDir?.value ?? null} locale={locale} />}

      {/* ---- MER (buoy) zone ---- */}
      <div className={`rounded-xl border p-3.5 ${ZONE.sea}`}>
        <ZoneHeader realm="sea" tag={m.cc_realm_sea()}>
          <BuoyMark size={15} className="text-accent" />
          {m.cc_buoy()} {manifest.buoy.campaign_id} · {manifest.buoy.network}
        </ZoneHeader>
        <div className="grid grid-cols-[minmax(150px,0.8fr)_1.5fr] items-center gap-x-6 gap-y-5 max-[720px]:grid-cols-1 max-[720px]:justify-items-center">
          <div className="flex flex-col items-center gap-1.5">
            <CompassDial deg={dir?.value ?? null} spread={spread?.value ?? null} locale={locale} />
            <div className="flex flex-col items-center gap-[0.1rem] text-center">
              <span className="inline-flex items-center text-[0.82rem] text-muted">
                <DirectionIcon className={LABEL_ICON} style={{ color: 'var(--c-dir)' }} />
                {m.cc_direction()}
                <InfoPopover title={m.cc_direction()} body={m.def_direction()} />
              </span>
              {dir && <span className="font-mono text-[0.82rem] text-accent">{m.cc_from()} {compass(dir.value, locale)} · {Math.round(dir.value)}°</span>}
              {spread && (
                <span className="inline-flex items-center font-mono text-[0.76rem] text-faint">
                  {m.cc_spread()} ±{Math.round(spread.value)}°
                  <InfoPopover title={m.cc_spread()} body={m.def_spread()} />
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-4 border-l border-line pl-6 max-[720px]:w-full max-[720px]:items-center max-[720px]:border-l-0 max-[720px]:pl-0">
            <div className="flex flex-col gap-[0.15rem] max-[720px]:items-center">
              <span className="inline-flex items-center text-[0.8rem] uppercase tracking-[0.05em] text-faint">
                <WaveHeightIcon className={LABEL_ICON} style={{ color: 'var(--c-height)' }} />
                {m.cc_wave_height()}
                <InfoPopover title={m.cc_wave_height()} body={m.def_wave_height()} />
              </span>
              <span className="font-display text-[clamp(2.4rem,5.5vw,3.1rem)] font-bold leading-none tracking-[-0.02em] text-accent [font-feature-settings:'tnum']">
                {hs ? fmtNumber(hs.value, locale, 1) : '—'}
                <span className="ml-[0.15rem] text-[1.1rem] text-muted">m</span>
              </span>
            </div>
            <div className="grid w-full grid-cols-3 gap-[1.2rem] [&>*+*]:border-l [&>*+*]:border-line [&>*+*]:pl-[1.2rem] max-[720px]:text-center max-[420px]:grid-cols-1 max-[420px]:[&>*+*]:border-l-0 max-[420px]:[&>*+*]:pl-0">
              <Gauge label={m.cc_max_wave()} value={num(hmax)} unit="m" defKey="def_max_wave" icon={<MaxWaveIcon className={LABEL_ICON} style={{ color: 'var(--c-max)' }} />} />
              <Gauge label={m.cc_period()} value={num(period)} unit="s" defKey="def_period" icon={<PeriodIcon className={LABEL_ICON} style={{ color: 'var(--c-period)' }} />} />
              <Gauge label={m.cc_sea_temp()} value={fmtU(seaTemp, 'sea_temperature_c')} unit={keySuffix('sea_temperature_c', units) ?? undefined} defKey="def_sea_temp" accent="var(--accent)" icon={<TempIcon className={LABEL_ICON} style={{ color: 'var(--accent)' }} />} />
            </div>
          </div>
        </div>
      </div>

      {/* ---- AIR (station) zone ---- */}
      {wind ? (
        <div className={`rounded-xl border p-3.5 ${ZONE.air}`}>
          <ZoneHeader realm="air" tag={m.cc_realm_air()}>
            <StationIcon size={15} style={{ color: 'var(--c-wind)' }} />
            {m.cc_station()} {wind.manifest.station.label} <span className="text-faint">· {fmtNumber(wind.distanceKm, locale, 1)} km{kindLabel ? ` · ${kindLabel}` : ''} · {wind.manifest.source.provider}</span>
          </ZoneHeader>
          <div className="grid grid-cols-[minmax(150px,0.8fr)_1.5fr] items-center gap-x-6 gap-y-5 max-[720px]:grid-cols-1 max-[720px]:justify-items-center">
            <div className="flex flex-col items-center gap-1.5">
              <CompassDial deg={windDir?.value ?? null} spread={null} second={gustDir?.value ?? null} locale={locale} />
              <div className="flex flex-col items-center gap-[0.1rem] text-center">
                <span className="inline-flex items-center text-[0.82rem] text-muted">
                  <WindIcon className={LABEL_ICON} style={{ color: 'var(--c-wind)' }} />
                  {m.cc_wind_dir()}
                  <InfoPopover title={m.cc_wind_dir()} body={m.def_wind()} />
                </span>
                {windDir && <span className="font-mono text-[0.82rem]" style={{ color: 'var(--c-wind)' }}>{m.cc_from()} {compass(windDir.value, locale)} · {Math.round(windDir.value)}°</span>}
                {gustDir && <span className="font-mono text-[0.76rem] text-faint">{m.cc_gust().toLowerCase()} {compass(gustDir.value, locale)} · {Math.round(gustDir.value)}°</span>}
              </div>
            </div>
            <div className="flex flex-col gap-3.5 border-l border-line pl-6 max-[720px]:w-full max-[720px]:items-center max-[720px]:border-l-0 max-[720px]:pl-0">
              <div className="grid w-full grid-cols-4 gap-[1rem] [&>*+*]:border-l [&>*+*]:border-line [&>*+*]:pl-[1rem] max-[720px]:text-center max-[520px]:grid-cols-2 max-[520px]:gap-y-4 max-[520px]:[&>*]:border-l-0 max-[520px]:[&>*]:pl-0">
                <Gauge label={m.cc_wind()} value={fmtU(windSpeed, 'wind_speed_ms')} unit={keySuffix('wind_speed_ms', units) ?? undefined} defKey="def_wind" accent="var(--c-wind)" icon={<WindIcon className={LABEL_ICON} style={{ color: 'var(--c-wind)' }} />} />
                <Gauge label={m.cc_gust()} value={fmtU(gust, 'wind_gust_ms')} unit={keySuffix('wind_gust_ms', units) ?? undefined} defKey="def_gust" icon={<WindIcon className={LABEL_ICON} style={{ color: 'var(--c-wind)', opacity: 0.7 }} />} />
                <Gauge label={m.cc_air_temp()} value={fmtU(airTemp, 'air_temperature_c')} unit={keySuffix('air_temperature_c', units) ?? undefined} defKey="def_air_temp" accent="var(--c-airtemp)" icon={<TempIcon className={LABEL_ICON} style={{ color: 'var(--c-airtemp)' }} />} />
                <Gauge label={m.cc_rain()} value={num(rain)} unit="mm" defKey="def_rain" icon={<RainIcon className={LABEL_ICON} style={{ color: 'var(--c-period)' }} />} />
              </div>
              <div className="grid w-full max-w-[22rem] grid-cols-2 gap-[1rem] text-[0.9rem] opacity-80 [&>*+*]:border-l [&>*+*]:border-line [&>*+*]:pl-[1rem]">
                <Gauge label={m.cc_humidity()} value={humidity ? fmtNumber(humidity.value, locale, 0) : '—'} unit={humidity ? '%' : undefined} defKey="def_humidity" icon={<HumidityIcon className={LABEL_ICON} style={{ color: 'var(--c-tide)' }} />} />
                <Gauge label={m.cc_pressure()} value={fmtU(pressure, 'pressure_msl_hpa')} unit={pressure ? keySuffix('pressure_msl_hpa', units) ?? undefined : undefined} defKey="def_pressure" icon={<PressureIcon className={LABEL_ICON} style={{ color: 'var(--c-dir)' }} />} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={`flex items-center gap-2.5 rounded-xl border border-dashed p-3.5 ${ZONE.air}`}>
          <StationIcon size={16} style={{ color: 'var(--c-wind)' }} />
          <span className="font-mono text-[0.78rem] text-muted">{manifest.wind ? m.cc_wind_unavailable() : m.cc_wind_none()}</span>
        </div>
      )}

      <TideStrip tides={tides} tz={tz} lat={manifest.buoy.lat} lon={manifest.buoy.lon} />
    </section>
  );
}

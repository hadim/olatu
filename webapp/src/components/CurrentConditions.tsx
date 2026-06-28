import type { ReactNode } from 'react';
import { useLocale, type Locale, type MessageKey } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { lastValue, latestTimestamp, type Manifest, type Series } from '../lib/data';
import { compass, dirColor, fmtNumber, fmtClock, freshness, relativeAgo, type Freshness } from '../lib/format';
import { useNow } from '../lib/useNow';
import { WaveHeightIcon, MaxWaveIcon, PeriodIcon, DirectionIcon, TempIcon } from './icons';
import InfoPopover from './InfoPopover';

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

function CompassDial({ deg, spread, locale }: { deg: number | null; spread: number | null; locale: Locale }) {
  const dirText = deg != null ? compass(deg, locale) : '—';
  // The dial shares the charts' cyclical from-direction hue so the banner and the
  // direction track read as one system (N teal · E blue · S gold · W pink).
  const hue = deg != null ? dirColor(deg) : null;
  return (
    <div className="relative aspect-square w-full max-w-[200px]" role="img" aria-label={deg != null ? `from ${compass(deg, locale)}` : 'no direction'}>
      <svg viewBox="0 0 120 120" width="100%" height="100%">
        <circle cx="60" cy="60" r="56" className="fill-none stroke-line [stroke-width:2]" />
        {['N', 'E', 'S', 'W'].map((c, i) => {
          const a = (i * 90 - 90) * (Math.PI / 180);
          return (
            <text key={c} x={60 + Math.cos(a) * 51} y={60 + Math.sin(a) * 51 + 3.5} className="fill-faint font-mono text-[9px]" textAnchor="middle">
              {locale === 'en' ? c : c === 'W' ? 'O' : c}
            </text>
          );
        })}
        {deg != null && (
          <g transform={`rotate(${deg + 180} 60 60)`}>
            {spread != null && <path d={conePath(60, 60, 30, 50, spread)} style={hue ? { fill: `${hue}33` } : undefined} />}
            <path d="M60 13 L54.5 31 L65.5 31 Z" className="fill-accent" style={hue ? { fill: hue } : undefined} />
          </g>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[0.05rem]">
        <span className="font-display text-[clamp(1.5rem,4vw,2rem)] font-bold leading-none tracking-[-0.01em] text-fg">{dirText}</span>
        {deg != null && <span className="font-mono text-[0.82rem] text-muted">{Math.round(deg)}°</span>}
      </div>
    </div>
  );
}

function Gauge({ label, value, unit, defKey, tone, icon }: { label: string; value: string; unit?: string; defKey: MessageKey; tone?: 'warm'; icon?: ReactNode }) {
  return (
    <div className="flex flex-col gap-[0.1rem] max-[720px]:items-center">
      <span className="inline-flex items-center text-[0.78rem] uppercase tracking-[0.06em] text-faint">
        {icon}
        {label}
        <InfoPopover title={label} body={m[defKey]()} />
      </span>
      <span className={`font-display text-[1.7rem] font-medium [font-feature-settings:'tnum'] ${tone === 'warm' ? 'text-warm' : ''}`}>
        {value}
        {unit && <span className="text-[0.9rem] text-muted"> {unit}</span>}
      </span>
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
  const ago = stampMs != null ? relativeAgo(stampMs, locale, now) : null;
  const clock = stampMs != null ? fmtClock(stampMs, locale, tz) : null;
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

export default function CurrentConditions({ latest, manifest }: { latest: Series; manifest: Manifest }) {
  const { locale } = useLocale();
  const tz = manifest.timezone;
  const now = useNow(30_000);

  const hs = lastValue(latest, 'significant_wave_height_m');
  const hmax = lastValue(latest, 'max_wave_height_m');
  const period = lastValue(latest, 'significant_period_s');
  const dir = lastValue(latest, 'peak_direction_deg');
  const spread = lastValue(latest, 'peak_directional_spread_deg');
  const temp = lastValue(latest, 'sea_temperature_c');

  const stampMs = latestTimestamp(latest);
  const fresh = stampMs != null ? freshness(now - stampMs) : 'stale';

  return (
    <section
      aria-label={m.cc_title()}
      className={`relative rounded-2xl border border-line bg-surface px-6 pb-6 pt-5 shadow-[0_0_40px_-28px_var(--accent)] ${fresh === 'stale' ? 'saturate-[0.55]' : ''}`}
    >
      <div className="mb-[1.1rem] flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="font-mono text-[0.74rem] uppercase tracking-[0.08em] text-faint">
          {m.cc_title()}
          <span className="text-muted"> · {manifest.buoy.name}</span>
        </span>
        <StalenessBadge fresh={fresh} stampMs={stampMs} tz={tz} now={now} />
      </div>

      <div className="grid grid-cols-[minmax(170px,0.85fr)_1.5fr] items-center gap-x-8 gap-y-7 max-[720px]:grid-cols-1 max-[720px]:justify-items-center max-[720px]:gap-6">
        {/* left: direction-only instrument (arrow + spread cone) */}
        <div className="flex flex-col items-center gap-2">
          <CompassDial deg={dir?.value ?? null} spread={spread?.value ?? null} locale={locale} />
          <div className="flex flex-col items-center gap-[0.1rem] text-center">
            <span className="inline-flex items-center text-[0.86rem] text-muted">
              <DirectionIcon className={LABEL_ICON} style={{ color: 'var(--c-dir)' }} />
              {m.cc_direction()}
              <InfoPopover title={m.cc_direction()} body={m.def_direction()} />
            </span>
            {dir && (
              <span className="font-mono text-[0.84rem] text-accent">
                {m.cc_from()} {compass(dir.value, locale)} · {Math.round(dir.value)}°
              </span>
            )}
            {spread && (
              <span className="inline-flex items-center font-mono text-[0.78rem] text-faint">
                {m.cc_spread()} ±{Math.round(spread.value)}°
                <InfoPopover title={m.cc_spread()} body={m.def_spread()} />
              </span>
            )}
          </div>
        </div>

        {/* right: the readouts — wave height is the hero */}
        <div className="flex flex-col gap-[1.35rem] border-l border-line pl-8 max-[720px]:w-full max-[720px]:items-center max-[720px]:border-l-0 max-[720px]:pl-0">
          <div className="flex flex-col gap-[0.15rem] max-[720px]:items-center">
            <span className="inline-flex items-center text-[0.82rem] uppercase tracking-[0.06em] text-faint">
              <WaveHeightIcon className={LABEL_ICON} style={{ color: 'var(--c-height)' }} />
              {m.cc_wave_height()}
              <InfoPopover title={m.cc_wave_height()} body={m.def_wave_height()} />
            </span>
            <span className="font-display text-[clamp(2.7rem,6vw,3.5rem)] font-bold leading-none tracking-[-0.02em] text-accent [font-feature-settings:'tnum']">
              {hs ? fmtNumber(hs.value, locale, 1) : '—'}
              <span className="ml-[0.15rem] text-[1.15rem] text-muted">m</span>
            </span>
          </div>

          <div className="flex flex-wrap gap-[1.3rem] [&>*+*]:border-l [&>*+*]:border-line [&>*+*]:pl-[1.3rem] max-[720px]:w-full max-[720px]:justify-center max-[720px]:text-center max-[720px]:[&>*+*]:border-l-0 max-[720px]:[&>*+*]:pl-0">
            <Gauge label={m.cc_max_wave()} value={hmax ? fmtNumber(hmax.value, locale, 1) : '—'} unit="m" defKey="def_max_wave" icon={<MaxWaveIcon className={LABEL_ICON} style={{ color: 'var(--c-max)' }} />} />
            <Gauge label={m.cc_period()} value={period ? fmtNumber(period.value, locale, 1) : '—'} unit="s" defKey="def_period" icon={<PeriodIcon className={LABEL_ICON} style={{ color: 'var(--c-period)' }} />} />
            <Gauge label={m.cc_sea_temp()} value={temp ? fmtNumber(temp.value, locale, 1) : '—'} unit="°C" defKey="def_sea_temp" tone="warm" icon={<TempIcon className={LABEL_ICON} style={{ color: 'var(--c-temp)' }} />} />
          </div>
        </div>
      </div>
    </section>
  );
}

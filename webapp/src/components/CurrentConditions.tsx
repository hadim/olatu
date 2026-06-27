import { useI18n, type MessageKey } from '../lib/i18n';
import { lastValue, latestTimestamp, type Manifest, type Series } from '../lib/data';
import { compass, fmtNumber, fmtClock, freshness, relativeAgo, type Freshness } from '../lib/format';
import InfoPopover from './InfoPopover';

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

function CompassDial({ deg, spread, locale }: { deg: number | null; spread: number | null; locale: string }) {
  const dirText = deg != null ? compass(deg, locale as never) : '—';
  return (
    <div className="dial" role="img" aria-label={deg != null ? `from ${compass(deg, locale as never)}` : 'no direction'}>
      <svg viewBox="0 0 120 120" width="100%" height="100%">
        <circle cx="60" cy="60" r="56" className="dial-ring" />
        {['N', 'E', 'S', 'W'].map((c, i) => {
          const a = (i * 90 - 90) * (Math.PI / 180);
          return (
            <text key={c} x={60 + Math.cos(a) * 51} y={60 + Math.sin(a) * 51 + 3.5} className="dial-tick" textAnchor="middle">
              {locale === 'en' ? c : c === 'W' ? 'O' : c}
            </text>
          );
        })}
        {deg != null && (
          <g transform={`rotate(${deg + 180} 60 60)`}>
            {spread != null && <path d={conePath(60, 60, 30, 50, spread)} className="dial-cone" />}
            <path d="M60 13 L54.5 31 L65.5 31 Z" className="dial-arrow" />
          </g>
        )}
      </svg>
      <div className="dial-center">
        <span className="dial-dir">{dirText}</span>
        {deg != null && <span className="dial-deg">{Math.round(deg)}°</span>}
      </div>
    </div>
  );
}

function Gauge({ label, value, unit, defKey, tone }: { label: string; value: string; unit?: string; defKey: MessageKey; tone?: 'warm' }) {
  const { t } = useI18n();
  return (
    <div className={`gauge${tone ? ` gauge--${tone}` : ''}`}>
      <span className="gauge-label">
        {label}
        <InfoPopover title={label} body={t(defKey)} />
      </span>
      <span className="gauge-value">
        {value}
        {unit && <span className="gauge-unit"> {unit}</span>}
      </span>
    </div>
  );
}

function StalenessBadge({ fresh, stampMs, tz }: { fresh: Freshness; stampMs: number | null; tz: string }) {
  const { t, locale } = useI18n();
  const now = Date.now();
  const ago = stampMs != null ? relativeAgo(stampMs, locale, now) : null;
  const help = t(`cc.${fresh}.help` as MessageKey);
  const body = stampMs != null ? `${help} · ${t('cc.updated')} ${fmtClock(stampMs, locale, tz)}` : help;
  return (
    <InfoPopover
      title={t(`cc.${fresh}` as MessageKey)}
      body={body}
      align="end"
      triggerClassName={`status-badge status-badge--${fresh}`}
      triggerLabel={t('cc.freshness')}
    >
      <span className={`status-dot status-dot--${fresh}`} aria-hidden="true" />
      {ago && <span className="status-ago">{ago}</span>}
    </InfoPopover>
  );
}

export default function CurrentConditions({ latest, manifest }: { latest: Series; manifest: Manifest }) {
  const { t, locale } = useI18n();
  const tz = manifest.timezone;
  const now = Date.now();

  const hs = lastValue(latest, 'significant_wave_height_m');
  const hmax = lastValue(latest, 'max_wave_height_m');
  const period = lastValue(latest, 'significant_period_s');
  const dir = lastValue(latest, 'peak_direction_deg');
  const spread = lastValue(latest, 'peak_directional_spread_deg');
  const temp = lastValue(latest, 'sea_temperature_c');

  const stampMs = latestTimestamp(latest);
  const fresh = stampMs != null ? freshness(now - stampMs) : 'stale';

  return (
    <section className={`banner banner--${fresh}`} aria-label={t('cc.title')}>
      <div className="banner-head">
        <span className="banner-eyebrow">{t('cc.title')}</span>
        <StalenessBadge fresh={fresh} stampMs={stampMs} tz={tz} />
      </div>

      <div className="banner-grid">
        {/* left: direction-only instrument (arrow + spread cone) */}
        <div className="banner-dial">
          <CompassDial deg={dir?.value ?? null} spread={spread?.value ?? null} locale={locale} />
          <div className="dial-caption">
            <span className="caption-label">
              {t('cc.direction')}
              <InfoPopover title={t('cc.direction')} body={t('def.direction')} />
            </span>
            {dir && (
              <span className="caption-dir">
                {t('cc.from')} {compass(dir.value, locale)} · {Math.round(dir.value)}°
              </span>
            )}
            {spread && (
              <span className="caption-spread">
                {t('cc.spread')} ±{Math.round(spread.value)}°
                <InfoPopover title={t('cc.spread')} body={t('def.spread')} />
              </span>
            )}
          </div>
        </div>

        {/* right: the readouts — wave height is the hero */}
        <div className="banner-metrics">
          <div className="metric-hero">
            <span className="metric-label">
              {t('cc.waveHeight')}
              <InfoPopover title={t('cc.waveHeight')} body={t('def.waveHeight')} />
            </span>
            <span className="metric-value">
              {hs ? fmtNumber(hs.value, locale, 1) : '—'}
              <span className="metric-unit">m</span>
            </span>
          </div>

          <div className="banner-gauges">
            <Gauge label={t('cc.maxWave')} value={hmax ? fmtNumber(hmax.value, locale, 1) : '—'} unit="m" defKey="def.maxWave" />
            <Gauge label={t('cc.period')} value={period ? fmtNumber(period.value, locale, 1) : '—'} unit="s" defKey="def.period" />
            <Gauge label={t('cc.seaTemp')} value={temp ? fmtNumber(temp.value, locale, 1) : '—'} unit="°C" defKey="def.seaTemp" tone="warm" />
          </div>
        </div>
      </div>
    </section>
  );
}

import { useI18n, type MessageKey } from '../lib/i18n';
import { lastValue, latestTimestamp, type Manifest, type Series } from '../lib/data';
import { compass, fmtNumber, fmtClock, freshness, relativeAgo, type Freshness } from '../lib/format';
import InfoPopover from './InfoPopover';

function CompassDial({ deg, hs, locale }: { deg: number | null; hs: number | null; locale: string }) {
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
            <path d="M60 22 L52 60 L60 52 L68 60 Z" className="dial-arrow" />
          </g>
        )}
      </svg>
      <div className="dial-center">
        <span className="dial-value">{hs != null ? fmtNumber(hs, locale as never, 1) : '—'}</span>
        <span className="dial-unit">m</span>
      </div>
    </div>
  );
}

function Gauge({ label, value, unit, defKey }: { label: string; value: string; unit?: string; defKey: MessageKey }) {
  const { t } = useI18n();
  return (
    <div className="gauge">
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
        <div className="banner-dial">
          <CompassDial deg={dir?.value ?? null} hs={hs?.value ?? null} locale={locale} />
          <div className="dial-caption">
            <span className="caption-label">
              {t('cc.waveHeight')}
              <InfoPopover title={t('cc.waveHeight')} body={t('def.waveHeight')} />
            </span>
            {dir && (
              <span className="caption-dir">
                {t('cc.from')} {compass(dir.value, locale)} · {Math.round(dir.value)}°
              </span>
            )}
          </div>
        </div>

        <div className="banner-gauges">
          <Gauge label={t('cc.period')} value={period ? fmtNumber(period.value, locale, 1) : '—'} unit="s" defKey="def.period" />
          <Gauge label={t('cc.maxWave')} value={hmax ? fmtNumber(hmax.value, locale, 1) : '—'} unit="m" defKey="def.maxWave" />
          <Gauge label={t('cc.spread')} value={spread ? `±${Math.round(spread.value)}` : '—'} unit="°" defKey="def.spread" />
        </div>

        <div className="banner-temp">
          <span className="gauge-label">
            {t('cc.seaTemp')}
            <InfoPopover title={t('cc.seaTemp')} body={t('def.seaTemp')} align="end" />
          </span>
          <span className="temp-value">
            {temp ? fmtNumber(temp.value, locale, 1) : '—'}
            <span className="temp-unit">°C</span>
          </span>
        </div>
      </div>
    </section>
  );
}

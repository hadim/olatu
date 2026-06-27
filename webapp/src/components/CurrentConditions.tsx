import { useI18n } from '../lib/i18n';
import { lastValue, latestTimestamp, type Manifest, type Series } from '../lib/data';
import { compass, fmtNumber, fmtClock, freshness, relativeAgo } from '../lib/format';

function CompassDial({ deg, hs, locale }: { deg: number | null; hs: number | null; locale: string }) {
  return (
    <div className="dial" role="img" aria-label={deg != null ? `from ${compass(deg, locale as never)}` : 'no direction'}>
      <svg viewBox="0 0 120 120" width="100%" height="100%">
        <circle cx="60" cy="60" r="56" className="dial-ring" />
        {['N', 'E', 'S', 'W'].map((c, i) => {
          const a = (i * 90 - 90) * (Math.PI / 180);
          return (
            <text key={c} x={60 + Math.cos(a) * 46} y={60 + Math.sin(a) * 46 + 4} className="dial-tick" textAnchor="middle">
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

function Gauge({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="gauge">
      <span className="gauge-label">{label}</span>
      <span className="gauge-value">
        {value}
        {unit && <span className="gauge-unit"> {unit}</span>}
      </span>
    </div>
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
      <div className="banner-status">
        <span className={`status-dot status-dot--${fresh}`} aria-hidden="true" />
        <span className="status-label">{t(`cc.${fresh}` as 'cc.fresh')}</span>
        {stampMs != null && (
          <span className="status-time">
            {t('cc.updated')} {fmtClock(stampMs, locale, tz)} · {relativeAgo(stampMs, locale, now)}
          </span>
        )}
      </div>

      <div className="banner-grid">
        <div className="banner-dial">
          <CompassDial deg={dir?.value ?? null} hs={hs?.value ?? null} locale={locale} />
          <div className="dial-caption">
            <span className="caption-label">{t('cc.waveHeight')}</span>
            {dir && (
              <span className="caption-dir">
                {t('cc.from')} {compass(dir.value, locale)} · {Math.round(dir.value)}°
              </span>
            )}
          </div>
        </div>

        <div className="banner-gauges">
          <Gauge label={t('cc.period')} value={period ? fmtNumber(period.value, locale, 1) : '—'} unit="s" />
          <Gauge label={t('cc.maxWave')} value={hmax ? fmtNumber(hmax.value, locale, 1) : '—'} unit="m" />
          <Gauge label={t('cc.spread')} value={spread ? `±${Math.round(spread.value)}` : '—'} unit="°" />
        </div>

        <div className="banner-temp">
          <span className="gauge-label">{t('cc.seaTemp')}</span>
          <span className="temp-value">
            {temp ? fmtNumber(temp.value, locale, 1) : '—'}
            <span className="temp-unit">°C</span>
          </span>
        </div>
      </div>
    </section>
  );
}

import { useI18n, LOCALES, LOCALE_LABELS, type Locale } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import type { Buoy } from '../lib/data';
import Glossary from './Glossary';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Header({ buoy }: { buoy: Buoy | null }) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">🌊</span>
        <div>
          <h1>{buoy?.name ?? 'Olatu'}</h1>
          <p className="eyebrow">
            {buoy ? `CANDHIS ${buoy.campaign_id} · ${buoy.coast}` : t('app.tagline')}
          </p>
        </div>
      </div>

      <div className="header-controls">
        <Glossary />
        <label className="lang-select">
          <span className="sr-only">{t('nav.language')}</span>
          <select
            aria-label={t('nav.language')}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="icon-button" onClick={toggle} aria-label={t('nav.theme')} title={t('nav.theme')}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}

import { useLocale, LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { useTheme } from '../lib/theme';
import { Button } from '@/components/ui/button';
import { Logo } from './brands';
import Glossary from './Glossary';

// Clicking the logo/title returns to the app root (a full reload — this is a single-page
// app, so "home" = a clean load of the default/persisted buoy). It's a real <a> so
// middle-click / open-in-new-tab work and it's keyboard-focusable.
const HOME = import.meta.env.BASE_URL;

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

export default function Header() {
  const { locale, setLocale } = useLocale();
  const { theme, toggle } = useTheme();

  return (
    <header className="mb-6 flex items-center justify-between gap-4 border-b border-accent pb-4 max-[560px]:flex-col max-[560px]:items-stretch max-[560px]:gap-3.5">
      <a
        href={HOME}
        aria-label={`Olatu — ${m.nav_home()}`}
        title={m.nav_home()}
        className="group flex items-center gap-[0.85rem] rounded-xl no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
      >
        <Logo
          size={44}
          className="shrink-0 rounded-[10px] shadow-[0_2px_10px_-4px_rgba(0,0,0,0.5)] transition-transform duration-200 motion-safe:group-hover:-translate-y-[1px] motion-safe:group-hover:scale-[1.04] max-[560px]:h-[38px] max-[560px]:w-[38px]"
        />
        <div className="min-w-0">
          <h1 className="m-0 font-display text-[1.9rem] font-bold leading-none tracking-[-0.015em] text-fg max-[560px]:text-[1.55rem]">
            Olatu
          </h1>
          <p className="mt-[0.28rem] text-[0.85rem] leading-tight text-muted max-[560px]:text-[0.8rem]">
            {m.app_headline()}
          </p>
        </div>
      </a>

      <div className="flex items-center gap-2 max-[560px]:justify-start">
        <Glossary />
        <label>
          <span className="sr-only">{m.nav_language()}</span>
          <select
            aria-label={m.nav_language()}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="h-[38px] cursor-pointer rounded-lg border border-line bg-surface px-2.5 font-body text-[0.85rem] text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg max-md:h-11"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
        </label>

        <Button variant="outline" size="icon" onClick={toggle} aria-label={m.nav_theme()} title={m.nav_theme()}>
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </Button>
      </div>
    </header>
  );
}

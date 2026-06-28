// i18n shim over Paraglide JS (spec 0006 §5). Paraglide compiles the messages in
// messages/{en,fr,es}.json into tree-shaken, type-safe functions (`m.cc_wave_height()`).
// This module owns the React glue Paraglide doesn't provide:
//   • a `LocaleProvider` whose `setLocale` switches WITHOUT a page reload (so chart
//     range/zoom survive) and re-renders the tree so every `m.*()` re-reads the locale;
//   • the canonical `Locale` type + locale list/labels used by the header & formatters.
//
// Components import message functions straight from '@/paraglide/messages' (`m`); they
// call `useLocale()` only to (a) get the active locale for Intl formatting and (b)
// subscribe to locale changes so they re-render on a switch.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getLocale, setLocale as paraglideSetLocale, locales } from '@/paraglide/runtime';
import { m } from '@/paraglide/messages';

export type Locale = (typeof locales)[number];
export type MessageKey = keyof typeof m;

export const LOCALES = locales as readonly Locale[];
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

interface LocaleValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => getLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    // reload:false keeps the SPA state (chart window, scroll); Paraglide updates its
    // strategy storage (localStorage) + in-memory locale, then the state bump below
    // re-renders so every m.*() picks up the new locale.
    paraglideSetLocale(l, { reload: false });
    setLocaleState(l);
  }, []);

  const value = useMemo<LocaleValue>(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}

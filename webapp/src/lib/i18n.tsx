// Lightweight i18n: browser auto-detection + persisted choice, EN/FR/ES.
// (Intentionally minimal; will be swapped for Paraglide JS in the i18n phase — see specs.)

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export const LOCALES = ['en', 'fr', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

const STORAGE_KEY = 'olatu.locale';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

type Dict = Record<string, string>;

const MESSAGES: Record<Locale, Dict> = {
  en: {
    'app.tagline': 'Live & historical sea state',
    'cc.title': 'Current conditions',
    'cc.waveHeight': 'Wave height',
    'cc.maxWave': 'Max wave',
    'cc.period': 'Period',
    'cc.direction': 'Direction',
    'cc.spread': 'Spread',
    'cc.seaTemp': 'Sea temperature',
    'cc.from': 'from',
    'cc.updated': 'Updated',
    'cc.fresh': 'On watch',
    'cc.aging': 'Aging',
    'cc.stale': 'No recent reading',
    'cc.last30days': 'Wave height · last 30 days',
    'station.position': 'Position',
    'station.depth': 'Water depth',
    'station.operator': 'Operator',
    'station.sensor': 'Sensor',
    'station.notPublished': 'not published',
    'nav.theme': 'Toggle theme',
    'nav.language': 'Language',
    'state.loading': 'Loading buoy data…',
    'state.error': 'Could not load buoy data.',
    'state.chartsError': 'Charts are temporarily unavailable.',
    'footer.openSource': 'Open source on GitHub',
    'footer.reportBug': 'Report a bug or contribute',
    'footer.dataBy': 'Data ©',
  },
  fr: {
    'app.tagline': 'État de la mer en direct et historique',
    'cc.title': 'Conditions actuelles',
    'cc.waveHeight': 'Hauteur des vagues',
    'cc.maxWave': 'Vague max',
    'cc.period': 'Période',
    'cc.direction': 'Direction',
    'cc.spread': 'Étalement',
    'cc.seaTemp': 'Température de la mer',
    'cc.from': 'de',
    'cc.updated': 'Mis à jour',
    'cc.fresh': 'En veille',
    'cc.aging': 'Vieillissant',
    'cc.stale': 'Pas de mesure récente',
    'cc.last30days': 'Hauteur des vagues · 30 derniers jours',
    'station.position': 'Position',
    'station.depth': 'Profondeur',
    'station.operator': 'Opérateur',
    'station.sensor': 'Capteur',
    'station.notPublished': 'non publiée',
    'nav.theme': 'Changer de thème',
    'nav.language': 'Langue',
    'state.loading': 'Chargement des données de la bouée…',
    'state.error': 'Impossible de charger les données de la bouée.',
    'state.chartsError': 'Les graphiques sont momentanément indisponibles.',
    'footer.openSource': 'Open source sur GitHub',
    'footer.reportBug': 'Signaler un bug ou contribuer',
    'footer.dataBy': 'Données ©',
  },
  es: {
    'app.tagline': 'Estado del mar en vivo e histórico',
    'cc.title': 'Condiciones actuales',
    'cc.waveHeight': 'Altura de las olas',
    'cc.maxWave': 'Ola máx.',
    'cc.period': 'Período',
    'cc.direction': 'Dirección',
    'cc.spread': 'Dispersión',
    'cc.seaTemp': 'Temperatura del mar',
    'cc.from': 'del',
    'cc.updated': 'Actualizado',
    'cc.fresh': 'En guardia',
    'cc.aging': 'Envejeciendo',
    'cc.stale': 'Sin lectura reciente',
    'cc.last30days': 'Altura de las olas · últimos 30 días',
    'station.position': 'Posición',
    'station.depth': 'Profundidad',
    'station.operator': 'Operador',
    'station.sensor': 'Sensor',
    'station.notPublished': 'no publicada',
    'nav.theme': 'Cambiar tema',
    'nav.language': 'Idioma',
    'state.loading': 'Cargando datos de la boya…',
    'state.error': 'No se pudieron cargar los datos de la boya.',
    'state.chartsError': 'Los gráficos no están disponibles temporalmente.',
    'footer.openSource': 'Código abierto en GitHub',
    'footer.reportBug': 'Reportar un error o contribuir',
    'footer.dataBy': 'Datos ©',
  },
};

function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  for (const lang of navigator.languages ?? [navigator.language]) {
    const base = lang.slice(0, 2).toLowerCase();
    if ((LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return 'en';
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: keyof (typeof MESSAGES)['en']) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  document.documentElement.lang = locale;

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
    setLocaleState(l);
  }, []);

  const t = useCallback(
    (key: string) => MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key,
    [locale],
  );

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

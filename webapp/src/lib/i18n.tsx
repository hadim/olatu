// Lightweight i18n: browser auto-detection + persisted choice, EN/FR/ES.
// (Intentionally minimal; will be swapped for Paraglide JS in the i18n phase — see specs.)
//
// Terminology (spec 0003 §2 D1): the buoy measures the WHOLE sea state, so height
// stays "wave height / hauteur des vagues"; the peak direction & period describe the
// dominant component → "swell / houle". The def.* keys teach the distinction.

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

const MESSAGES = {
  en: {
    'app.tagline': 'Live & historical sea state',
    'picker.eyebrow': 'Real-time wave data',
    'intro.description':
      'Olatu reads what the sea is doing at CANDHIS wave buoys on the French Atlantic coast — live, and across their history.',
    'picker.choose': 'Choose a buoy',
    'picker.mapLabel': 'Buoy locator map',
    'picker.mapHint': 'Pick a buoy on the map',
    'data.source': 'Data',
    'data.live': 'live from CANDHIS',
    'data.dataset': 'open dataset on Hugging Face',
    'footer.dataset': 'Open dataset',
    'cc.title': 'Current conditions',
    'cc.waveHeight': 'Wave height',
    'cc.maxWave': 'Max wave',
    'cc.period': 'Swell period',
    'cc.direction': 'Swell direction',
    'cc.spread': 'Spread',
    'cc.seaTemp': 'Sea temperature',
    'cc.from': 'from',
    'cc.updated': 'Updated',
    'cc.freshness': 'Reading freshness',
    'cc.fresh': 'On watch',
    'cc.aging': 'Recent',
    'cc.stale': 'No recent reading',
    'cc.fresh.help': 'The latest reading is under 2 hours old — the station is reporting normally.',
    'cc.aging.help': 'The latest reading is 2–6 hours old. The buoy reports every 30 minutes, so this is a little behind.',
    'cc.stale.help': 'No reading in the last 6 hours. The figures below may be out of date; check the timestamp.',
    'cc.last30days': 'Wave height · last 30 days',
    'def.waveHeight': 'Significant wave height (Hs): the mean height of the highest one-third (~top 33%) of waves — the classic "sea state" size a surfer feels. The buoy measures the whole sea state, wind-chop and swell combined.',
    'def.maxWave': 'The single biggest individual wave in the 30-minute record — roughly 1.6–2× the wave height. The one to watch out for.',
    'def.period': 'Swell period (peak / Th1/3): the time between the most energetic waves. Longer periods mean a more powerful, better-organised swell.',
    'def.direction': 'The compass direction the dominant swell comes FROM (nautical convention). At Saint-Jean-de-Luz it usually clusters W–NW, around 290–310°.',
    'def.spread': 'Directional spread: how focused versus messy the swell is. Small = one clean, aligned swell; large = a short-crested, confused sea.',
    'def.seaTemp': 'Sea-surface temperature at the buoy. It is only published in the real-time feed, so the history builds up forward over time.',
    'def.waveVsSwell': 'Wave = the whole sea state (wind-chop + swell together). Swell = the long-period, organised waves that have travelled from a distant storm.',
    'chart.range': 'Range',
    'chart.smoothing': 'Smoothing',
    'chart.smooth.raw': 'Raw',
    'chart.smooth.light': 'Light',
    'chart.smooth.strong': 'Strong',
    'chart.tempUnavailable': 'Temperature data not available for this period.',
    'chart.hoverHint': 'Hover the chart to read exact values',
    'chart.jumpTo': 'Jump to date',
    'time.buoyLocal': 'Times shown in buoy local time',
    'glossary.open': 'Definitions',
    'glossary.title': 'Definitions',
    'glossary.intro': 'Plain-language meaning of every value shown. Sources: Cerema / CANDHIS.',
    'glossary.waveVsSwell': 'Wave vs swell',
    'glossary.measurements': 'Measurements',
    'glossary.seaState': 'Sea-state scale',
    'glossary.seaStateNote': 'Wave-height bands — the same colours used across the charts.',
    'sea.glassy': 'glassy',
    'sea.smooth': 'smooth',
    'sea.moderate': 'moderate',
    'sea.clean': 'clean / lively',
    'sea.building': 'building',
    'sea.big': 'big',
    'sea.storm': 'heavy / storm',
    'map.title': 'Buoy location',
    'map.loading': 'Loading map…',
    'map.openExternal': 'Open in OpenStreetMap',
    'station.position': 'Position',
    'station.depth': 'Water depth',
    'station.operator': 'Operator',
    'station.sensor': 'Sensor',
    'station.notPublished': 'not published',
    'nav.theme': 'Toggle theme',
    'nav.language': 'Language',
    'a11y.whatIsThis': 'What is this?',
    'a11y.close': 'Close',
    'state.loading': 'Loading buoy data…',
    'state.error': 'Could not load buoy data.',
    'state.chartsError': 'Charts are temporarily unavailable.',
    'footer.openSource': 'Open source on GitHub',
    'footer.reportBug': 'Report a bug or contribute',
    'footer.dataBy': 'Data ©',
  },
  fr: {
    'app.tagline': 'État de la mer en direct et historique',
    'picker.eyebrow': 'Données de houle en temps réel',
    'intro.description':
      'Olatu montre l’état de la mer aux bouées de houle CANDHIS de la côte atlantique française — en direct, et sur leur historique.',
    'picker.choose': 'Choisir une bouée',
    'picker.mapLabel': 'Carte de localisation des bouées',
    'picker.mapHint': 'Choisissez une bouée sur la carte',
    'data.source': 'Données',
    'data.live': 'en direct de CANDHIS',
    'data.dataset': 'jeu de données ouvert sur Hugging Face',
    'footer.dataset': 'Jeu de données ouvert',
    'cc.title': 'Conditions actuelles',
    'cc.waveHeight': 'Hauteur des vagues',
    'cc.maxWave': 'Vague max',
    'cc.period': 'Période de la houle',
    'cc.direction': 'Direction de la houle',
    'cc.spread': 'Étalement',
    'cc.seaTemp': 'Température de la mer',
    'cc.from': 'de',
    'cc.updated': 'Mis à jour',
    'cc.freshness': 'Fraîcheur de la mesure',
    'cc.fresh': 'En veille',
    'cc.aging': 'Récent',
    'cc.stale': 'Pas de mesure récente',
    'cc.fresh.help': 'La dernière mesure a moins de 2 heures — la station transmet normalement.',
    'cc.aging.help': 'La dernière mesure a entre 2 et 6 heures. La bouée transmet toutes les 30 minutes, c’est donc un peu en retard.',
    'cc.stale.help': 'Aucune mesure depuis 6 heures. Les valeurs ci-dessous peuvent être dépassées ; vérifiez l’horodatage.',
    'cc.last30days': 'Hauteur des vagues · 30 derniers jours',
    'def.waveHeight': 'Hauteur significative (Hs) : la hauteur moyenne du tiers le plus haut des vagues (~33 % les plus hautes) — la « taille » de l’état de mer que ressent un surfeur. La bouée mesure tout l’état de mer, clapot de vent et houle confondus.',
    'def.maxWave': 'La plus grande vague individuelle de l’enregistrement de 30 minutes — environ 1,6 à 2× la hauteur des vagues. Celle dont il faut se méfier.',
    'def.period': 'Période de la houle (pic / Th1/3) : le temps entre les vagues les plus énergétiques. Plus la période est longue, plus la houle est puissante et organisée.',
    'def.direction': 'La direction d’où vient la houle dominante (convention nautique). À Saint-Jean-de-Luz elle est généralement O–NO, autour de 290–310°.',
    'def.spread': 'Étalement directionnel : à quel point la houle est concentrée ou désordonnée. Faible = une houle propre et alignée ; élevé = une mer croisée et confuse.',
    'def.seaTemp': 'Température de surface de la mer à la bouée. Elle n’est publiée que dans le flux temps réel, donc l’historique se constitue au fil du temps.',
    'def.waveVsSwell': 'Vague = tout l’état de mer (clapot de vent + houle). Houle = les vagues longues et organisées qui ont voyagé depuis une tempête lointaine.',
    'chart.range': 'Période',
    'chart.smoothing': 'Lissage',
    'chart.smooth.raw': 'Brut',
    'chart.smooth.light': 'Léger',
    'chart.smooth.strong': 'Fort',
    'chart.tempUnavailable': 'Données de température non disponibles pour cette période.',
    'chart.hoverHint': 'Survolez le graphique pour lire les valeurs exactes',
    'chart.jumpTo': 'Aller à une date',
    'time.buoyLocal': 'Heures en heure locale de la bouée',
    'glossary.open': 'Définitions',
    'glossary.title': 'Définitions',
    'glossary.intro': 'Signification en clair de chaque valeur affichée. Sources : Cerema / CANDHIS.',
    'glossary.waveVsSwell': 'Vague et houle',
    'glossary.measurements': 'Mesures',
    'glossary.seaState': 'Échelle d’état de mer',
    'glossary.seaStateNote': 'Tranches de hauteur — les mêmes couleurs que sur les graphiques.',
    'sea.glassy': 'plat / lisse',
    'sea.smooth': 'calme',
    'sea.moderate': 'modérée',
    'sea.clean': 'belle / animée',
    'sea.building': 'se forme',
    'sea.big': 'grosse',
    'sea.storm': 'forte / tempête',
    'map.title': 'Position de la bouée',
    'map.loading': 'Chargement de la carte…',
    'map.openExternal': 'Ouvrir dans OpenStreetMap',
    'station.position': 'Position',
    'station.depth': 'Profondeur',
    'station.operator': 'Opérateur',
    'station.sensor': 'Capteur',
    'station.notPublished': 'non publiée',
    'nav.theme': 'Changer de thème',
    'nav.language': 'Langue',
    'a11y.whatIsThis': 'Qu’est-ce que c’est ?',
    'a11y.close': 'Fermer',
    'state.loading': 'Chargement des données de la bouée…',
    'state.error': 'Impossible de charger les données de la bouée.',
    'state.chartsError': 'Les graphiques sont momentanément indisponibles.',
    'footer.openSource': 'Open source sur GitHub',
    'footer.reportBug': 'Signaler un bug ou contribuer',
    'footer.dataBy': 'Données ©',
  },
  es: {
    'app.tagline': 'Estado del mar en vivo e histórico',
    'picker.eyebrow': 'Datos de oleaje en tiempo real',
    'intro.description':
      'Olatu muestra el estado del mar en las boyas de oleaje CANDHIS de la costa atlántica francesa — en directo y en su histórico.',
    'picker.choose': 'Elegir una boya',
    'picker.mapLabel': 'Mapa de ubicación de las boyas',
    'picker.mapHint': 'Elige una boya en el mapa',
    'data.source': 'Datos',
    'data.live': 'en directo de CANDHIS',
    'data.dataset': 'conjunto de datos abierto en Hugging Face',
    'footer.dataset': 'Conjunto de datos abierto',
    'cc.title': 'Condiciones actuales',
    'cc.waveHeight': 'Altura de las olas',
    'cc.maxWave': 'Ola máx.',
    'cc.period': 'Período del oleaje',
    'cc.direction': 'Dirección del oleaje',
    'cc.spread': 'Dispersión',
    'cc.seaTemp': 'Temperatura del mar',
    'cc.from': 'del',
    'cc.updated': 'Actualizado',
    'cc.freshness': 'Frescura de la lectura',
    'cc.fresh': 'En guardia',
    'cc.aging': 'Reciente',
    'cc.stale': 'Sin lectura reciente',
    'cc.fresh.help': 'La última lectura tiene menos de 2 horas — la estación transmite con normalidad.',
    'cc.aging.help': 'La última lectura tiene entre 2 y 6 horas. La boya transmite cada 30 minutos, así que va algo retrasada.',
    'cc.stale.help': 'Sin lecturas en las últimas 6 horas. Los valores de abajo pueden estar desactualizados; revisa la marca de tiempo.',
    'cc.last30days': 'Altura de las olas · últimos 30 días',
    'def.waveHeight': 'Altura significativa (Hs): la altura media del tercio más alto de las olas (~33 % más altas) — el «tamaño» del estado del mar que siente un surfista. La boya mide todo el estado del mar, marejada de viento y mar de fondo juntos.',
    'def.maxWave': 'La mayor ola individual del registro de 30 minutos — aproximadamente 1,6–2× la altura de las olas. La que hay que vigilar.',
    'def.period': 'Período del oleaje (pico / Th1/3): el tiempo entre las olas más energéticas. Cuanto mayor el período, más potente y organizado es el mar de fondo.',
    'def.direction': 'La dirección de donde viene el oleaje dominante (convención náutica). En San Juan de Luz suele agruparse al O–NO, en torno a 290–310°.',
    'def.spread': 'Dispersión direccional: cuán concentrado o desordenado está el oleaje. Baja = un mar de fondo limpio y alineado; alta = un mar cruzado y confuso.',
    'def.seaTemp': 'Temperatura de la superficie del mar en la boya. Solo se publica en el flujo en tiempo real, por lo que el histórico se acumula con el tiempo.',
    'def.waveVsSwell': 'Ola = todo el estado del mar (marejada de viento + mar de fondo). Mar de fondo (oleaje) = las olas largas y organizadas que han viajado desde una tormenta lejana.',
    'chart.range': 'Período',
    'chart.smoothing': 'Suavizado',
    'chart.smooth.raw': 'Bruto',
    'chart.smooth.light': 'Ligero',
    'chart.smooth.strong': 'Fuerte',
    'chart.tempUnavailable': 'Datos de temperatura no disponibles para este período.',
    'chart.hoverHint': 'Pasa el cursor por el gráfico para ver los valores exactos',
    'chart.jumpTo': 'Ir a una fecha',
    'time.buoyLocal': 'Horas en hora local de la boya',
    'glossary.open': 'Definiciones',
    'glossary.title': 'Definiciones',
    'glossary.intro': 'Significado en lenguaje claro de cada valor mostrado. Fuentes: Cerema / CANDHIS.',
    'glossary.waveVsSwell': 'Ola y oleaje',
    'glossary.measurements': 'Mediciones',
    'glossary.seaState': 'Escala del estado del mar',
    'glossary.seaStateNote': 'Tramos de altura — los mismos colores que en los gráficos.',
    'sea.glassy': 'plano / liso',
    'sea.smooth': 'tranquilo',
    'sea.moderate': 'moderada',
    'sea.clean': 'buena / animada',
    'sea.building': 'creciendo',
    'sea.big': 'grande',
    'sea.storm': 'fuerte / tormenta',
    'map.title': 'Ubicación de la boya',
    'map.loading': 'Cargando el mapa…',
    'map.openExternal': 'Abrir en OpenStreetMap',
    'station.position': 'Posición',
    'station.depth': 'Profundidad',
    'station.operator': 'Operador',
    'station.sensor': 'Sensor',
    'station.notPublished': 'no publicada',
    'nav.theme': 'Cambiar tema',
    'nav.language': 'Idioma',
    'a11y.whatIsThis': '¿Qué es esto?',
    'a11y.close': 'Cerrar',
    'state.loading': 'Cargando datos de la boya…',
    'state.error': 'No se pudieron cargar los datos de la boya.',
    'state.chartsError': 'Los gráficos no están disponibles temporalmente.',
    'footer.openSource': 'Código abierto en GitHub',
    'footer.reportBug': 'Reportar un error o contribuir',
    'footer.dataBy': 'Datos ©',
  },
} satisfies Record<Locale, Dict>;

export type MessageKey = keyof (typeof MESSAGES)['en'];

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
  t: (key: MessageKey) => string;
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
    (key: MessageKey) => MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key,
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

// Display units for the physical quantities Olatu shows (spec 0014). The data is stored in one
// canonical unit per quantity (wind m/s · temperature °C · pressure hPa) and converted at the
// last moment for display; the choice persists in `olatu.units` and is applied EVERYWHERE the
// value appears — Current Conditions, the chart panels + axes, the hover readout. Direction (°),
// wave height (m), period (s), rain (mm) and humidity (%) have no alternative unit worth
// offering, so they stay canonical and pass through untouched.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { fmtNumber } from './format';
import type { Locale } from './i18n';

export type SpeedUnit = 'kmh' | 'ms' | 'kn';
export type TempUnit = 'c' | 'f';
export type PressureUnit = 'hpa' | 'inhg' | 'mmhg';

export interface Units {
  speed: SpeedUnit;
  temp: TempUnit;
  pressure: PressureUnit;
}

// km/h is the default wind unit (owner preference — the most legible for this coast); °C + hPa
// are the regional defaults.
export const DEFAULT_UNITS: Units = { speed: 'kmh', temp: 'c', pressure: 'hpa' };

export type MeasureKind = 'speed' | 'temp' | 'pressure';

// Which canonical data key maps to which convertible measure (any other key passes through).
const KEY_KIND: Record<string, MeasureKind> = {
  wind_speed_ms: 'speed',
  wind_gust_ms: 'speed',
  air_temperature_c: 'temp',
  sea_temperature_c: 'temp',
  pressure_msl_hpa: 'pressure',
};

export function measureKind(key: string): MeasureKind | null {
  return KEY_KIND[key] ?? null;
}

// --- conversions from the canonical unit (m/s · °C · hPa) to the chosen display unit ---
const SPEED_FACTOR: Record<SpeedUnit, number> = { ms: 1, kmh: 3.6, kn: 1.943844 };
const PRESSURE_FACTOR: Record<PressureUnit, number> = { hpa: 1, inhg: 0.0295299831, mmhg: 0.750061683 };

export function convertMeasure(kind: MeasureKind, canonical: number, units: Units): number {
  if (kind === 'speed') return canonical * SPEED_FACTOR[units.speed];
  if (kind === 'temp') return units.temp === 'f' ? (canonical * 9) / 5 + 32 : canonical;
  return canonical * PRESSURE_FACTOR[units.pressure];
}

/** Convert a raw data value (canonical unit inferred from the key) to the display unit; keys with
 *  no convertible measure return unchanged. */
export function convertKeyValue(key: string, canonical: number, units: Units): number {
  const kind = measureKind(key);
  return kind ? convertMeasure(kind, canonical, units) : canonical;
}

// --- display suffixes + digits per unit ---
const SPEED_SUFFIX: Record<SpeedUnit, string> = { ms: 'm/s', kmh: 'km/h', kn: 'kn' };
const TEMP_SUFFIX: Record<TempUnit, string> = { c: '°C', f: '°F' };
const PRESSURE_SUFFIX: Record<PressureUnit, string> = { hpa: 'hPa', inhg: 'inHg', mmhg: 'mmHg' };

export function measureSuffix(kind: MeasureKind, units: Units): string {
  if (kind === 'speed') return SPEED_SUFFIX[units.speed];
  if (kind === 'temp') return TEMP_SUFFIX[units.temp];
  return PRESSURE_SUFFIX[units.pressure];
}

/** The unit suffix for a data key ('km/h' · '°C' · 'hPa'), or null if the key isn't a convertible
 *  measure (direction, height, period, rain, humidity keep their own fixed unit). */
export function keySuffix(key: string, units: Units): string | null {
  const kind = measureKind(key);
  return kind ? measureSuffix(kind, units) : null;
}

const SPEED_DIGITS: Record<SpeedUnit, number> = { ms: 1, kmh: 0, kn: 0 };
const PRESSURE_DIGITS: Record<PressureUnit, number> = { hpa: 0, inhg: 2, mmhg: 0 };

export function measureDigits(kind: MeasureKind, units: Units): number {
  if (kind === 'speed') return SPEED_DIGITS[units.speed];
  if (kind === 'temp') return 1;
  return PRESSURE_DIGITS[units.pressure];
}

/** Locale-formatted display string for a canonical value under a key (NO suffix). `fallbackDigits`
 *  is used for keys that aren't a convertible measure. */
export function formatKeyValue(key: string, canonical: number, units: Units, locale: Locale, fallbackDigits = 1): string {
  const kind = measureKind(key);
  const v = kind ? convertMeasure(kind, canonical, units) : canonical;
  return fmtNumber(v, locale, kind ? measureDigits(kind, units) : fallbackDigits);
}

// --- persistence + context ---
const STORAGE_KEY = 'olatu.units';

const isSpeed = (v: unknown): v is SpeedUnit => v === 'kmh' || v === 'ms' || v === 'kn';
const isTemp = (v: unknown): v is TempUnit => v === 'c' || v === 'f';
const isPressure = (v: unknown): v is PressureUnit => v === 'hpa' || v === 'inhg' || v === 'mmhg';

function loadUnits(): Units {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<Units>;
    return {
      speed: isSpeed(raw.speed) ? raw.speed : DEFAULT_UNITS.speed,
      temp: isTemp(raw.temp) ? raw.temp : DEFAULT_UNITS.temp,
      pressure: isPressure(raw.pressure) ? raw.pressure : DEFAULT_UNITS.pressure,
    };
  } catch {
    return DEFAULT_UNITS;
  }
}

interface UnitsValue {
  units: Units;
  setUnit: <K extends keyof Units>(k: K, v: Units[K]) => void;
  reset: () => void;
}

const UnitsContext = createContext<UnitsValue | null>(null);

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<Units>(loadUnits);
  const persist = (u: Units) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    } catch {
      /* storage unavailable (private mode) — the choice still applies for this session */
    }
  };
  const setUnit = useCallback(<K extends keyof Units>(k: K, v: Units[K]) => {
    setUnits((prev) => {
      const next = { ...prev, [k]: v };
      persist(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    setUnits(DEFAULT_UNITS);
    persist(DEFAULT_UNITS);
  }, []);
  const value = useMemo<UnitsValue>(() => ({ units, setUnit, reset }), [units, setUnit, reset]);
  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error('useUnits must be used within UnitsProvider');
  return ctx;
}

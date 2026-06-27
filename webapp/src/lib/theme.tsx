// Theme: dark default ("night watch") + light ("deck in daylight").
// Respects a saved choice, then the OS preference, then falls back to dark.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'olatu.theme';

function detectTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

interface ThemeValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(detectTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeValue>(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

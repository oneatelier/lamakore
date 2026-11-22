// ThemeProvider: theme state for the shell. Respects prefers-color-scheme,
// persists the choice, exposes a typed hook, and honors
// prefers-reduced-motion by swapping transform animation for fast cross-fades.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_THEME, LIGHT_THEME, THEME_NAMES, type ThemeName } from './themes.js';

const STORAGE_KEY = 'ui.theme';
const REDUCED_CLASS = 'reduced-motion';

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (name: ThemeName) => void;
  reducedMotion: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ThemeName {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? LIGHT_THEME : DEFAULT_THEME;
  }
  return DEFAULT_THEME;
}

function storedTheme(): ThemeName | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (THEME_NAMES as string[]).includes(raw)) return raw as ThemeName;
  } catch {
    /* storage unavailable; fall through to system */
  }
  return null;
}

export function ThemeProvider({ children, initial }: { children?: React.ReactNode; initial?: ThemeName }) {
  const [theme, setThemeState] = useState<ThemeName>(() => initial ?? storedTheme() ?? systemTheme());
  const [reducedMotion, setReducedMotion] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage unavailable; theme still applies to this session */
    }
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const on = mq.matches;
      setReducedMotion(on);
      document.documentElement.classList.toggle(REDUCED_CLASS, on);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeState(name);
  }, []);

  const value: ThemeContextValue = { theme, setTheme, reducedMotion };
  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

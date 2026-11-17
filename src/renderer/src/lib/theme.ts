import type { ThemeMode } from '@shared/types';

export const THEME_STORAGE_KEY = 'paperlens-theme';

export const DEFAULT_THEME: ThemeMode = 'light';

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    value === 'light' ||
    value === 'dark' ||
    value === 'eye-care' ||
    value === 'paper'
  );
}

/** Theme cached from the last session, used before settings finish loading. */
export function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Applies a theme to the document and mirrors it for the next first paint. */
export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable; the current page still gets the theme.
  }
}

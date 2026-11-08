import { useCallback, useEffect, useState } from 'react';

/** Dark is the default; light is an optional choice remembered in this browser. */
export type Theme = 'dark' | 'light';

export const THEME_KEY = 'coursepath-theme';
const CHANGE_EVENT = 'coursepath-theme-change';

function stored(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** The theme on the page right now (index.html sets it before first paint; without it the stored choice, else dark). */
export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return stored();
}

/** Put the stored (or default) theme on the page when index.html has not (tests, other hosts). */
export function ensureTheme() {
  if (!document.documentElement.getAttribute('data-theme')) document.documentElement.setAttribute('data-theme', stored());
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* a browser that blocks storage keeps the choice for this tab only */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    ensureTheme();
    setTheme(currentTheme());
    const sync = () => setTheme(currentTheme());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  const toggle = useCallback(() => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}

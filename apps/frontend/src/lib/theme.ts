/**
 * Light or dark. The choice is the visitor's (stored in localStorage); until they make one, the
 * system's preference decides. <html data-theme> carries the result, set before the first paint by
 * THEME_SCRIPT (layout.tsx) so the page never flashes the wrong theme.
 */
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'openpm-theme';
export const THEME_EVENT = 'openpm:theme';

/** Runs inline in <head>, before anything renders. Keep it tiny and dependency-free. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})();`;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
}

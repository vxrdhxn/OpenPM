'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { THEME_EVENT, applyTheme, currentTheme, type Theme } from '@/lib/theme';

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => unknown };

/**
 * Switches between the light (paper) and dark (ink) themes. Where the browser supports view
 * transitions, the new theme grows as a circle from the button.
 */
export default function ThemeToggle({ className = '', label = false }: { className?: string; label?: boolean }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const doc = document as ViewTransitionDoc;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = document.documentElement;
    const r = e.currentTarget.getBoundingClientRect();
    root.style.setProperty('--tx', `${r.left + r.width / 2}px`);
    root.style.setProperty('--ty', `${r.top + r.height / 2}px`);
    if (doc.startViewTransition && !reduce) doc.startViewTransition(() => applyTheme(next));
    else applyTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      // With a visible label, the name starts with it (what you see is what a screen reader says).
      aria-label={!theme ? 'Switch theme' : label ? `${theme === 'dark' ? 'Dark' : 'Light'} theme: switch to ${next}` : `Switch to ${next} theme`}
      className={`group inline-flex items-center gap-2 rounded-full outline-none focus-visible:ring-4 focus-visible:ring-accent-500/40 ${className}`}
    >
      <span className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-slate-300 dark:border-slate-700 transition-colors group-hover:border-slate-900 dark:group-hover:border-slate-200">
        <Sun
          aria-hidden="true"
          className="absolute h-4 w-4 transition-all duration-500 ease-out dark:-translate-y-8 dark:rotate-90 dark:opacity-0"
        />
        <Moon
          aria-hidden="true"
          className="absolute h-4 w-4 translate-y-8 -rotate-90 opacity-0 transition-all duration-500 ease-out dark:translate-y-0 dark:rotate-0 dark:opacity-100"
        />
      </span>
      {label && <span className="text-sm">{theme === 'dark' ? 'Dark' : 'Light'}</span>}
    </button>
  );
}

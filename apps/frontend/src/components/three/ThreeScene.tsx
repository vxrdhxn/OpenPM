'use client';

import { useEffect, useRef, useState } from 'react';
import type { Mounted, SceneName, SceneTone } from './engine';

/**
 * A decorative three.js scene. The engine and three.js itself load only when this mounts (a separate
 * chunk), so pages without a scene never download them. The canvas is aria-hidden: it is decoration,
 * and the page says everything in text. It fades in after its first frame; without WebGL it shows
 * `fallback` (or nothing). With reduced motion it renders one still frame and never animates.
 */
export default function ThreeScene({
  scene,
  tone = 'surface',
  className = '',
  fallback = null,
  data,
}: {
  scene: SceneName;
  tone?: SceneTone;
  className?: string;
  fallback?: React.ReactNode;
  /** Live data for data-driven scenes (plain JSON). Changes update the scene without remounting it. */
  data?: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | null>(null);
  const dataKey = JSON.stringify(data ?? null);
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
    mounted.current?.setData(data);
    // dataKey stands in for data: a new array with the same contents is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dispose: (() => void) | null = null;
    const forget = () => {
      mounted.current = null;
    };
    let cancelled = false;
    const isDark = () => document.documentElement.dataset.theme === 'dark';
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const start = async () => {
      dispose?.();
      dispose = null;
      forget();
      try {
        const [{ mount }] = await Promise.all([import('./engine'), document.fonts?.ready]);
        if (cancelled) return;
        const m = mount(el, scene, {
          tone,
          dark: isDark(),
          still: motionQuery.matches,
          data: latest.current,
          onReady: () => !cancelled && setState('ready'),
        });
        mounted.current = m;
        dispose = m.dispose;
      } catch {
        if (!cancelled) setState('failed');
      }
    };
    start();
    // The scene's colors follow the theme (the visitor can switch it), and reduced motion can change
    // while the page is open.
    let wasDark = isDark();
    const themeObserver = new MutationObserver(() => {
      if (isDark() !== wasDark) {
        wasDark = isDark();
        start();
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    motionQuery.addEventListener('change', start);
    return () => {
      cancelled = true;
      themeObserver.disconnect();
      motionQuery.removeEventListener('change', start);
      dispose?.();
      forget();
    };
  }, [scene, tone]);

  if (state === 'failed') return <>{fallback}</>;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`relative pointer-events-none transition-opacity duration-1000 ease-out ${state === 'ready' ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  );
}

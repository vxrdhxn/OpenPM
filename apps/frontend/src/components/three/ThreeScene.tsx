'use client';

import { useEffect, useRef, useState } from 'react';
import type { SceneName, SceneTone } from './engine';

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
}: {
  scene: SceneName;
  tone?: SceneTone;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const start = async () => {
      dispose?.();
      dispose = null;
      try {
        const [{ mount }] = await Promise.all([import('./engine'), document.fonts?.ready]);
        if (cancelled) return;
        dispose = mount(el, scene, {
          tone,
          dark: darkQuery.matches,
          still: motionQuery.matches,
          onReady: () => !cancelled && setState('ready'),
        });
      } catch {
        if (!cancelled) setState('failed');
      }
    };
    start();
    // The scene's colors follow the system theme, and reduced motion can change while the page is open.
    darkQuery.addEventListener('change', start);
    motionQuery.addEventListener('change', start);
    return () => {
      cancelled = true;
      darkQuery.removeEventListener('change', start);
      motionQuery.removeEventListener('change', start);
      dispose?.();
    };
  }, [scene, tone]);

  if (state === 'failed') return <>{fallback}</>;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`relative transition-opacity duration-1000 ease-out ${state === 'ready' ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  );
}

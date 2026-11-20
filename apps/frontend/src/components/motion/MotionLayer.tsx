'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/** A readable name for the curtain, from the path: "/projects/abc" → "Projects". */
function routeName(path: string) {
  const first = path.split('/').filter(Boolean)[0];
  if (!first) return 'OpenPM';
  return first.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The site-wide motion that is not tied to one component:
 *  - an ink curtain that sweeps up off every page as it arrives (navigations included),
 *  - a small burst of rings and dots wherever you click or tap,
 *  - a ring that trails the mouse and swells over anything clickable.
 * All of it is decoration (aria-hidden, no pointer events) and none of it runs with reduced motion.
 */
export default function MotionLayer() {
  const pathname = usePathname();
  const burstRoot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  // Click bursts.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onDown = (e: PointerEvent) => {
      if (reduce.matches || e.button !== 0 || !burstRoot.current) return;
      const burst = document.createElement('span');
      burst.className = 'click-burst';
      burst.style.left = `${e.clientX}px`;
      burst.style.top = `${e.clientY}px`;
      for (let i = 0; i < 8; i++) {
        const dot = document.createElement('i');
        dot.style.setProperty('--a', `${i * 45 + Math.random() * 20}deg`);
        burst.appendChild(dot);
      }
      burstRoot.current.appendChild(burst);
      window.setTimeout(() => burst.remove(), 700);
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  // The trailing cursor ring (mouse only).
  useEffect(() => {
    const el = ring.current;
    const fine = window.matchMedia('(pointer: fine)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!el || !fine.matches || reduce.matches) return;
    let x = -100, y = -100, tx = -100, ty = -100, raf = 0, hot = false, pressed = false;
    const loop = () => {
      x += (tx - x) * 0.2;
      y += (ty - y) * 0.2;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${pressed ? 0.7 : hot ? 1.8 : 1})`;
      raf = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      tx = e.clientX;
      ty = e.clientY;
      el.style.opacity = '1';
      const t = e.target as Element | null;
      hot = !!t?.closest?.('a, button, [role="button"], input, select, textarea, label, summary');
      el.dataset.hot = String(hot);
    };
    const onLeave = () => (el.style.opacity = '0');
    const onDown = () => (pressed = true);
    const onUp = () => (pressed = false);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div aria-hidden="true">
      {/* Keyed by path, so the curtain plays again on every navigation. */}
      <div key={pathname} className="page-curtain">
        <span className="page-curtain-label">
          <span className="page-curtain-dot" />
          {routeName(pathname)}
        </span>
      </div>
      <div ref={burstRoot} className="pointer-events-none fixed inset-0 z-[90] overflow-hidden" />
      <div ref={ring} className="cursor-ring" />
    </div>
  );
}

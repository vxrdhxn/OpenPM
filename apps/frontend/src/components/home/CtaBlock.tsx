'use client';

import { useRef } from 'react';
import ArrowLink from '@/components/motion/ArrowLink';
import { useScrollProgress } from './ScrollText';

/**
 * The closing call to action: an ink block with a red sun that rises as you scroll to it and leans
 * toward the mouse.
 */
export default function CtaBlock() {
  const sun = useRef<HTMLSpanElement>(null);
  const lean = useRef({ x: 0, y: 0 });
  const rise = useRef(0);
  const paint = () => {
    if (!sun.current) return;
    const s = 0.55 + rise.current * 0.45;
    sun.current.style.transform = `translate(${lean.current.x}px, ${(1 - rise.current) * 120 + lean.current.y}px) scale(${s})`;
  };
  const ref = useScrollProgress<HTMLElement>(
    (p) => {
      rise.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : p;
      paint();
    },
    1,
    0.4,
  );

  return (
    <section
      ref={ref}
      aria-labelledby="cta-title"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        lean.current = { x: (e.clientX - r.left - r.width / 2) * 0.04, y: (e.clientY - r.top - r.height / 2) * 0.04 };
        paint();
      }}
      className="relative overflow-hidden rounded-[2rem] bg-ink dark:bg-slate-900 dark:ring-1 dark:ring-slate-800 px-8 pt-16 pb-48 sm:px-16 sm:py-24 text-white"
    >
      <span
        ref={sun}
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-32 h-80 w-80 sm:bottom-auto sm:-right-24 sm:-top-40 sm:h-[34rem] sm:w-[34rem] rounded-full bg-accent-500 transition-transform duration-300 ease-out will-change-transform"
      />
      <div className="relative max-w-xl">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-white/70">This is where it starts</p>
        <h2 id="cta-title" className="mt-5 font-display text-5xl sm:text-7xl font-medium leading-[0.95] tracking-[-0.045em]">
          Bring your team on board<span className="text-accent-500">.</span>
        </h2>
        <p className="mt-6 text-lg leading-relaxed text-white/75">
          Create a workspace in under a minute. One board, one task, one teammate, and you are moving. Free, open source, and yours to run.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <ArrowLink href="/register" variant="light">Create your workspace</ArrowLink>
        </div>
      </div>
    </section>
  );
}

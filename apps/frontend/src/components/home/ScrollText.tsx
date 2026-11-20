'use client';

import { useEffect, useRef } from 'react';

/** Scroll progress of an element through the window: 0 as its top enters the bottom, 1 as it leaves the middle. */
export function useScrollProgress<T extends HTMLElement>(onProgress: (p: number) => void, start = 0.9, end = 0.35) {
  const ref = useRef<T>(null);
  const cb = useRef(onProgress);
  useEffect(() => {
    cb.current = onProgress;
  });
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const from = vh * start;
      const to = vh * end - r.height;
      cb.current(Math.min(1, Math.max(0, (from - r.top) / (from - to))));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [start, end]);
  return ref;
}

/**
 * A statement that inks itself in as you scroll: each word darkens from grey to ink in reading order.
 * `*word*` marks a word for the red accent. With reduced motion it is fully inked from the start.
 */
export default function ScrollText({ text, className = '' }: { text: string; className?: string }) {
  const words = text.split(' ');
  const spans = useRef<(HTMLSpanElement | null)[]>([]);
  const ref = useScrollProgress<HTMLParagraphElement>((p) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lit = reduce ? words.length : p * words.length * 1.15;
    spans.current.forEach((s, i) => s?.setAttribute('data-lit', String(i < lit)));
  });
  return (
    <p ref={ref} className={className}>
      {words.map((raw, i) => {
        const accent = raw.startsWith('*');
        const w = raw.replace(/\*/g, '');
        return (
          <span key={i}>
            <span
              ref={(el) => {
                spans.current[i] = el;
              }}
              data-lit="false"
              className={`transition-colors duration-500 ${
                accent
                  ? 'text-slate-500 data-[lit=true]:text-accent-700 dark:data-[lit=true]:text-accent-400'
                  : 'text-slate-500 data-[lit=true]:text-slate-900 dark:data-[lit=true]:text-white'
              }`}
            >
              {w}
            </span>
            {i < words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </p>
  );
}

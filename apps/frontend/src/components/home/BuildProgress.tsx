'use client';

import { useRef } from 'react';
import { useScrollProgress } from './ScrollText';

/**
 * The process section's gauge: a percentage and a bar that fill as you scroll through the steps,
 * and each step lights up as the gauge passes it.
 */
export default function BuildProgress({ steps }: { steps: { title: string; text: string }[] }) {
  const pct = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const ref = useScrollProgress<HTMLDivElement>(
    (p) => {
      const v = Math.round(p * 100);
      if (pct.current) pct.current.textContent = String(v).padStart(3, '0');
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      items.current.forEach((el, i) => el?.setAttribute('data-on', String(p * steps.length > i - 0.5)));
    },
    0.75,
    0.6,
  );

  return (
    <div ref={ref}>
      <div aria-hidden="true" className="mb-10 flex items-center gap-4 font-mono text-xs text-slate-500">
        <span>
          <span ref={pct}>000</span>%
        </span>
        <span className="relative h-px flex-1 bg-slate-300 dark:bg-slate-700">
          <span ref={bar} className="absolute inset-0 origin-left scale-x-0 bg-accent-500 transition-transform duration-200" />
        </span>
        <span>Build progress</span>
      </div>
      <ol className="grid gap-x-8 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => {
              items.current[i] = el;
            }}
            data-on="false"
            className="group border-t border-slate-300 dark:border-slate-700 py-7 transition-colors duration-500 data-[on=true]:border-slate-900 dark:data-[on=true]:border-slate-300"
          >
            <span className="font-mono text-xs text-slate-500 transition-colors duration-500 group-data-[on=true]:text-accent-700 dark:group-data-[on=true]:text-accent-400">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="mt-3 font-display text-3xl sm:text-[34px] font-medium tracking-[-0.03em] text-slate-900 dark:text-white">
              {s.title}
            </h3>
            <p className="mt-3 max-w-md text-slate-600 dark:text-slate-400 leading-relaxed">{s.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

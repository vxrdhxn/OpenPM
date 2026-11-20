'use client';

import { useEffect, useRef } from 'react';

/**
 * A measuring tape down the left edge of the page (it scrolls with the page, numbered in pixels) and
 * a scroll gauge on the right with a red marker for where you are. Decoration for wide screens.
 */
export default function Rulers() {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      if (marker.current) marker.current.style.top = `calc(${(p * 100).toFixed(2)}% - 4px)`;
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
  }, []);

  return (
    <div aria-hidden="true" className="hidden xl:block">
      {/* Left: the tape, as tall as the page. */}
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-12 overflow-hidden text-slate-400 dark:text-slate-600">
        <div className="absolute inset-y-0 left-0 w-2 bg-[repeating-linear-gradient(to_bottom,currentColor_0,currentColor_1px,transparent_1px,transparent_8px)]" />
        <div className="absolute inset-y-0 left-0 w-3.5 bg-[repeating-linear-gradient(to_bottom,currentColor_0,currentColor_1px,transparent_1px,transparent_64px)]" />
        {Array.from({ length: 240 }, (_, i) => (
          <span key={i} className="absolute left-[18px] font-mono text-[9px] text-slate-500 dark:text-slate-500" style={{ top: (i + 1) * 64 - 6 }}>
            {(i + 1) * 64}
          </span>
        ))}
      </div>
      {/* Right: the gauge, fixed to the window. */}
      <div className="pointer-events-none fixed right-3 top-20 bottom-20 z-40 w-3 text-slate-300 dark:text-slate-700">
        <div className="absolute inset-y-0 right-0 w-1.5 bg-[repeating-linear-gradient(to_bottom,currentColor_0,currentColor_1px,transparent_1px,transparent_8px)]" />
        <div className="absolute inset-y-0 right-0 w-3 bg-[repeating-linear-gradient(to_bottom,currentColor_0,currentColor_1px,transparent_1px,transparent_64px)]" />
        <span ref={marker} className="absolute -left-1 h-2 w-2 rounded-full bg-accent-500 transition-[top] duration-200 ease-out" />
      </div>
    </div>
  );
}

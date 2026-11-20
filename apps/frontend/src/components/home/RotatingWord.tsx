'use client';

import { useEffect, useState } from 'react';

/**
 * A word that keeps changing: every few seconds the current word rolls up and out and the next one
 * rolls in from below, ending in a red full stop. Decoration only (aria-hidden): the heading around
 * it carries a fixed accessible name. With reduced motion it stays on the first word.
 */
export default function RotatingWord({ words, interval = 2400 }: { words: string[]; interval?: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    return () => window.clearInterval(id);
  }, [words.length, interval]);

  const prev = (index - 1 + words.length) % words.length;
  return (
    <span aria-hidden="true" className="relative inline-block overflow-hidden align-bottom pb-[0.1em] -mb-[0.1em]">
      {/* The word on its way out, then the word coming in; both keyed so each change replays. */}
      <span key={`out-${index}`} className="absolute left-0 top-0 whitespace-nowrap animate-[word-out_0.7s_cubic-bezier(0.76,0,0.24,1)_both]">
        {words[prev]}
        <span className="text-accent-500">.</span>
      </span>
      <span key={`in-${index}`} className="inline-block whitespace-nowrap animate-[word-in_0.7s_cubic-bezier(0.76,0,0.24,1)_both]">
        {words[index]}
        <span className="text-accent-500">.</span>
      </span>
    </span>
  );
}

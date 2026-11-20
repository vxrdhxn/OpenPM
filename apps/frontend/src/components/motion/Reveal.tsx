'use client';

import { createElement, useEffect, useRef, useState } from 'react';

/** True once the element has scrolled into view (and stays true). */
function useInView<T extends Element>(margin = '0px 0px -12% 0px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, inView] as const;
}

/** A block that rises and fades into place when it scrolls into view. */
export function Reveal({
  as = 'div',
  delay = 0,
  className = '',
  children,
  ...rest
}: {
  as?: string;
  delay?: number;
  className?: string;
  children?: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const [ref, inView] = useInView<HTMLElement>();
  return createElement(
    as,
    {
      ...rest,
      ref,
      'data-in': inView,
      className: `reveal ${className}`,
      style: { ...(rest.style ?? {}), '--d': `${delay}ms` } as React.CSSProperties,
    },
    children,
  );
}

/**
 * A heading whose words rise one after another out of their own line boxes. The full text stays in
 * the accessibility tree as one string (each word is only visually wrapped).
 */
export function SplitReveal({
  as = 'h2',
  text,
  delay = 0,
  className = '',
  id,
}: {
  as?: 'h1' | 'h2' | 'h3' | 'p';
  text: string;
  delay?: number;
  className?: string;
  id?: string;
}) {
  const [ref, inView] = useInView<HTMLElement>('0px 0px -5% 0px');
  const words = text.split(' ');
  return createElement(
    as,
    { ref, id, 'data-in': inView, 'aria-label': text, className, style: { '--d': `${delay}ms` } as React.CSSProperties },
    words.map((w, i) => (
      <span key={i} aria-hidden="true">
        <span className="word">
          <span style={{ '--w': i } as React.CSSProperties}>{w}</span>
        </span>
        {i < words.length - 1 ? ' ' : ''}
      </span>
    )),
  );
}

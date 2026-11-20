import type React from 'react';

/**
 * A 3D tilt that follows the mouse, for cards: spread onto the element. It sets an inline transform
 * while the pointer is over the card and clears it on leave, so the card's own hover styles return.
 * `--gx`/`--gy` give the pointer position for a glare layer. Mouse only, and off with reduced motion.
 */
export const tilt = {
  onPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (e.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.transition = 'transform 120ms ease-out, box-shadow 300ms ease-out, border-color 300ms ease-out';
    el.style.transform = `perspective(900px) rotateX(${((0.5 - y) * 7).toFixed(2)}deg) rotateY(${((x - 0.5) * 9).toFixed(2)}deg) translateY(-4px)`;
    el.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
  },
  onPointerLeave(e: React.PointerEvent<HTMLElement>) {
    const el = e.currentTarget;
    el.style.transform = '';
    el.style.transition = '';
  },
};

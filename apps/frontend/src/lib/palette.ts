/**
 * Stable decorative colors for things without a color of their own (people, projects): the same id
 * always gets the same gradient. Every gradient is dark enough for white text (WCAG AA, 4.5:1) at
 * both ends. Written out in full so Tailwind can see the class names.
 */
export const GRADIENTS = [
  'from-indigo-600 to-violet-700',
  'from-blue-600 to-indigo-700',
  'from-cyan-700 to-blue-700',
  'from-teal-700 to-emerald-700',
  'from-emerald-700 to-teal-800',
  'from-amber-700 to-orange-700',
  'from-rose-600 to-pink-700',
  'from-fuchsia-700 to-purple-700',
  'from-violet-600 to-fuchsia-700',
  'from-pink-600 to-rose-700',
] as const;

/**
 * The same gradients as hex pairs, for drawing outside CSS (the 3D scenes). Kept in step with GRADIENTS
 * as Tailwind renders them: `indigo`/`violet` are the ink scale and `fuchsia` the red (tailwind.config.ts).
 */
export const GRADIENT_HEX: readonly (readonly [string, string])[] = [
  ['#2a2a2f', '#1c1c20'],
  ['#2563eb', '#1c1c20'],
  ['#0e7490', '#1d4ed8'],
  ['#0f766e', '#047857'],
  ['#047857', '#115e59'],
  ['#b45309', '#c2410c'],
  ['#e11d48', '#be185d'],
  ['#c21b1b', '#7e22ce'],
  ['#2a2a2f', '#c21b1b'],
  ['#db2777', '#be123c'],
];

/** A small, stable string hash (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The gradient classes for an id or name. */
export const gradientFor = (key: string) => GRADIENTS[hashString(key) % GRADIENTS.length]!;

/** The gradient for an id or name as two hex colors (matches gradientFor). */
export const gradientHexFor = (key: string) => GRADIENT_HEX[hashString(key) % GRADIENT_HEX.length]!;

/** "Good morning" / "Good afternoon" / "Good evening" for an hour of the day (0–23). */
export function greeting(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

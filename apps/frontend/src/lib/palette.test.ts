import { describe, expect, it } from 'vitest';
import { GRADIENTS, GRADIENT_HEX, gradientFor, gradientHexFor, greeting, hashString } from './palette';

describe('palette', () => {
  it('gives the same key the same gradient', () => {
    expect(gradientFor('project-1')).toBe(gradientFor('project-1'));
    expect(GRADIENTS).toContain(gradientFor('anything'));
  });

  it('spreads keys across the palette', () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => gradientFor(`id-${i}`)));
    expect(used.size).toBe(GRADIENTS.length);
  });

  it('hashes to an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', 'a much longer string with spaces']) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });

  it('greets by the time of day', () => {
    expect(greeting(3)).toBe('Good evening');
    expect(greeting(9)).toBe('Good morning');
    expect(greeting(14)).toBe('Good afternoon');
    expect(greeting(20)).toBe('Good evening');
  });
});

describe('GRADIENT_HEX', () => {
  it('has a hex pair for every gradient, so 3D scenes match the CSS colors', () => {
    expect(GRADIENT_HEX).toHaveLength(GRADIENTS.length);
    for (const pair of GRADIENT_HEX) for (const c of pair) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(GRADIENTS.indexOf(gradientFor('abc'))).toBe(GRADIENT_HEX.indexOf(gradientHexFor('abc')));
  });
});

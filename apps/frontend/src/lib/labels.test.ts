import { describe, expect, it } from 'vitest';
import { chipClasses, LABEL_COLORS, toggleLabel } from './labels';

describe('labels', () => {
  it('has chip classes for every palette color, in light and dark', () => {
    for (const color of LABEL_COLORS) {
      expect(chipClasses(color)).toMatch(/bg-\S+ text-\S+ dark:bg-\S+ dark:text-\S+/);
    }
  });

  it('falls back to gray for an unknown color', () => {
    expect(chipClasses('chartreuse')).toBe(chipClasses('gray'));
  });

  it('toggles one label in a set', () => {
    expect(toggleLabel(['a', 'b'], 'b')).toEqual(['a']);
    expect(toggleLabel(['a'], 'c')).toEqual(['a', 'c']);
  });
});

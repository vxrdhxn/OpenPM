import { describe, expect, it } from 'vitest';
import { initials, menuFocusTarget } from './menu';

describe('menuFocusTarget', () => {
  it('moves down and up, wrapping around', () => {
    expect(menuFocusTarget('ArrowDown', 0, 3)).toBe(1);
    expect(menuFocusTarget('ArrowDown', 2, 3)).toBe(0);
    expect(menuFocusTarget('ArrowUp', 0, 3)).toBe(2);
    expect(menuFocusTarget('ArrowUp', 2, 3)).toBe(1);
  });

  it('starts at the first or last item when nothing is focused yet', () => {
    expect(menuFocusTarget('ArrowDown', -1, 3)).toBe(0);
    expect(menuFocusTarget('ArrowUp', -1, 3)).toBe(2);
  });

  it('jumps to the ends with Home and End, and ignores other keys', () => {
    expect(menuFocusTarget('Home', 2, 3)).toBe(0);
    expect(menuFocusTarget('End', 0, 3)).toBe(2);
    expect(menuFocusTarget('Enter', 1, 3)).toBeNull();
    expect(menuFocusTarget('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('initials', () => {
  it.each([
    ['Ada Lovelace', 'AL'],
    ['ada', 'A'],
    ['  grace   brewster  hopper ', 'GH'],
    ['Émile Zola', 'ÉZ'],
    ['', '?'],
  ])('%j -> %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

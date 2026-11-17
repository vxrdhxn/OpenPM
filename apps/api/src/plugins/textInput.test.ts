import { describe, expect, it } from 'vitest';
import { containsNul } from './textInput';
import { isBadValue } from './errors';

describe('containsNul', () => {
  it.each([
    ['plain text', 'hello', false],
    ['a NUL in a string', 'a\u0000b', true],
    ['a NUL deep in an object', { a: [{ b: 'x\u0000' }] }, true],
    ['a NUL in a key', { ['k\u0000']: 1 }, true],
    ['numbers, nulls and booleans', { a: 1, b: null, c: true }, false],
    ['nothing', undefined, false],
  ])('%s', (_name, value, expected) => {
    expect(containsNul(value)).toBe(expected);
  });
});

describe('isBadValue', () => {
  it('treats Postgres data errors as the client’s, and nothing else', () => {
    for (const code of ['22001', '22021', '22P05', '22P02', '22003']) expect(isBadValue({ code })).toBe(true);
    for (const code of ['23505', '42P01', '57P01', undefined]) expect(isBadValue({ code })).toBe(false);
  });
});

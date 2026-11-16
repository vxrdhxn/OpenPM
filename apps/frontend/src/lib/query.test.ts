import { describe, expect, it } from 'vitest';
import { buildQuery } from './query';

describe('buildQuery', () => {
  it('leaves out empty values', () => {
    expect(buildQuery({ q: '', status: undefined, cursor: null })).toBe('');
  });

  it('repeats the key for arrays and encodes values', () => {
    expect(buildQuery({ priority: ['high', 'urgent'], q: 'a&b c', limit: 20 })).toBe('?priority=high&priority=urgent&q=a%26b+c&limit=20');
  });

  it('skips empty array entries', () => {
    expect(buildQuery({ priority: ['', 'low'] })).toBe('?priority=low');
  });
});

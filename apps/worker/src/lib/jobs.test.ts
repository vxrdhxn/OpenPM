import { describe, expect, it } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import { jobIdempotencyKey, optionalField, requireFields } from './jobs';

const job = (data: unknown, extra: Record<string, unknown> = {}) =>
  ({ id: '7', name: 'invite_created', timestamp: 123, data, ...extra }) as unknown as Job;

describe('requireFields', () => {
  it('returns the requested string fields', () => {
    expect(requireFields(job({ a: 'x', b: 'y', c: 'z' }), ['a', 'b'])).toEqual({ a: 'x', b: 'y' });
  });

  it.each([{}, { a: 'x' }, { a: 'x', b: '' }, { a: 'x', b: 5 }, null])(
    'fails unrecoverably for missing, empty or non-string fields: %o',
    (data) => {
      expect(() => requireFields(job(data), ['a', 'b'])).toThrow(UnrecoverableError);
    }
  );

  it('names the bad fields but never echoes values (they may be tokens)', () => {
    expect(() => requireFields(job({ a: 'secret-token-value', b: 9 }), ['a', 'b'])).toThrow(/invalid b$/);
    expect(() => requireFields(job({ token: 'x'.repeat(64), n: 4242 }), ['token', 'n'])).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('4242') })
    );
  });
});

describe('optionalField', () => {
  it('returns undefined for absent or null, the value for a string', () => {
    expect(optionalField(job({}), 'x')).toBeUndefined();
    expect(optionalField(job({ x: null }), 'x')).toBeUndefined();
    expect(optionalField(job({ x: 'v' }), 'x')).toBe('v');
  });

  it('fails unrecoverably for a malformed value', () => {
    expect(() => optionalField(job({ x: 3 }), 'x')).toThrow(UnrecoverableError);
  });
});

describe('jobIdempotencyKey', () => {
  it('is stable across retries of one job and differs between jobs', () => {
    expect(jobIdempotencyKey(job({}))).toBe('openpm/invite_created/7/123');
    expect(jobIdempotencyKey(job({}, { attemptsMade: 3 }))).toBe(jobIdempotencyKey(job({})));
    expect(jobIdempotencyKey(job({}, { id: '8' }))).not.toBe(jobIdempotencyKey(job({})));
  });
});

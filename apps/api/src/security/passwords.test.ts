import { describe, expect, it, vi } from 'vitest';

// A controllable bcrypt: every call waits until the test releases it.
const pending: Array<() => void> = [];
const calls: string[] = [];
vi.mock('bcrypt', () => {
  const slow = (op: string, result: unknown) =>
    new Promise((resolve) => {
      calls.push(op);
      pending.push(() => resolve(result));
    });
  const api = {
    hash: (pw: string) => slow('hash', `$2b$12$hashed-${pw}`),
    compare: (pw: string, hash: string) => slow('compare', hash === `$2b$12$hashed-${pw}`),
  };
  return { default: api, ...api };
});

import { BCRYPT_CONCURRENCY, bcryptQueue, hashPassword, verifyPassword } from './passwords';

const tick = () => new Promise((r) => setTimeout(r, 0));
const releaseAll = async () => {
  while (pending.length) {
    pending.shift()!();
    await tick();
  }
};

describe('passwords', () => {
  it('runs at most BCRYPT_CONCURRENCY bcrypt operations at once and queues the rest', async () => {
    expect(BCRYPT_CONCURRENCY).toBe(2);
    const jobs = [hashPassword('a'), hashPassword('b'), hashPassword('c'), hashPassword('d')];
    await tick();

    expect(bcryptQueue()).toEqual({ running: 2, waiting: 2 });
    expect(pending).toHaveLength(2);

    await releaseAll();
    expect(await Promise.all(jobs)).toEqual(['$2b$12$hashed-a', '$2b$12$hashed-b', '$2b$12$hashed-c', '$2b$12$hashed-d']);
    expect(bcryptQueue()).toEqual({ running: 0, waiting: 0 });
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const ok = verifyPassword('secret', '$2b$12$hashed-secret');
    const bad = verifyPassword('guess', '$2b$12$hashed-secret');
    await releaseAll();

    expect(await ok).toBe(true);
    expect(await bad).toBe(false);
  });

  it('still does a full comparison when there is no usable hash, then says no', async () => {
    calls.length = 0;
    const missing = verifyPassword('anything', undefined);
    const removed = verifyPassword('anything', '!removed');
    await releaseAll();
    await releaseAll();

    expect(await missing).toBe(false);
    expect(await removed).toBe(false);
    // Same work as a real check: a compare for each (the dummy hash is made once).
    expect(calls.filter((c) => c === 'compare')).toHaveLength(2);
  });
});

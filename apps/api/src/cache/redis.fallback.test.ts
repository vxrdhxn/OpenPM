import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake ioredis whose connection state and command results each test controls.
const { instances, options } = vi.hoisted(() => ({
  instances: [] as any[],
  options: [] as any[],
}));
vi.mock('ioredis', () => ({
  Redis: class {
    status = 'ready';
    handlers: Record<string, (...args: any[]) => void> = {};
    get = vi.fn();
    set = vi.fn();
    del = vi.fn();
    publish = vi.fn();
    ping = vi.fn();
    constructor(_url: string, opts: unknown) {
      instances.push(this);
      options.push(opts);
    }
    on(event: string, cb: (...args: any[]) => void) {
      this.handlers[event] = cb;
      return this;
    }
  },
}));
vi.mock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { cache, CACHE_COMMAND_TIMEOUT_MS } from './redis';
import { cacheBypassedTotal } from '../metrics';

const redis = () => instances[0]!;
const bypassed = async (operation: string, reason: string) =>
  (await cacheBypassedTotal.get()).values.find((v) => v.labels.operation === operation && v.labels.reason === reason)?.value ?? 0;
const flush = () => new Promise((r) => setImmediate(r));

describe('cache when Redis is unavailable', () => {
  beforeEach(async () => {
    const r = redis();
    r.status = 'ready';
    for (const fn of ['get', 'set', 'del', 'publish', 'ping']) r[fn].mockReset().mockResolvedValue(fn === 'get' ? null : 'OK');
    cacheBypassedTotal.reset();
    // Drain invalidations left over from a previous test.
    r.del.mockResolvedValue(1);
    r.handlers.ready?.();
    await flush();
    r.del.mockClear();
  });

  it('makes commands fail fast instead of queueing while disconnected', () => {
    expect(options[0]).toMatchObject({ enableOfflineQueue: false, autoResendUnfulfilledCommands: false });
  });

  it('works normally while Redis is up', async () => {
    redis().get.mockResolvedValue(JSON.stringify({ a: 1 }));

    expect(await cache.get('k')).toEqual({ a: 1 });
    await cache.set('k', { a: 2 }, 60);
    expect(redis().set).toHaveBeenCalledWith('k', '{"a":2}', 'EX', 60);
  });

  it('treats a disconnected Redis as a miss, without sending anything', async () => {
    redis().status = 'reconnecting';

    expect(await cache.get('k')).toBeNull();
    await expect(cache.set('k', { a: 1 }, 60)).resolves.toBeUndefined();

    expect(redis().get).not.toHaveBeenCalled();
    expect(redis().set).not.toHaveBeenCalled();
    expect(await bypassed('get', 'unavailable')).toBe(1);
    expect(await bypassed('set', 'unavailable')).toBe(1);
  });

  it('treats a failing command as a miss', async () => {
    redis().get.mockRejectedValue(new Error('Connection is closed.'));

    expect(await cache.get('k')).toBeNull();
    expect(await bypassed('get', 'error')).toBe(1);
  });

  it('gives up on a command that does not answer in time', async () => {
    vi.useFakeTimers();
    try {
      redis().get.mockReturnValue(new Promise(() => {}));

      const result = cache.get('k');
      await vi.advanceTimersByTimeAsync(CACHE_COMMAND_TIMEOUT_MS);

      expect(await result).toBeNull();
      expect(await bypassed('get', 'error')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never fails a write: invalidation and publish are best effort', async () => {
    redis().del.mockRejectedValue(new Error('down'));
    redis().publish.mockRejectedValue(new Error('down'));

    await expect(cache.del('k')).resolves.toBeUndefined();
    await expect(cache.publish('org:1:updates', { type: 'x' })).resolves.toBeUndefined();
  });

  it('retries missed invalidations once Redis is back', async () => {
    redis().status = 'reconnecting';
    await cache.del('org:1:projects');
    await cache.del('org:1:project:p:tasks');
    await cache.del('org:1:projects');
    expect(cache.pendingInvalidations()).toBe(2);

    redis().status = 'ready';
    redis().del.mockResolvedValue(2);
    redis().handlers.ready!();
    await flush();

    expect(redis().del).toHaveBeenCalledWith('org:1:projects', 'org:1:project:p:tasks');
    expect(cache.pendingInvalidations()).toBe(0);
  });

  it('keeps missed invalidations if the retry fails too', async () => {
    redis().status = 'reconnecting';
    await cache.del('org:1:projects');

    redis().status = 'ready';
    redis().del.mockRejectedValue(new Error('still flaky'));
    redis().handlers.ready!();
    await flush();

    expect(cache.pendingInvalidations()).toBe(1);
  });

  it('reports health through ping', async () => {
    expect(await cache.ping()).toBe(true);

    redis().ping.mockRejectedValue(new Error('down'));
    expect(await cache.ping()).toBe(false);

    redis().status = 'reconnecting';
    expect(await cache.ping()).toBe(false);
  });
});

describe('withEnvelope', () => {
  it('stamps objects with a unique event id and the publish time, leaving other values alone', async () => {
    const { withEnvelope } = await import('./redis.js');
    const a = withEnvelope({ type: 'labels_changed' }) as Record<string, string>;
    const b = withEnvelope({ type: 'labels_changed' }) as Record<string, string>;
    expect(a).toMatchObject({ type: 'labels_changed', event_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(new Date(a.published_at!).getTime()).not.toBeNaN();
    expect(a.event_id).not.toBe(b.event_id);
    expect(withEnvelope('text')).toBe('text');
    expect(withEnvelope([1])).toEqual([1]);
  });
});

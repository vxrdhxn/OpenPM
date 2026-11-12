import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fake ioredis: records each instance's event handlers so the tests can fire 'error' on it.
const { instances, logger } = vi.hoisted(() => ({
  instances: [] as Array<{ handlers: Record<string, (...args: any[]) => void> }>,
  logger: { error: vi.fn() },
}));
vi.mock('ioredis', () => ({
  Redis: class {
    handlers: Record<string, (...args: any[]) => void> = {};
    constructor() {
      instances.push(this);
    }
    on(event: string, cb: (...args: any[]) => void) {
      this.handlers[event] = cb;
      return this;
    }
    subscribe = vi.fn().mockResolvedValue(1);
    unsubscribe = vi.fn().mockResolvedValue(1);
  },
}));
vi.mock('../logger', () => ({ logger }));

import { cache } from './redis';
import { redisErrorsTotal } from '../metrics';

const errors = async (clientName: string) =>
  (await redisErrorsTotal.get()).values.find((v) => v.labels.client === clientName)?.value ?? 0;

describe('Redis error metrics', () => {
  beforeEach(() => {
    redisErrorsTotal.reset();
    logger.error.mockReset();
  });

  it('counts and logs errors on the main connection', async () => {
    const main = instances[0]!;
    const err = new Error('ECONNREFUSED');

    main.handlers.error!(err);
    main.handlers.error!(err);

    expect(await errors('main')).toBe(2);
    expect(await errors('subscriber')).toBe(0);
    expect(logger.error).toHaveBeenCalledWith({ err }, 'Redis connection error');
  });

  it('counts and logs errors on the subscriber connection, which exists only once something subscribes', async () => {
    expect(instances).toHaveLength(1); // lazy: no second connection yet

    await cache.subscribe('some-channel', () => undefined);
    const subscriber = instances[1]!;
    const err = new Error('subscriber lost');
    subscriber.handlers.error!(err);

    expect(await errors('subscriber')).toBe(1);
    expect(await errors('main')).toBe(0);
    expect(logger.error).toHaveBeenCalledWith({ err }, 'Redis subscriber connection error');
  });
});

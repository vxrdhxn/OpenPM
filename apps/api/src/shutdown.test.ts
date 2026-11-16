import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from './shutdown';

const log = () => ({ info: vi.fn(), error: vi.fn() });

describe('createShutdown', () => {
  it('closes the HTTP server first, then every resource, and exits 0', async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      app: { close: async () => void order.push('http') },
      resources: {
        queue: async () => void order.push('queue'),
        redis: async () => void order.push('redis'),
        database: async () => void order.push('database'),
      },
      log: log(),
      exit,
    });

    await shutdown('SIGTERM');

    expect(order[0]).toBe('http');
    expect(order.slice(1).sort()).toEqual(['database', 'queue', 'redis']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('does not start closing resources until the HTTP server has drained', async () => {
    let releaseHttp!: () => void;
    const closeDb = vi.fn(async () => {});
    const shutdown = createShutdown({
      app: { close: () => new Promise<void>((resolve) => (releaseHttp = resolve)) },
      resources: { database: closeDb },
      log: log(),
      exit: vi.fn(),
    });

    const done = shutdown('SIGTERM');
    await Promise.resolve();
    expect(closeDb).not.toHaveBeenCalled();

    releaseHttp();
    await done;
    expect(closeDb).toHaveBeenCalledOnce();
  });

  it('still closes the other resources when one fails, and exits 1', async () => {
    const logger = log();
    const exit = vi.fn();
    const closeDb = vi.fn(async () => {});
    const shutdown = createShutdown({
      app: { close: async () => {} },
      resources: { redis: async () => Promise.reject(new Error('ECONNREFUSED')), database: closeDb },
      log: logger,
      exit,
    });

    await shutdown('SIGTERM');

    expect(closeDb).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ resource: 'redis' }), expect.any(String));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('ignores a second signal while shutting down', async () => {
    const close = vi.fn(async () => {});
    const exit = vi.fn();
    const shutdown = createShutdown({ app: { close }, resources: {}, log: log(), exit });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it('exits 1 if closing hangs past the deadline', async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const shutdown = createShutdown({
        app: { close: () => new Promise(() => {}) },
        resources: {},
        log: log(),
        exit,
        timeoutMs: 1000,
      });

      void shutdown('SIGTERM');
      await vi.advanceTimersByTimeAsync(1000);

      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cache, db } = vi.hoisted(() => ({
  cache: { ping: vi.fn() },
  db: { query: vi.fn() },
}));
vi.mock('../cache/redis', () => ({ cache }));
vi.mock('../db/client', () => ({ db }));

import fastify from 'fastify';
import healthRoutes from './health';

describe('health routes', () => {
  async function get(url: string) {
    const app = fastify({ logger: false });
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url });
    await app.close();
    return res;
  }

  beforeEach(() => {
    db.query.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    cache.ping.mockReset().mockResolvedValue(true);
  });

  it('is ok when the database and Redis are up', async () => {
    const res = await get('/health');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('stays ready (200, degraded) when only Redis is down', async () => {
    cache.ping.mockResolvedValue(false);

    const res = await get('/health');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'ok', redis: 'error' });
  });

  it('is not ready (503) when the database is down', async () => {
    db.query.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await get('/health');

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'error', db: 'error' });
  });

  it('liveness checks no dependency', async () => {
    db.query.mockRejectedValue(new Error('ECONNREFUSED'));
    cache.ping.mockResolvedValue(false);

    const res = await get('/health/live');

    expect(res.statusCode).toBe(200);
    expect(db.query).not.toHaveBeenCalled();
    expect(cache.ping).not.toHaveBeenCalled();
  });
});

import crypto from 'crypto';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createRateLimitRedis } from '../../security/rateLimitStore';
import type { App } from './harness';

/**
 * Rate limits shared through Redis, as in production: two app instances stand in for two API pods.
 * Needs a real Redis (TEST_REDIS_URL; CI runs one), skipped without it.
 */
const REDIS_URL = process.env.TEST_REDIS_URL;

describe.skipIf(!REDIS_URL)('rate limiting shared across API instances (real Redis)', () => {
  const clients: Redis[] = [];
  const apps: App[] = [];

  async function instance(url = REDIS_URL!, { connected = true } = {}): Promise<App> {
    const rateLimitRedis = createRateLimitRedis(url);
    clients.push(rateLimitRedis);
    // Commands fail fast until connected (no offline queue), so wait as a running pod would have.
    if (connected) await new Promise((resolve) => rateLimitRedis.once('ready', resolve));
    const app = buildApp({ logger: false, rateLimitRedis });
    await app.ready();
    apps.push(app);
    return app;
  }

  // A fresh client address per test, so counters left in Redis by earlier runs do not count.
  const someAddress = () => `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`;
  const login = (app: App, remoteAddress: string) =>
    app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress, payload: { email: 'nobody@example.com', password: 'x' } });

  let podA: App;
  let podB: App;

  beforeAll(async () => {
    podA = await instance();
    podB = await instance();
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
    await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
  });

  it('counts sign-in attempts across instances: 10 a minute in total, not 10 per instance', async () => {
    const client = someAddress();
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await login(i % 2 ? podB : podA, client)).statusCode);
    expect(codes.every((c) => c === 401)).toBe(true);

    expect((await login(podA, client)).statusCode).toBe(429);
    expect((await login(podB, client)).statusCode).toBe(429);
    // Another client is not affected.
    expect((await login(podB, someAddress())).statusCode).toBe(401);
  });

  it('lets requests through, without hanging, when Redis is unreachable', async () => {
    const isolated = await instance('redis://127.0.0.1:1', { connected: false }); // nothing listens on port 1
    const client = someAddress();
    // A cheap request (no password hashing), well over the general limit of 100 a minute.
    const started = Date.now();
    const codes = new Set<number>();
    for (let i = 0; i < 110; i++) {
      codes.add((await isolated.inject({ method: 'GET', url: '/api/projects', remoteAddress: client })).statusCode);
    }
    expect([...codes]).toEqual([401]); // not counted, so never limited
    expect(Date.now() - started).toBeLessThan(10_000); // and no request waited on Redis
  });
});

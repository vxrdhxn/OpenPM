import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import client from 'prom-client';

// A pool double whose counters we control, so the pool gauges and query timing are observable.
const { pool } = vi.hoisted(() => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
    on: vi.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  },
}));
vi.mock('pg', () => ({ Pool: vi.fn().mockImplementation(() => pool) }));

import { db } from './db/client';
import authPlugin from './plugins/auth';
import { authFailuresTotal, dbQueryDurationSeconds } from './metrics';

/** prom-client sets `metricName` on histogram series (…_count, …_sum, …_bucket) but does not declare it. */
type Series = { value: number; labels: Partial<Record<string, string | number>>; metricName?: string };

/** Current value of one labelled series of a counter/gauge, or 0 if it has none yet. */
async function value(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric = client.register.getSingleMetric(name)!;
  const { values } = await metric.get();
  const match = values.find((v) => Object.entries(labels).every(([k, want]) => v.labels[k] === want));
  return match?.value ?? 0;
}

/** Number of observations recorded in one labelled series of a histogram. */
async function histogramCount(name: string, labels: Record<string, string>): Promise<number> {
  const { values } = await client.register.getSingleMetric(name)!.get();
  const series = (values as Series[]).find(
    (v) => v.metricName === `${name}_count` && Object.entries(labels).every(([k, want]) => v.labels[k] === want)
  );
  return series?.value ?? 0;
}

describe('db.query metrics', () => {
  beforeEach(() => {
    dbQueryDurationSeconds.reset();
    pool.query.mockReset();
  });

  it('records a successful query under outcome=ok, without the SQL text', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

    const rows = await db.query('SELECT secret_column FROM users WHERE email = $1', ['a@b.com']);

    expect(rows).toEqual([{ id: 1 }]);
    expect(await histogramCount('db_query_duration_seconds', { outcome: 'ok' })).toBe(1);
    expect(await histogramCount('db_query_duration_seconds', { outcome: 'error' })).toBe(0);
    // No label may carry query text or parameters.
    const { values } = await dbQueryDurationSeconds.get();
    expect(JSON.stringify(values)).not.toMatch(/secret_column|a@b\.com/);
  });

  it('records a failing query under outcome=error and still throws the original error', async () => {
    const boom = new Error('relation does not exist');
    pool.query.mockRejectedValue(boom);

    await expect(db.query('SELECT 1')).rejects.toBe(boom);

    expect(await histogramCount('db_query_duration_seconds', { outcome: 'error' })).toBe(1);
    expect(await histogramCount('db_query_duration_seconds', { outcome: 'ok' })).toBe(0);
  });

  it('observes a real duration (not zero for every query)', async () => {
    pool.query.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ rows: [], rowCount: 0 }), 30)));

    await db.query('SELECT pg_sleep(0)');

    const { values } = await dbQueryDurationSeconds.get();
    const sum = (values as Series[]).find((v) => v.metricName === 'db_query_duration_seconds_sum' && v.labels.outcome === 'ok')!.value;
    expect(sum).toBeGreaterThanOrEqual(0.02);
    expect(sum).toBeLessThan(2);
  });
});

describe('db pool gauges', () => {
  it('reports total, idle and waiting connections at scrape time', async () => {
    pool.totalCount = 7;
    pool.idleCount = 3;
    pool.waitingCount = 2;

    expect(await value('db_pool_connections', { state: 'total' })).toBe(7);
    expect(await value('db_pool_connections', { state: 'idle' })).toBe(3);
    expect(await value('db_pool_connections', { state: 'waiting' })).toBe(2);

    pool.waitingCount = 0;
    expect(await value('db_pool_connections', { state: 'waiting' })).toBe(0); // live, not a stale snapshot
  });
});

describe('auth failure metrics', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    authFailuresTotal.reset();
    app = Fastify();
    await app.register(cookie);
    await app.register(authPlugin);
    app.get('/secure', { preValidation: app.authenticate }, async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['missing', {}],
    ['invalid', { authorization: 'Bearer garbage' }],
  ])('counts a %s credential', async (reason, headers) => {
    await app.inject({ method: 'GET', url: '/secure', headers });

    expect(await value('auth_failures_total', { reason })).toBe(1);
  });

  it('counts an expired token', async () => {
    const expired = app.jwt.sign({ user_id: 'u', org_id: 'o', role: 'member', exp: Math.floor(Date.now() / 1000) - 60 });

    await app.inject({ method: 'GET', url: '/secure', headers: { authorization: `Bearer ${expired}` } });

    expect(await value('auth_failures_total', { reason: 'expired' })).toBe(1);
  });

  it('does not count successful authentication', async () => {
    const token = app.jwt.sign({ user_id: 'u', org_id: 'o', role: 'member' });

    const res = await app.inject({ method: 'GET', url: '/secure', headers: { authorization: `Bearer ${token}` } });

    expect(res.statusCode).toBe(200);
    const { values } = await authFailuresTotal.get();
    expect(values.reduce((n, v) => n + v.value, 0)).toBe(0);
  });

  it('accumulates across requests', async () => {
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: '/secure' });

    expect(await value('auth_failures_total', { reason: 'missing' })).toBe(3);
  });
});

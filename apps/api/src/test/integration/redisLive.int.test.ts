import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';

/**
 * The cache and live events through a REAL Redis (TEST_REDIS_URL; CI runs one, skipped without it).
 * Every other integration file replaces the cache with an in-memory fake (setup.ts); this one undoes
 * that before loading anything, so the app below runs exactly as in production: board cache stored
 * in and invalidated in Redis, events published to Redis and relayed by the pub/sub hub to a socket.
 */
const REDIS_URL = process.env.TEST_REDIS_URL;

describe.skipIf(!REDIS_URL)('cache and live events (real Redis)', () => {
  let app: FastifyInstance;
  let base: string;
  let token: string;
  let projectId: string;
  let cache: typeof import('../../cache/redis')['cache'];
  let boardCacheKey: typeof import('../../services/tasks')['boardCacheKey'];
  let orgId: string;

  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    vi.doUnmock('../../cache/redis');
    ({ cache } = await import('../../cache/redis.js'));
    ({ boardCacheKey } = await import('../../services/tasks.js'));
    const { buildApp } = await import('../../app.js');
    app = buildApp({ logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `127.0.0.1:${(app.server.address() as { port: number }).port}`;
    // The cache client connects in the background; wait until it answers.
    for (let i = 0; i < 100 && !(await cache.ping()); i++) await new Promise((r) => setTimeout(r, 100));
    if (!(await cache.ping())) throw new Error(`Redis at ${REDIS_URL} did not answer`);

    const id = Math.random().toString(16).slice(2, 10);
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { org_name: `Org ${id}`, org_slug: `live-${id}`, email: `live-${id}@example.com`, password: 'password123', name: 'Live' },
    });
    token = reg.json().token;
    orgId = app.jwt.decode<{ org_id: string }>(token)!.org_id;
    projectId = (await app.inject({ method: 'POST', url: '/api/projects', headers: auth(), payload: { name: 'Live' } })).json().id;
  });

  afterAll(async () => {
    await app?.close();
    const { closeRedis } = await import('../../cache/redis.js');
    await closeRedis();
  });

  it('stores the board in Redis, serves it from there, and drops it when the board changes', async () => {
    const key = boardCacheKey(orgId, projectId);
    await cache.del(key);
    const board = () => app.inject({ method: 'GET', url: `/api/projects/${projectId}/tasks`, headers: auth() });

    const first = await board();
    expect(first.statusCode).toBe(200);
    const stored = await cache.getRaw(key);
    expect(stored?.json).toBe(first.body); // what was sent is what is stored, byte for byte
    // And it really is in Redis, not in a fake: read it with a separate connection.
    const direct = new Redis(REDIS_URL!);
    try {
      expect(await direct.get(key)).toBe(first.body);
    } finally {
      direct.disconnect();
    }

    expect((await board()).body).toBe(first.body); // the hit is served as stored

    await app.inject({ method: 'POST', url: `/api/projects/${projectId}/tasks`, headers: auth(), payload: { title: 'New one' } });
    expect(await cache.getRaw(key)).toBeNull();
    expect((await board()).json().todo.map((t: { title: string }) => t.title)).toContain('New one');
  });

  it('delivers an event published by the API to an open socket of the organization, with its envelope', async () => {
    const ws = new WebSocket(`ws://${base}/ws`, { headers: { cookie: `auth_token=${token}` } });
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (data) => messages.push(JSON.parse(String(data))));
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    // The server subscribes to the organization's channel after the handshake: give it a moment.
    await new Promise((r) => setTimeout(r, 300));

    const created = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/tasks`, headers: auth(), payload: { title: 'Pushed' } });
    expect(created.statusCode).toBe(201);

    await expect.poll(() => messages.find((m) => m.type === 'task_created'), { timeout: 5_000 }).toBeDefined();
    const event = messages.find((m) => m.type === 'task_created')!;
    expect(event).toMatchObject({ project_id: projectId, task: { title: 'Pushed' }, event_id: expect.any(String), published_at: expect.any(String) });
    ws.close();
  });
});

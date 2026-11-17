import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

vi.mock('./cache/redis', () => ({
  cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), publish: vi.fn(), ping: vi.fn(), subscribe: vi.fn(async () => () => undefined) },
}));
// No database here: nobody is outside any private project.
vi.mock('./security/projectAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./security/projectAccess')>()),
  hiddenProjectIds: async () => new Set<string>(),
}));
vi.mock('./plugins/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('./plugins/auth')>();
  // The app's auth plugin, trusting token claims (no database in this test).
  const { default: fp } = await import('fastify-plugin');
  return { ...real, default: fp(async (app, _opts) => app.register(real.default, { verifySession: async (c) => ({ role: c.role }) })) };
});

import { buildApp } from './app';

/** Graceful shutdown tells WebSocket clients it is a restart (1001), not a broken connection. */
describe('WebSocket clients on shutdown', () => {
  let app: ReturnType<typeof buildApp> | undefined;

  afterEach(async () => {
    await app?.close().catch(() => undefined);
  });

  it('closes open sockets with 1001 Going Away', async () => {
    app = buildApp({ logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const token = app.jwt.sign({ user_id: 'u1', org_id: 'o1', role: 'viewer' });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: `Bearer ${token}` } });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    );

    await app.close();
    app = undefined;

    expect(await closed).toEqual({ code: 1001, reason: 'Server restarting' });
  }, 20_000); // builds and starts the whole app, which is slow when the suite runs in parallel
});

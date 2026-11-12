import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';

vi.mock('../cache/redis', () => ({
  cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), publish: vi.fn(), subscribe: vi.fn() },
}));

import { cache } from '../cache/redis';
import { config } from '../config';
import authPlugin from '../plugins/auth';
import websocketRoutes from './websocket';

type Handler = (message: unknown, raw: string) => void;
interface Client {
  ws: WebSocket;
  /** Resolves with the close code/reason, whichever side closed. */
  closed: Promise<{ code: number; reason: string }>;
}

// These tests use a real TCP server and the real `ws` client. Fastify's in-memory injectWS
// never fully closes its streams, so server-side close/cleanup can't be observed with it.
describe('GET /ws', () => {
  let app: ReturnType<typeof Fastify>;
  let port: number;
  let clients: WebSocket[];
  let handlers: Map<string, Handler>;
  let unsubscribe: ReturnType<typeof vi.fn>;

  async function build(heartbeatMs?: number) {
    app = Fastify();
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(websocket);
    await app.register(websocketRoutes, { heartbeatMs });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as { port: number }).port;
  }

  function connect(
    opts: { headers?: Record<string, string>; path?: string; autoPong?: boolean } = {}
  ): Client {
    // Only pass autoPong when set: ws spreads options over its defaults, so an explicit
    // `undefined` would silently turn automatic pong replies off.
    const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? '/ws'}`, {
      headers: opts.headers,
      ...(opts.autoPong === undefined ? {} : { autoPong: opts.autoPong }),
    });
    clients.push(ws);
    const closed = new Promise<{ code: number; reason: string }>((resolve) =>
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
    );
    // A server that closes straight after the upgrade can surface as an error; the close
    // event is what these tests assert on.
    ws.on('error', () => undefined);
    return { ws, closed };
  }

  const open = (c: Client) => new Promise<void>((resolve) => c.ws.once('open', () => resolve()));
  const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

  const tokenFor = (org = 'org-1', extra: Record<string, unknown> = {}, opts: { expiresIn?: number } = {}) =>
    app.jwt.sign({ user_id: 'u1', org_id: org, role: 'viewer', ...extra }, opts);
  const asCookie = (token: string) => ({ cookie: `auth_token=${token}` });

  beforeEach(() => {
    vi.resetAllMocks();
    clients = [];
    handlers = new Map();
    unsubscribe = vi.fn();
    vi.mocked(cache.subscribe).mockImplementation(async (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
      return unsubscribe as unknown as () => void;
    });
  });

  afterEach(async () => {
    clients.forEach((ws) => ws.terminate());
    await app.close();
  });

  describe('authentication', () => {
    beforeEach(() => build());

    it('rejects a connection with no credentials', async () => {
      const c = connect();
      expect(await c.closed).toMatchObject({ code: 1008, reason: 'Unauthorized' });
      expect(cache.subscribe).not.toHaveBeenCalled();
    });

    it('rejects an invalid token', async () => {
      const c = connect({ headers: asCookie('garbage') });
      expect((await c.closed).code).toBe(1008);
      expect(cache.subscribe).not.toHaveBeenCalled();
    });

    it('rejects an expired token', async () => {
      const expired = tokenFor('org-1', { exp: Math.floor(Date.now() / 1000) - 60 });
      const c = connect({ headers: asCookie(expired) });
      expect((await c.closed).code).toBe(1008);
      expect(cache.subscribe).not.toHaveBeenCalled();
    });

    it('accepts the httpOnly auth cookie and subscribes to the JWT org channel', async () => {
      const c = connect({ headers: asCookie(tokenFor('org-42')) });
      await open(c);
      await tick();

      expect(cache.subscribe).toHaveBeenCalledWith('org:org-42:updates', expect.any(Function));
    });

    it('accepts an Authorization bearer token for non-browser clients', async () => {
      const c = connect({ headers: { authorization: `Bearer ${tokenFor('org-7')}` } });
      await open(c);
      await tick();

      expect(cache.subscribe).toHaveBeenCalledWith('org:org-7:updates', expect.any(Function));
    });

    it('no longer accepts a token in the query string', async () => {
      const c = connect({ path: `/ws?token=${tokenFor('org-1')}` });
      expect((await c.closed).code).toBe(1008);
      expect(cache.subscribe).not.toHaveBeenCalled();
    });
  });

  describe('origin check (cross-site WebSocket hijacking)', () => {
    beforeEach(() => build());

    const headers = (origin?: string) => ({ ...asCookie(tokenFor()), ...(origin ? { origin } : {}) });

    it('rejects a cross-site origin even with a valid cookie', async () => {
      const c = connect({ headers: headers('https://evil.example') });
      expect(await c.closed).toMatchObject({ code: 1008, reason: 'Origin not allowed' });
      expect(cache.subscribe).not.toHaveBeenCalled();
    });

    it('allows the configured frontend origin', async () => {
      const c = connect({ headers: headers(config.CORS_ORIGIN) });
      await open(c);
      await tick();
      expect(cache.subscribe).toHaveBeenCalledTimes(1);
    });

    it('allows requests without an Origin header (non-browser clients)', async () => {
      const c = connect({ headers: headers() });
      await open(c);
      await tick();
      expect(cache.subscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('message delivery', () => {
    beforeEach(() => build());

    it('forwards published events to the client verbatim', async () => {
      const c = connect({ headers: asCookie(tokenFor('org-1')) });
      const received = new Promise<string>((resolve) => c.ws.on('message', (d) => resolve(d.toString())));
      await open(c);
      await tick();

      const raw = '{"type":"task_created","task":{"id":"t1"}}';
      handlers.get('org:org-1:updates')!(JSON.parse(raw), raw);

      expect(await received).toBe(raw);
    });

    it('only subscribes a client to its own org, never one named by the client', async () => {
      const c = connect({
        path: '/ws?org_id=org-other&channel=org:org-other:updates',
        headers: asCookie(tokenFor('org-1')),
      });
      await open(c);
      await tick();

      expect([...handlers.keys()]).toEqual(['org:org-1:updates']);
    });
  });

  describe('cleanup', () => {
    beforeEach(() => build());

    it('unsubscribes when the client disconnects', async () => {
      const c = connect({ headers: asCookie(tokenFor()) });
      await open(c);
      await tick();
      expect(unsubscribe).not.toHaveBeenCalled();

      c.ws.close();
      await c.closed;
      await tick();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('does not leak the subscription if the client leaves while subscribing', async () => {
      let finish!: () => void;
      const gate = new Promise<void>((r) => (finish = r));
      vi.mocked(cache.subscribe).mockImplementation(async () => {
        await gate; // Redis confirmation is slow
        return unsubscribe as unknown as () => void;
      });

      const c = connect({ headers: asCookie(tokenFor()) });
      await open(c);
      await tick();
      c.ws.close(); // disconnect before subscribe() resolves
      await c.closed;
      await tick();
      expect(unsubscribe).not.toHaveBeenCalled();

      finish();
      await tick();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('closes the socket if the subscription fails', async () => {
      vi.mocked(cache.subscribe).mockRejectedValue(new Error('redis down'));

      const c = connect({ headers: asCookie(tokenFor()) });

      expect((await c.closed).code).toBe(1011);
    });
  });

  describe('token expiry', () => {
    beforeEach(() => build());

    it('closes the socket when its JWT expires and releases the subscription', async () => {
      const c = connect({ headers: asCookie(tokenFor('org-1', {}, { expiresIn: 1 })) });

      const info = await c.closed;

      expect(info).toMatchObject({ code: 1008, reason: 'Token expired' });
      await tick();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }, 5000);
  });

  describe('heartbeat', () => {
    it('keeps a responsive client connected across many intervals', async () => {
      await build(25);
      const c = connect({ headers: asCookie(tokenFor()) });
      let closed = false;
      c.ws.on('close', () => (closed = true));
      await open(c);

      await tick(250); // ~10 heartbeats; the ws client answers pings automatically

      expect(closed).toBe(false);
      expect(unsubscribe).not.toHaveBeenCalled();
    });

    it('terminates a client that stops answering pings and releases its subscription', async () => {
      await build(25);
      const c = connect({ headers: asCookie(tokenFor()), autoPong: false });
      await open(c);

      await c.closed; // server drops the silent peer

      await tick();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }, 5000);
  });
});

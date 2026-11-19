import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';

// Private projects: which ones this user cannot see (no database in these tests).
vi.mock('../security/projectAccess', () => ({ hiddenProjectIds: vi.fn() }));
vi.mock('../cache/redis', () => ({
  cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), publish: vi.fn(), subscribe: vi.fn() },
}));

import { cache } from '../cache/redis';
import { hiddenProjectIds } from '../security/projectAccess';
import { config } from '../config';
import { activeWebsocketConnections, websocketErrorsTotal, websocketRejectionsTotal } from '../metrics';
import { TRUST_TOKEN_CLAIMS } from '../test/auth';
import authPlugin, { type AuthPluginOptions } from '../plugins/auth';
import websocketRoutes, { MAX_PENDING_EVENTS } from './websocket';

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

  async function build(
    heartbeatMs?: number,
    authOptions: AuthPluginOptions = TRUST_TOKEN_CLAIMS,
    limits: { maxConnections?: number; maxPerUser?: number; maxBufferedBytes?: number } = {}
  ) {
    app = Fastify();
    await app.register(cookie);
    await app.register(authPlugin, authOptions);
    await app.register(websocket);
    await app.register(websocketRoutes, { heartbeatMs, ...limits });
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
    vi.mocked(hiddenProjectIds).mockResolvedValue(new Set());
  });

  afterEach(async () => {
    clients.forEach((ws) => ws.terminate());
    await app.close();
  });

  describe('limits and backpressure', () => {
    it('caps sockets per user, and frees the slot when one closes', async () => {
      await build(undefined, TRUST_TOKEN_CLAIMS, { maxPerUser: 2 });
      const a = connect({ headers: asCookie(tokenFor()) });
      const b = connect({ headers: asCookie(tokenFor()) });
      await Promise.all([open(a), open(b)]);
      await tick();

      const third = connect({ headers: asCookie(tokenFor()) });
      expect(await third.closed).toMatchObject({ code: 1008, reason: 'Too many connections' });

      // Another user is not affected.
      const other = connect({ headers: asCookie(tokenFor('org-1', { user_id: 'u2' })) });
      await open(other);

      a.ws.close();
      await a.closed;
      await tick();
      const again = connect({ headers: asCookie(tokenFor()) });
      await open(again);
      await tick();
      expect(again.ws.readyState).toBe(WebSocket.OPEN);
    });

    it('refuses with 1013 (try again later) when the pod is full', async () => {
      await build(undefined, TRUST_TOKEN_CLAIMS, { maxConnections: 1 });
      const first = connect({ headers: asCookie(tokenFor()) });
      await open(first);
      await tick();

      const second = connect({ headers: asCookie(tokenFor('org-1', { user_id: 'u2' })) });
      expect(await second.closed).toMatchObject({ code: 1013, reason: 'Server busy' });
    });

    it('closes a client that falls too far behind instead of queueing without limit', async () => {
      await build();
      // The first access load never finishes, so every event waits behind it.
      vi.mocked(hiddenProjectIds).mockReturnValue(new Promise(() => undefined));
      const c = connect({ headers: asCookie(tokenFor()) });
      await open(c);
      await tick();

      const handler = handlers.get('org:org-1:updates')!;
      for (let i = 0; i <= MAX_PENDING_EVENTS; i++) handler({ type: 'labels_changed' }, '{"type":"labels_changed"}');

      expect(await c.closed).toMatchObject({ code: 1013, reason: 'Too slow' });
    });
  });

  describe('session revocation', () => {
    it('refuses a token whose session was revoked', async () => {
      await build(undefined, { verifySession: async () => null });

      const c = connect({ headers: asCookie(tokenFor()) });

      expect(await c.closed).toMatchObject({ code: 1008, reason: 'Unauthorized' });
      expect(cache.subscribe).not.toHaveBeenCalled();
    });

    it('closes an open socket at the next heartbeat once its session is revoked', async () => {
      let current = true;
      await build(100, { verifySession: async (claims) => (current ? { role: claims.role } : null) });
      websocketRejectionsTotal.reset();

      const c = connect({ headers: asCookie(tokenFor()) });
      await open(c);
      await tick(250); // two heartbeats with the session still current
      expect(c.ws.readyState).toBe(WebSocket.OPEN);

      current = false; // e.g. the user logged out on another device

      expect(await c.closed).toMatchObject({ code: 1008, reason: 'Session revoked' });
      // The server releases the subscription when its side of the close completes, which can be
      // just after the client sees the close frame.
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled(), { timeout: 2000 });
      const revoked = (await websocketRejectionsTotal.get()).values.find((v) => v.labels.reason === 'revoked');
      expect(revoked?.value).toBe(1);
    });

    it('keeps the socket when the re-check itself fails (database blip)', async () => {
      let calls = 0;
      await build(100, {
        verifySession: async (claims) => {
          calls += 1;
          if (calls > 1) throw new Error('db down');
          return { role: claims.role };
        },
      });

      const c = connect({ headers: asCookie(tokenFor()) });
      await open(c);
      await vi.waitFor(() => expect(calls).toBeGreaterThan(2), { timeout: 2000 });

      expect(calls).toBeGreaterThan(2);
      expect(c.ws.readyState).toBe(WebSocket.OPEN);
    });
  });

  describe('client messages', () => {
    it('refuses anything a client sends, unread, and closes the socket', async () => {
      await build();
      websocketRejectionsTotal.reset();
      const c = connect({ headers: asCookie(tokenFor()) });
      await open(c);
      await vi.waitFor(() => expect(cache.subscribe).toHaveBeenCalled());

      c.ws.send(JSON.stringify({ type: 'subscribe', channel: 'org:someone-else:updates', __proto__: { admin: true } }));

      expect(await c.closed).toMatchObject({ code: 1008, reason: 'This socket does not accept messages' });
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalled(), { timeout: 2000 });
      const refused = (await websocketRejectionsTotal.get()).values.find((v) => v.labels.reason === 'client_message');
      expect(refused?.value).toBe(1);
      // Still only its own organization's channel.
      expect([...handlers.keys()]).toEqual(['org:org-1:updates']);
    });
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

    /** Opens a client and collects what it receives. */
    async function receiver() {
      const c = connect({ headers: asCookie(tokenFor('org-1')) });
      const got: string[] = [];
      c.ws.on('message', (d) => got.push(d.toString()));
      await open(c);
      await tick();
      const publish = (event: object) => handlers.get('org:org-1:updates')!(event, JSON.stringify(event));
      return { got, publish };
    }

    it('drops events about private projects the user cannot see, and forwards the rest', async () => {
      vi.mocked(hiddenProjectIds).mockResolvedValue(new Set(['secret']));
      const { got, publish } = await receiver();

      publish({ type: 'task_created', project_id: 'secret', task: { title: 'Payroll' } });
      publish({ type: 'task_created', project_id: 'open', task: { title: 'Launch' } });
      publish({ type: 'labels_changed' });
      await tick();

      expect(got.map((m) => JSON.parse(m).project_id ?? JSON.parse(m).type)).toEqual(['open', 'labels_changed']);
      expect(got.join()).not.toContain('Payroll');
    });

    it('reloads access when it changes, in order with the events around it', async () => {
      vi.mocked(hiddenProjectIds).mockResolvedValueOnce(new Set(['p'])).mockResolvedValue(new Set());
      const { got, publish } = await receiver();

      publish({ type: 'task_updated', project_id: 'p', n: 1 }); // still hidden
      publish({ type: 'project_access_changed', project_id: 'p' }); // e.g. the user was added
      publish({ type: 'task_updated', project_id: 'p', n: 2 }); // now visible
      await tick();

      expect(got.map((m) => JSON.parse(m).n ?? JSON.parse(m).type)).toEqual(['project_access_changed', 2]);
    });

    it('sends nothing about any project until it knows what the user may see', async () => {
      vi.mocked(hiddenProjectIds).mockRejectedValue(new Error('db down'));
      const { got, publish } = await receiver();

      publish({ type: 'task_created', project_id: 'any' });
      publish({ type: 'notification', user_ids: ['u1'] });
      await tick();

      expect(got.map((m) => JSON.parse(m).type)).toEqual(['notification']);
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
      // 2 s, not 1: exp is whole seconds after a floored iat, so a 1 s token signed late in a second
      // can expire before the handshake and be refused instead of closed (seen as a flaky failure).
      const c = connect({ headers: asCookie(tokenFor('org-1', {}, { expiresIn: 2 })) });

      const info = await c.closed;

      expect(info).toMatchObject({ code: 1008, reason: 'Token expired' });
      await tick();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }, 5000);
  });

  describe('active_websocket_connections metric', () => {
    beforeEach(() => build());

    const gauge = async () => (await activeWebsocketConnections.get()).values[0]?.value ?? 0;
    const until = async (expected: number) => {
      for (let i = 0; i < 100; i++) {
        if ((await gauge()) === expected) return;
        await tick(10);
      }
      expect(await gauge()).toBe(expected);
    };

    beforeEach(async () => {
      await until(0); // let any socket from a previous test finish closing
    });

    it('counts authenticated connections up and back down on disconnect', async () => {
      const a = connect({ headers: asCookie(tokenFor()) });
      const b = connect({ headers: asCookie(tokenFor('org-2')) });
      await Promise.all([open(a), open(b)]);
      await until(2);

      a.ws.close();
      await a.closed;
      await until(1);

      b.ws.close();
      await b.closed;
      await until(0);
    });

    it('does not count rejected connections', async () => {
      const noAuth = connect();
      const badOrigin = connect({ headers: { ...asCookie(tokenFor()), origin: 'https://evil.example' } });
      await Promise.all([noAuth.closed, badOrigin.closed]);
      await tick();

      expect(await gauge()).toBe(0);
    });

    it('decrements when the server expires the session', async () => {
      // 2 s, not 1: exp is whole seconds after a floored iat, so a 1 s token signed late in a second
      // can expire before the handshake and be refused instead of closed (seen as a flaky failure).
      const c = connect({ headers: asCookie(tokenFor('org-1', {}, { expiresIn: 2 })) });
      await open(c);
      await until(1);

      await c.closed; // server closes at JWT expiry

      await until(0);
    }, 5000);

    it('decrements when a connection is dropped for missing heartbeats', async () => {
      await app.close();
      await build(25);
      const c = connect({ headers: asCookie(tokenFor()), autoPong: false });
      await open(c);
      await until(1);

      await c.closed;

      await until(0);
    }, 5000);
  });

  describe('rejection and error metrics', () => {
    beforeEach(() => build());

    const rejections = async (reason: string) =>
      (await websocketRejectionsTotal.get()).values.find((v) => v.labels.reason === reason)?.value ?? 0;

    beforeEach(() => {
      websocketRejectionsTotal.reset();
      websocketErrorsTotal.reset();
    });

    it('counts an unauthenticated connection as unauthorized', async () => {
      await connect().closed;
      expect(await rejections('unauthorized')).toBe(1);
    });

    it('counts a bad token as unauthorized', async () => {
      await connect({ headers: asCookie('garbage') }).closed;
      expect(await rejections('unauthorized')).toBe(1);
    });

    it('counts a cross-site origin as origin', async () => {
      await connect({ headers: { ...asCookie(tokenFor()), origin: 'https://evil.example' } }).closed;
      expect(await rejections('origin')).toBe(1);
      expect(await rejections('unauthorized')).toBe(0);
    });

    it('counts a failed subscription as subscription_failed', async () => {
      vi.mocked(cache.subscribe).mockRejectedValue(new Error('redis down'));

      await connect({ headers: asCookie(tokenFor()) }).closed;

      expect(await rejections('subscription_failed')).toBe(1);
    });

    it('counts nothing for a healthy connection', async () => {
      const c = connect({ headers: asCookie(tokenFor()) });
      await open(c);
      await tick();

      const total = (await websocketRejectionsTotal.get()).values.reduce((n, v) => n + v.value, 0);
      expect(total).toBe(0);
    });

    it('counts socket-level errors', async () => {
      const c = connect({ headers: asCookie(tokenFor()) });
      await open(c);
      await tick();

      const [serverSide] = [...app.websocketServer.clients];
      serverSide!.emit('error', new Error('ECONNRESET'));

      expect((await websocketErrorsTotal.get()).values[0]?.value).toBe(1);
    });
  });

  describe('heartbeat', () => {
    it('keeps a responsive client connected across many intervals', async () => {
      // 100ms, not shorter: a pong must come back within one interval, and on a loaded machine (the
      // whole monorepo's tests at once, a CI runner) a 25ms window was occasionally missed.
      await build(100);
      const c = connect({ headers: asCookie(tokenFor()) });
      let closed = false;
      c.ws.on('close', () => (closed = true));
      await open(c);

      await tick(650); // ~6 heartbeats; the ws client answers pings automatically

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

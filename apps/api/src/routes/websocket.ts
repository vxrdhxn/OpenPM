import { FastifyPluginAsync } from 'fastify';
import { cache } from '../cache/redis';
import { config } from '../config';
import { activeWebsocketConnections, websocketErrorsTotal, websocketRejectionsTotal } from '../metrics';
import { hiddenProjectIds } from '../security/projectAccess';
import { issueTicket, redeemTicket, TICKET_TTL_SECONDS } from '../realtime/tickets';

export interface WebsocketRouteOptions {
  /** Ping interval. A client that misses a whole interval without answering is dropped. */
  heartbeatMs?: number;
  /** Sockets this pod serves at once (WS_MAX_CONNECTIONS). */
  maxConnections?: number;
  /** Sockets one user may hold on this pod (WS_MAX_CONNECTIONS_PER_USER). */
  maxPerUser?: number;
  /** Unsent bytes one socket may queue before it is closed as too slow (WS_MAX_BUFFERED_BYTES). */
  maxBufferedBytes?: number;
}

/** Events waiting to be checked and sent for one socket; beyond this the socket is closed as too slow. */
export const MAX_PENDING_EVENTS = 1000;

// setTimeout's maximum delay (2^31-1 ms); longer values fire immediately.
const MAX_TIMER_MS = 2_147_483_647;

/**
 * GET /ws: realtime updates for the caller's organization.
 *
 * Auth, one of:
 * - `?ticket=`, a single-use 30-second ticket from POST /api/realtime/ticket (realtime/tickets.ts). The
 *   browser client always uses one, so the socket works when the API is on another domain than the
 *   frontend (Vercel) and the cookie is not sent with the handshake.
 * - the httpOnly `auth_token` cookie (sent automatically by browsers on a same-site handshake);
 * - an `Authorization: Bearer` header for non-browser clients.
 * Session tokens in the URL are NOT accepted, since query strings end up in access logs and proxies.
 *
 * Because the cookie authenticates the socket, the handshake's Origin is checked to stop
 * cross-site WebSocket hijacking.
 */
const websocketRoutes: FastifyPluginAsync<WebsocketRouteOptions> = async (fastify, opts) => {
  const heartbeatMs = opts.heartbeatMs ?? 30_000;
  const maxConnections = opts.maxConnections ?? config.WS_MAX_CONNECTIONS;
  const maxPerUser = opts.maxPerUser ?? config.WS_MAX_CONNECTIONS_PER_USER;
  const maxBufferedBytes = opts.maxBufferedBytes ?? config.WS_MAX_BUFFERED_BYTES;

  // Sockets on this pod, in total and per user (docs/realtime.md).
  let open = 0;
  const perUser = new Map<string, number>();

  // A ticket for one socket (realtime/tickets.ts). Through the frontend's proxy, so the cookie authenticates it.
  fastify.post('/api/realtime/ticket', {
    preValidation: [fastify.authenticate],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const ticket = await issueTicket(request.user);
    // Without Redis there are no live updates anyway; the client retries with backoff.
    if (!ticket) return reply.code(503).send({ error: 'Live updates are unavailable right now' });
    return { ticket, expires_in: TICKET_TTL_SECONDS };
  });

  fastify.get<{ Querystring: { ticket?: string } }>('/ws', { websocket: true }, async (socket, request) => {

    // Everything that must be torn down when the socket goes away. Registered before any
    // `await`, so a client that disconnects mid-setup can never leak a subscription.
    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let expiry: NodeJS.Timeout | null = null;

    let counted = false; // whether this socket is currently included in the connections gauge
    let countedUser: string | null = null; // whose per-user count includes this socket

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (counted) {
        activeWebsocketConnections.dec();
        open--;
      }
      if (countedUser) {
        const n = (perUser.get(countedUser) ?? 1) - 1;
        if (n <= 0) perUser.delete(countedUser);
        else perUser.set(countedUser, n);
      }
      if (heartbeat) clearInterval(heartbeat);
      if (expiry) clearTimeout(expiry);
      unsubscribe?.();
    };
    socket.on('close', cleanup);
    socket.on('error', (err) => {
      websocketErrorsTotal.inc();
      fastify.log.warn(err, 'WS socket error');
    });
    // The socket only carries server events: clients have nothing to send. Any message is refused
    // unread and the socket closed (1008, so the browser client does not reconnect in a loop), which
    // leaves no client payload to parse or validate. Frames over 4 KiB are cut off earlier (app.ts).
    socket.on('message', () => {
      if (closed) return;
      websocketRejectionsTotal.inc({ reason: 'client_message' });
      socket.close(1008, 'This socket does not accept messages');
    });

    const origin = request.headers.origin;
    if (origin && origin !== config.CORS_ORIGIN) {
      fastify.log.warn({ origin }, 'WS rejected: origin not allowed');
      websocketRejectionsTotal.inc({ reason: 'origin' });
      socket.close(1008, 'Origin not allowed');
      return;
    }

    // A full pod refuses before doing any work. 1013 ("try again later"): the browser client retries
    // with backoff, possibly reaching another pod.
    if (open >= maxConnections) {
      websocketRejectionsTotal.inc({ reason: 'pod_full' });
      socket.close(1013, 'Server busy');
      return;
    }

    // Token signature/expiry AND the session still being current (not revoked, user still exists).
    let check;
    try {
      const ticket = request.query.ticket;
      if (ticket !== undefined) {
        // The ticket stands in for the token: same claims, and the session must still be current.
        const claims = typeof ticket === 'string' ? await redeemTicket(ticket) : null;
        check = claims && (await fastify.isSessionCurrent(claims)) ? { ok: true as const } : { ok: false as const };
        if (claims) request.user = claims;
      } else {
        check = await fastify.verifySession(request);
      }
    } catch (err) {
      fastify.log.error(err, 'WS session check failed');
      check = { ok: false as const };
    }
    if (!check.ok) {
      websocketRejectionsTotal.inc({ reason: 'unauthorized' });
      socket.close(1008, 'Unauthorized');
      return;
    }

    // The client may have gone away while the token was being verified. cleanup() has already
    // run in that case, so starting timers or counting the socket now would leak them.
    if (closed) return;

    const { org_id: orgId, user_id: userId, exp } = request.user;

    // One user, many tabs is normal; hundreds is a runaway script. 1008 so it does not retry in a loop.
    if ((perUser.get(userId) ?? 0) >= maxPerUser) {
      websocketRejectionsTotal.inc({ reason: 'too_many_for_user' });
      socket.close(1008, 'Too many connections');
      return;
    }
    if (open >= maxConnections) {
      websocketRejectionsTotal.inc({ reason: 'pod_full' });
      socket.close(1013, 'Server busy');
      return;
    }

    activeWebsocketConnections.inc();
    counted = true;
    open++;
    perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
    countedUser = userId;

    const channel = `org:${orgId}:updates`;

    // Private projects this user cannot see: events about them are dropped (docs/projects.md). null
    // until first loaded, and then every project event waits, so nothing private slips out early.
    // Reloaded when access changes (project_access_changed) and at every heartbeat (role changes).
    // All messages go through one promise chain, so a reload and the events after it stay in order.
    let hidden: Set<string> | null = null;
    let queue: Promise<void> = Promise.resolve();
    const reloadAccess = () =>
      hiddenProjectIds(orgId, userId).then(
        (ids) => {
          hidden = ids;
        },
        (err) => fastify.log.warn(err, 'WS project access reload failed; keeping the previous set')
      );
    queue = queue.then(reloadAccess);

    // Don't keep serving a session whose token has expired.
    if (exp) {
      const ms = Math.min(Math.max(exp * 1000 - Date.now(), 0), MAX_TIMER_MS);
      expiry = setTimeout(() => socket.close(1008, 'Token expired'), ms);
      expiry.unref();
    }

    // Detect dead peers (e.g. dropped by a load balancer without a FIN), and end the socket once its
    // session is revoked (logout, password change/reset): otherwise it would keep receiving the
    // org's events until the token expires. A failed check (database blip) keeps the socket.
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const claims = request.user;
    heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();

      queue = queue.then(reloadAccess);
      fastify.isSessionCurrent(claims).then(
        (current) => {
          if (!current && !closed) {
            websocketRejectionsTotal.inc({ reason: 'revoked' });
            socket.close(1008, 'Session revoked');
          }
        },
        (err) => fastify.log.warn(err, 'WS session re-check failed; keeping the socket')
      );
    }, heartbeatMs);
    heartbeat.unref();

    try {
      // Backpressure: a client that cannot keep up (its unsent data, or the events waiting for it, keep
      // growing) is closed rather than buffered without limit. It reconnects and refetches what it
      // missed, as after any reconnect (docs/realtime.md).
      let pending = 0;
      const tooSlow = () => {
        if (closed) return;
        websocketRejectionsTotal.inc({ reason: 'slow_consumer' });
        socket.close(1013, 'Too slow');
      };
      const off = await cache.subscribe(channel, (message, raw) => {
        if (closed) return;
        if (pending >= MAX_PENDING_EVENTS) return tooSlow();
        pending++;
        queue = queue.then(async () => {
          try {
            const event = (message ?? {}) as { type?: string; project_id?: unknown };
            if (event.type === 'project_access_changed') await reloadAccess();
            // Only the id goes out with project_access_changed, so every client can refresh (and one
            // that just lost access learns it); any other event about a hidden project is dropped.
            else if (typeof event.project_id === 'string' && (hidden === null || hidden.has(event.project_id))) return;
            if (socket.readyState !== socket.OPEN) return;
            if (socket.bufferedAmount > maxBufferedBytes) return tooSlow();
            socket.send(raw ?? JSON.stringify(message));
          } finally {
            pending--;
          }
        });
      });

      if (closed) {
        off(); // client left while we were subscribing
        return;
      }
      unsubscribe = off;
      fastify.log.info({ channel }, 'WS client subscribed');
    } catch (err) {
      fastify.log.error(err, 'WS subscription failed');
      websocketRejectionsTotal.inc({ reason: 'subscription_failed' });
      socket.close(1011, 'Subscription failed');
    }
  });
};

export default websocketRoutes;

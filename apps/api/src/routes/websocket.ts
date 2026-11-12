import { FastifyPluginAsync } from 'fastify';
import { cache } from '../cache/redis';
import { config } from '../config';
import { activeWebsocketConnections, websocketErrorsTotal, websocketRejectionsTotal } from '../metrics';

export interface WebsocketRouteOptions {
  /** Ping interval. A client that misses a whole interval without answering is dropped. */
  heartbeatMs?: number;
}

// setTimeout's maximum delay (2^31-1 ms); longer values fire immediately.
const MAX_TIMER_MS = 2_147_483_647;

/**
 * GET /ws: realtime updates for the caller's organization.
 *
 * Auth: the httpOnly `auth_token` cookie (sent automatically by browsers on the handshake)
 * or an `Authorization: Bearer` header for non-browser clients. Tokens in the URL are NOT
 * accepted, since query strings end up in access logs and proxies.
 *
 * Because the cookie authenticates the socket, the handshake's Origin is checked to stop
 * cross-site WebSocket hijacking.
 */
const websocketRoutes: FastifyPluginAsync<WebsocketRouteOptions> = async (fastify, opts) => {
  const heartbeatMs = opts.heartbeatMs ?? 30_000;

  fastify.get('/ws', { websocket: true }, async (connection, request) => {
    const socket = connection.socket;

    // Everything that must be torn down when the socket goes away. Registered before any
    // `await`, so a client that disconnects mid-setup can never leak a subscription.
    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let expiry: NodeJS.Timeout | null = null;

    let counted = false; // whether this socket is currently included in the connections gauge

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (counted) activeWebsocketConnections.dec();
      if (heartbeat) clearInterval(heartbeat);
      if (expiry) clearTimeout(expiry);
      unsubscribe?.();
    };
    socket.on('close', cleanup);
    socket.on('error', (err) => {
      websocketErrorsTotal.inc();
      fastify.log.warn(err, 'WS socket error');
    });

    const origin = request.headers.origin;
    if (origin && origin !== config.CORS_ORIGIN) {
      fastify.log.warn({ origin }, 'WS rejected: origin not allowed');
      websocketRejectionsTotal.inc({ reason: 'origin' });
      socket.close(1008, 'Origin not allowed');
      return;
    }

    try {
      await request.jwtVerify();
    } catch {
      websocketRejectionsTotal.inc({ reason: 'unauthorized' });
      socket.close(1008, 'Unauthorized');
      return;
    }

    // The client may have gone away while the token was being verified. cleanup() has already
    // run in that case, so starting timers or counting the socket now would leak them.
    if (closed) return;

    activeWebsocketConnections.inc();
    counted = true;

    const { org_id: orgId, exp } = request.user as { org_id: string; exp?: number };
    const channel = `org:${orgId}:updates`;

    // Don't keep serving a session whose token has expired.
    if (exp) {
      const ms = Math.min(Math.max(exp * 1000 - Date.now(), 0), MAX_TIMER_MS);
      expiry = setTimeout(() => socket.close(1008, 'Token expired'), ms);
      expiry.unref();
    }

    // Detect dead peers (e.g. dropped by a load balancer without a FIN).
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, heartbeatMs);
    heartbeat.unref();

    try {
      const off = await cache.subscribe(channel, (message, raw) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(raw ?? JSON.stringify(message));
        }
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

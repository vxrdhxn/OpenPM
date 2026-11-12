import client from 'prom-client';

/**
 * Application metrics, defined in their own module so routes can use them.
 * (index.ts starts the server as a side effect of being imported, so nothing can import from it.)
 * Exposed at GET /metrics via the default prom-client registry.
 *
 * Label values are always from a small fixed set (never user input, ids or SQL), so cardinality
 * stays bounded.
 */

// Sub-100ms resolution matters: a healthy API answers in single-digit milliseconds, and with
// coarser buckets p50/p95 would all read as "under 100ms".
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: LATENCY_BUCKETS,
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests (code 429 = rate limited)',
  labelNames: ['method', 'route', 'code'],
});

/** Authenticated WebSocket connections currently open on THIS pod (sum across pods in Prometheus). */
export const activeWebsocketConnections = new client.Gauge({
  name: 'active_websocket_connections',
  help: 'Number of active WebSocket connections',
});

/** reason: unauthorized | origin | subscription_failed */
export const websocketRejectionsTotal = new client.Counter({
  name: 'websocket_rejections_total',
  help: 'WebSocket connections refused or closed because setup failed',
  labelNames: ['reason'],
});

export const websocketErrorsTotal = new client.Counter({
  name: 'websocket_errors_total',
  help: 'WebSocket socket-level errors',
});

/** reason: missing | expired | invalid (bad JWT) | bad_credentials (failed login) */
export const authFailuresTotal = new client.Counter({
  name: 'auth_failures_total',
  help: 'Failed authentication attempts',
  labelNames: ['reason'],
});

/** outcome: ok | error. Not labelled by query text (unbounded cardinality, and it can hold data). */
export const dbQueryDurationSeconds = new client.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of database queries issued through db.query',
  labelNames: ['outcome'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

/** client: main | subscriber */
export const redisErrorsTotal = new client.Counter({
  name: 'redis_errors_total',
  help: 'Redis connection errors',
  labelNames: ['client'],
});

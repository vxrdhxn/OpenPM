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

/**
 * reason: unauthorized | origin | subscription_failed | revoked (session ended while connected) |
 * client_message | pod_full | too_many_for_user | slow_consumer (docs/realtime.md)
 */
export const websocketRejectionsTotal = new client.Counter({
  name: 'websocket_rejections_total',
  help: 'WebSocket connections refused or closed by the server, by reason',
  labelNames: ['reason'],
});

export const websocketErrorsTotal = new client.Counter({
  name: 'websocket_errors_total',
  help: 'WebSocket socket-level errors',
});

/** reason: missing | expired | invalid (bad JWT) | revoked (session ended, H.3) | bad_credentials (failed login) */
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

/**
 * Cache operations skipped because Redis was unavailable; the request carried on without the cache
 * (reads went to the database). operation: get | set | del | publish; reason: unavailable | error.
 */
export const cacheBypassedTotal = new client.Counter({
  name: 'cache_bypassed_total',
  help: 'Cache operations skipped because Redis was unavailable',
  labelNames: ['operation', 'reason'],
});

/** Idle database connections that broke (Postgres restart, failover, network). */
export const dbConnectionErrorsTotal = new client.Counter({
  name: 'db_connection_errors_total',
  help: 'Idle database connections that failed and were discarded',
});

/**
 * Requests answered 503 + Retry-After instead of being served (reason: db_pool = every connection
 * busy; db_unavailable = the database cannot be reached).
 */
export const overloadRejectionsTotal = new client.Counter({
  name: 'overload_rejections_total',
  help: 'Requests answered 503 because the server was overloaded',
  labelNames: ['reason'],
});

/** Background jobs that could not be queued (Redis down or too slow); the request still succeeded. */
export const jobsEnqueueFailedTotal = new client.Counter({
  name: 'jobs_enqueue_failed_total',
  help: 'Background jobs that could not be queued',
  labelNames: ['job_name'],
});

/**
 * Attachment objects deleted from storage (result: deleted | failed). A failed delete stays owed in
 * storage_deletions and is retried by the storage sweep (attachments/cleanup.ts).
 */
export const storageDeletionsTotal = new client.Counter({
  name: 'storage_deletions_total',
  help: 'Attachment object deletions from storage, by result',
  labelNames: ['result'],
});

/** Uploads that were started but never completed, removed by the storage sweep. */
export const abandonedUploadsReapedTotal = new client.Counter({
  name: 'abandoned_uploads_reaped_total',
  help: 'Pending attachment uploads removed because they were never completed',
});

/**
 * Cache command time (operation: get | set | del | publish | ping; outcome: ok | error | timeout).
 * Commands are cut off at 250 ms (cache/redis.ts), so the top bucket is a timeout.
 */
export const redisCommandDurationSeconds = new client.Histogram({
  name: 'redis_command_duration_seconds',
  help: 'Duration of cache commands sent to Redis',
  labelNames: ['operation', 'outcome'],
  buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
});

/** Requests refused with 429 (route: the route pattern, never the raw URL). */
export const rateLimitedTotal = new client.Counter({
  name: 'rate_limited_total',
  help: 'Requests refused by a rate limit',
  labelNames: ['route'],
});

/**
 * Owed attachment deletions right now, read at scrape time from storage_deletions (the cleanup module
 * plugs in the query, keeping this file free of database imports). A number that keeps growing means
 * storage keeps refusing deletes: credentials, permissions or an outage.
 */
let storageDeletionsOwedSource: (() => Promise<number>) | null = null;
export function setStorageDeletionsOwedSource(read: () => Promise<number>): void {
  storageDeletionsOwedSource = read;
}
export const storageDeletionsOwed = new client.Gauge({
  name: 'storage_deletions_owed',
  help: 'Attachment objects whose delete from storage is still owed',
  async collect() {
    if (!storageDeletionsOwedSource) return;
    try {
      this.set(await storageDeletionsOwedSource());
    } catch {
      // Database unavailable: keep the last value; the scrape must not fail.
    }
  },
});

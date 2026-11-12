import client from 'prom-client';

/**
 * Application metrics, defined in their own module so routes can import them.
 * (index.ts starts the server as a side effect of being imported, so nothing can import from it.)
 * Exposed at GET /metrics via the default prom-client registry.
 */

export const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'code']
});

/** Authenticated WebSocket connections currently open on THIS pod (sum across pods in Prometheus). */
export const activeWebsocketConnections = new client.Gauge({
  name: 'active_websocket_connections',
  help: 'Number of active WebSocket connections',
});

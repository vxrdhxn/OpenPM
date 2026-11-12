import http from 'http';
import client from 'prom-client';
import { logger } from './lib/logger';

/**
 * Minimal HTTP server so Prometheus can scrape the worker (which otherwise has no port).
 *   GET /metrics   Prometheus exposition format
 *   GET /healthz   200 "ok" (a cheap liveness/readiness target)
 * It serves nothing else and holds no secrets; it is meant to be reachable only from inside the
 * cluster (see the NetworkPolicy in the Helm chart).
 */
export function createMetricsServer(registry: client.Registry = client.register): http.Server {
  return http.createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];

    if (path !== '/metrics' && path !== '/healthz') {
      res.writeHead(404).end('not found');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    if (path === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(req.method === 'HEAD' ? undefined : 'ok');
      return;
    }

    try {
      const body = await registry.metrics();
      res.writeHead(200, { 'Content-Type': registry.contentType }).end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      logger.error({ err }, 'Failed to render metrics');
      res.writeHead(500).end('failed to render metrics');
    }
  });
}

export function startMetricsServer(port: number): Promise<http.Server> {
  const server = createMetricsServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      logger.info({ port }, 'Metrics server listening');
      resolve(server);
    });
  });
}

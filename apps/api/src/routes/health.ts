import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { cache } from '../cache/redis';

/**
 * Two checks, for two different questions:
 *
 * - `GET /health/live` (liveness): is this process able to answer at all? It checks nothing else,
 *   so a database or Redis outage never makes Kubernetes restart every API pod (a restart would not
 *   fix a dependency, and all pods would restart at once).
 * - `GET /health` (readiness/startup): can this pod serve requests? The database is required (503
 *   without it). Redis is not: without it the API runs degraded (no cache, no live updates), so the
 *   answer is still 200, with `status: "degraded"` and `redis: "error"`.
 */
/**
 * Never rate-limited. Kubernetes probes come from the node's kubelet, one address for every pod on
 * that node, and the limit is shared across pods (Redis): enough pods per node would push the probes
 * past it, readiness would fail with 429 and the pods would be taken out of service. These routes
 * are not under /api, so the Ingress does not expose them; only the cluster reaches them.
 */
const NO_RATE_LIMIT = { config: { rateLimit: false } } as const;

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health/live', NO_RATE_LIMIT, async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  fastify.get('/health', NO_RATE_LIMIT, async (_request, reply) => {
    let dbStatus: 'ok' | 'error' = 'ok';
    try {
      await db.query('SELECT 1');
    } catch (err) {
      dbStatus = 'error';
      fastify.log.error({ err }, 'Database health check failed');
    }

    const redisStatus: 'ok' | 'error' = (await cache.ping()) ? 'ok' : 'error';

    const status = dbStatus === 'error' ? 'error' : redisStatus === 'error' ? 'degraded' : 'ok';

    return reply.code(dbStatus === 'ok' ? 200 : 503).send({
      status,
      db: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    });
  });
};

export default healthRoutes;

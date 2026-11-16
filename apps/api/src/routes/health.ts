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
const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health/live', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });

  fastify.get('/health', async (_request, reply) => {
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

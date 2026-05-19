import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { cache } from '../cache/redis';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (_request, reply) => {
    let dbStatus = 'ok';
    let redisStatus = 'ok';

    try {
      await db.query('SELECT 1');
    } catch (e) {
      dbStatus = 'error';
      fastify.log.error(e, 'Database health check failed');
    }

    try {
      await cache.get('non_existent_key_health_ping');
      // If it doesn't throw, redis is accessible.
    } catch (e) {
      redisStatus = 'error';
      fastify.log.error(e, 'Redis health check failed');
    }

    const status = dbStatus === 'ok' && redisStatus === 'ok' ? 'ok' : 'error';
    const code = status === 'ok' ? 200 : 503;

    return reply.code(code).send({
      status,
      db: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString()
    });
  });
};

export default healthRoutes;

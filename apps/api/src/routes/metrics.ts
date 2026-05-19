import { FastifyPluginAsync } from 'fastify';
import client from 'prom-client';

const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/metrics', async (_request, reply) => {
    const metrics = await client.register.metrics();
    reply.header('Content-Type', client.register.contentType);
    return reply.send(metrics);
  });
};

export default metricsRoutes;

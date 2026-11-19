import { FastifyPluginAsync } from 'fastify';
import client from 'prom-client';

const metricsRoutes: FastifyPluginAsync = async (fastify) => {
  // Scraped by Prometheus from one address: never rate-limited (not exposed by the Ingress either).
  fastify.get('/metrics', { config: { rateLimit: false } }, async (_request, reply) => {
    const metrics = await client.register.metrics();
    reply.header('Content-Type', client.register.contentType);
    return reply.send(metrics);
  });
};

export default metricsRoutes;

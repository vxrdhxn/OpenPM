import client from 'prom-client';
import { config } from './config';
import { buildApp } from './app';

// Process-level Prometheus metrics (CPU, memory, event loop, ...). Registered once, here, not in
// buildApp(): tests build several apps in one process.
client.collectDefaultMetrics();

const fastify = buildApp();

// Graceful Shutdown on SIGTERM
// WHY: K8s sends SIGTERM before killing pods. Without it: in-flight requests drop.
// With it: finish current requests, exit cleanly.
const listeners = ['SIGINT', 'SIGTERM'];
listeners.forEach((signal) => {
  process.on(signal, async () => {
    fastify.log.info(`Received ${signal}. Shutting down gracefully...`);
    await fastify.close();
    process.exit(0);
  });
});

const start = async () => {
  try {
    await fastify.listen({ port: parseInt(config.PORT), host: '0.0.0.0' });
    // WHY 0.0.0.0: Inside Docker, external traffic cannot reach localhost. Must bind all interfaces.
    fastify.log.info(`Server is running on http://0.0.0.0:${config.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

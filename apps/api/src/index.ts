import client from 'prom-client';
import { config } from './config';
import { buildApp } from './app';
import { createShutdown } from './shutdown';
import { closeDb } from './db/client';
import { closeRedis } from './cache/redis';
import { closeJobQueue } from './queue';
import { createRateLimitRedis } from './security/rateLimitStore';
import { startAuditRetention } from './security/audit';
import { startStorageSweep } from './attachments/cleanup';

// Process-level Prometheus metrics (CPU, memory, event loop, ...). Registered once, here, not in
// buildApp(): tests build several apps in one process.
client.collectDefaultMetrics();

const rateLimitRedis = createRateLimitRedis();
const fastify = buildApp({ rateLimitRedis });
// Old audit entries (they hold IP addresses) are deleted after AUDIT_RETENTION_DAYS.
const stopAuditRetention = startAuditRetention(fastify.log);
// Attachment files whose delete is still owed, and uploads that were never completed.
const stopStorageSweep = startStorageSweep(fastify.log);

// Graceful shutdown. Kubernetes sends SIGTERM before killing a pod: finish in-flight requests, then
// close the queue, Redis and the database pool so nothing is cut off mid-command (see shutdown.ts).
const shutdown = createShutdown({
  app: fastify,
  resources: {
    queue: closeJobQueue,
    redis: closeRedis,
    rateLimitRedis: () => rateLimitRedis.quit().then(() => undefined, () => rateLimitRedis.disconnect()),
    database: closeDb,
  },
  log: fastify.log,
  exit: (code) => process.exit(code),
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAuditRetention();
    stopStorageSweep();
    void shutdown(signal);
  });
}

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

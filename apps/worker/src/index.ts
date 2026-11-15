import { Queue, Worker } from 'bullmq';
import client from 'prom-client';
import IORedis from 'ioredis';
import { pool } from './lib/db';
import { logger } from './lib/logger';
import { handleJob, jobLogger } from './handler';
import { registerQueueMetrics } from './metrics';
import { startMetricsServer } from './metricsServer';
import dotenv from 'dotenv';

// Load env for local dev (ignored in K8s)
dotenv.config({ path: '../../.env' });

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
redisConnection.on('error', (err) => logger.error({ err }, 'Redis connection error'));

// Jobs are I/O-bound (Postgres, email API), so several run at once per worker. Retries, backoff and
// payload rules are described in docs/jobs.md.
const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 5);
const worker = new Worker('tasks', (job) => handleJob(job), { connection: redisConnection, concurrency });

// Metrics: process-level defaults, queue depth/lag (read from Redis at scrape time), and an HTTP
// endpoint for Prometheus. A second Queue handle is used only for reading counts.
client.collectDefaultMetrics();
registerQueueMetrics(new Queue('tasks', { connection: redisConnection }));
const metricsPort = Number(process.env.METRICS_PORT ?? 9100);
const metricsServer = startMetricsServer(metricsPort).catch((err) => {
  // A port clash must not take the worker down: jobs matter more than metrics.
  logger.error({ err, port: metricsPort }, 'Could not start metrics server');
  return null;
});

worker.on('completed', (job) => {
  jobLogger(job).info(
    { duration_ms: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined },
    'Job completed'
  );
});

worker.on('failed', (job, err) => {
  const log = job ? jobLogger(job) : logger;
  // Emitted after BullMQ has counted the attempt, so attemptsMade includes this one.
  const maxAttempts = job?.opts?.attempts ?? 1;
  const willRetry = !!job && err?.name !== 'UnrecoverableError' && job.attemptsMade < maxAttempts;
  const fields = { err, attempts_made: job?.attemptsMade, max_attempts: maxAttempts, will_retry: willRetry };
  if (willRetry) {
    log.warn(fields, 'Job attempt failed; will retry');
  } else {
    log.error(fields, 'Job failed permanently');
  }
});

worker.on('error', (err) => logger.error({ err }, 'Worker error'));

logger.info({ queue: 'tasks', concurrency }, 'Worker is running and listening for jobs');

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Shutting down worker');
  await worker.close();
  (await metricsServer)?.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

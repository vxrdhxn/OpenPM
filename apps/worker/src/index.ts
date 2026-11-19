import { Queue, Worker } from 'bullmq';
import client from 'prom-client';
import IORedis from 'ioredis';
import { pool } from './lib/db';
import { logger } from './lib/logger';
import { handleJob, jobLogger } from './handler';
import { registerQueueMetrics } from './metrics';
import { startMetricsServer } from './metricsServer';
import { config } from './config';
import { closePublisher } from './lib/publish';

const redisConnection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});
redisConnection.on('error', (err) => logger.error({ err }, 'Redis connection error'));

// Jobs are I/O-bound (Postgres, email API), so several run at once per worker. Retries, backoff and
// payload rules are described in docs/jobs.md.
const concurrency = config.WORKER_CONCURRENCY;
const worker = new Worker('tasks', (job) => handleJob(job), { connection: redisConnection, concurrency });

// Metrics: process-level defaults, queue depth/lag (read from Redis at scrape time), and an HTTP
// endpoint for Prometheus. A second Queue handle is used only for reading counts.
client.collectDefaultMetrics();
const queue = new Queue('tasks', { connection: redisConnection });
registerQueueMetrics(queue);

// Scheduled jobs. A job scheduler is stored in Redis under a fixed id, so every worker replica
// upserting it keeps exactly one schedule, and each run is one job taken by one worker.
queue
  .upsertJobScheduler(
    'due_reminders',
    { every: config.DUE_REMINDER_INTERVAL_MINUTES * 60_000 },
    // One attempt: the next run is minutes away and picks up whatever this one missed.
    { name: 'due_reminders', data: {}, opts: { attempts: 1, removeOnComplete: true, removeOnFail: { age: 24 * 60 * 60 } } }
  )
  .catch((err) => logger.error({ err }, 'Could not schedule due-date reminders'));
const metricsPort = config.METRICS_PORT;
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
  await queue.close();
  await closePublisher();
  (await metricsServer)?.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

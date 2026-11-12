import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { pool } from './lib/db';
import { logger } from './lib/logger';
import { handleJob, jobLogger } from './handler';
import dotenv from 'dotenv';

// Load env for local dev (ignored in K8s)
dotenv.config({ path: '../../.env' });

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
redisConnection.on('error', (err) => logger.error({ err }, 'Redis connection error'));

const worker = new Worker('tasks', (job) => handleJob(job), { connection: redisConnection });

worker.on('completed', (job) => {
  jobLogger(job).info(
    { duration_ms: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined },
    'Job completed'
  );
});

worker.on('failed', (job, err) => {
  const log = job ? jobLogger(job) : logger;
  log.error(
    { err, attempts_made: job?.attemptsMade, max_attempts: job?.opts?.attempts ?? 1 },
    'Job failed'
  );
});

worker.on('error', (err) => logger.error({ err }, 'Worker error'));

logger.info({ queue: 'tasks' }, 'Worker is running and listening for jobs');

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Shutting down worker');
  await worker.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

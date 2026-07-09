import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { pool } from './lib/db';
import processTaskCreated from './processors/taskCreated';
import dotenv from 'dotenv';

// Load env for local dev (ignored in K8s)
dotenv.config({ path: '../../.env' });

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const worker = new Worker('tasks', async (job: Job) => {
  console.log(`Processing job ${job.id} of type ${job.name}...`);

  if (job.name === 'task_created') {
    await processTaskCreated(job);
  }

}, { connection: redisConnection });

worker.on('completed', job => {
  console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`${job?.id} has failed with ${err.message}`);
});

console.log('Worker is running and listening to "tasks" queue...');

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down worker...');
  await worker.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

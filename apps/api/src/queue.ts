import { Queue } from 'bullmq';
import { config } from './config';

/**
 * The background-job queue the worker consumes (`apps/worker`). One shared, lazily created handle per
 * process, so importing a route module doesn't open a Redis connection by itself.
 */
let queue: Queue | null = null;

export function getJobQueue(): Queue {
  queue ??= new Queue('tasks', { connection: { url: config.REDIS_URL } });
  return queue;
}

import { Queue, type JobsOptions } from 'bullmq';
import { config } from './config';

/**
 * Retry policy for every background job (see docs/jobs.md). A failed attempt is retried after 30s,
 * 1m, 2m and 4m: five attempts over about 7.5 minutes, which rides out a provider blip or a short
 * Redis/Postgres outage while staying well inside the shortest link lifetime (password reset, 1h).
 * Jobs whose payload can never succeed fail at once (the worker throws UnrecoverableError).
 *
 * Finished jobs are trimmed so Redis doesn't grow forever. Jobs that carry a token override these
 * and are removed as soon as they complete.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/**
 * The background-job queue the worker consumes (`apps/worker`). One shared, lazily created handle per
 * process, so importing a route module doesn't open a Redis connection by itself.
 */
let queue: Queue | null = null;

export function getJobQueue(): Queue {
  queue ??= new Queue('tasks', {
    // Fail at once while Redis is down instead of buffering (and hanging the request): see
    // jobs/enqueue.ts, which also adds a deadline.
    connection: { url: config.REDIS_URL, enableOfflineQueue: false },
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return queue;
}

/** Close the queue's Redis connection, if one was opened (on shutdown). */
export async function closeJobQueue(): Promise<void> {
  if (!queue) return;
  const q = queue;
  queue = null;
  await q.close();
}

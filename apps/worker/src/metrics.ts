import client from 'prom-client';
import { logger } from './lib/logger';

/**
 * Worker metrics, scraped from the HTTP endpoint in metricsServer.ts.
 * Label values come from small fixed sets, never from job payloads, ids or addresses.
 */

// Job names this worker knows. Anything else is reported as "other" so a bad producer can't
// create unbounded label values.
const KNOWN_JOB_NAMES = new Set(['task_created']);
export const jobNameLabel = (name: string) => (KNOWN_JOB_NAMES.has(name) ? name : 'other');

export const jobsTotal = new client.Counter({
  name: 'worker_jobs_total',
  help: 'Jobs processed, by outcome (completed or failed)',
  labelNames: ['job_name', 'status'],
});

export const jobDurationSeconds = new client.Histogram({
  name: 'worker_job_duration_seconds',
  help: 'Time spent processing a job',
  labelNames: ['job_name'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
});

/** result: sent | failed | skipped (no email provider configured) */
export const emailsTotal = new client.Counter({
  name: 'emails_total',
  help: 'Notification emails by result',
  labelNames: ['result'],
});

/** The part of a BullMQ Queue the queue gauges read (kept minimal so tests can fake it). */
export interface QueueLike {
  getJobCounts(...states: string[]): Promise<Record<string, number>>;
  getWaiting(start?: number, end?: number): Promise<Array<{ timestamp?: number }>>;
}

const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/**
 * Queue depth and lag, read from Redis at scrape time. These describe the QUEUE, not this pod, so
 * with several worker replicas each reports the same numbers: query them with max(), not sum().
 * A Redis hiccup must not break the whole scrape, so failures are logged and the gauges are
 * simply not updated that time.
 */
export function registerQueueMetrics(queue: QueueLike): void {
  new client.Gauge({
    name: 'worker_queue_jobs',
    help: 'Jobs in the queue by state',
    labelNames: ['state'],
    async collect() {
      try {
        const counts = await queue.getJobCounts(...QUEUE_STATES);
        for (const state of QUEUE_STATES) this.set({ state }, counts[state] ?? 0);
      } catch (err) {
        logger.error({ err }, 'Could not read queue depth for metrics');
      }
    },
  });

  new client.Gauge({
    name: 'worker_queue_oldest_waiting_age_seconds',
    help: 'Age of the oldest job still waiting to be picked up (0 when nothing is waiting): the queue lag',
    async collect() {
      try {
        const [oldest] = await queue.getWaiting(0, 0);
        this.set(oldest?.timestamp ? Math.max(0, (Date.now() - oldest.timestamp) / 1000) : 0);
      } catch (err) {
        logger.error({ err }, 'Could not read queue lag for metrics');
      }
    },
  });
}

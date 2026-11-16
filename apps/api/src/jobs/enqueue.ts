import type { JobsOptions } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import { getJobQueue } from '../queue';
import { jobsEnqueueFailedTotal } from '../metrics';
import { logger as rootLogger } from '../logger';

/** How long a request waits for Redis to accept a job before carrying on without it. */
export const ENQUEUE_TIMEOUT_MS = 2000;

/**
 * Queue a background job, best effort. Every job today sends an email about something the request
 * has already committed (a task, an invite, a reset link), so failing to queue it must not fail, or
 * hang, the request: the Phase 9 Redis-outage test showed task creation hanging past 30 s, with the
 * task already saved (docs/load-testing.md). The queue's connection does not buffer commands while
 * Redis is down, and this adds a deadline for a connection that hangs instead of failing.
 *
 * Returns whether the job was queued. A failure is logged and counted (jobs_enqueue_failed_total);
 * that email is lost. Guaranteed delivery would need a transactional outbox (a follow-up).
 */
export async function enqueue(
  name: string,
  data: Record<string, unknown>,
  opts?: JobsOptions,
  log: Pick<FastifyBaseLogger, 'warn'> = rootLogger
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      opts ? getJobQueue().add(name, data, opts) : getJobQueue().add(name, data),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`enqueue timed out after ${ENQUEUE_TIMEOUT_MS}ms`)), ENQUEUE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (err) {
    jobsEnqueueFailedTotal.inc({ job_name: name });
    // Never the payload: it can hold a token.
    log.warn({ err: { message: (err as Error)?.message }, job_name: name }, 'Could not queue background job; continuing without it');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

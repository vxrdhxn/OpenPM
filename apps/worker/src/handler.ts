import type { Job } from 'bullmq';
import { logger as rootLogger, Logger } from './lib/logger';
import processTaskCreated from './processors/taskCreated';

/** Logger for one job: every line carries the job, and the originating request when known. */
export function jobLogger(job: Job, base: Logger = rootLogger): Logger {
  const { request_id, org_id } = (job.data ?? {}) as { request_id?: string; org_id?: string };
  return base.child({
    job_id: job.id,
    job_name: job.name,
    ...(request_id ? { request_id } : {}),
    ...(org_id ? { org_id } : {}),
  });
}

/** Dispatch a job to its processor. Errors propagate so BullMQ can record the failure. */
export async function handleJob(job: Job, base: Logger = rootLogger): Promise<void> {
  const log = jobLogger(job, base);
  log.info('Processing job');

  if (job.name === 'task_created') {
    await processTaskCreated(job, log);
    return;
  }

  // Previously an unknown job completed silently; make a producer/consumer mismatch visible.
  log.warn('No processor for job name; ignoring');
}

import { UnrecoverableError, type Job } from 'bullmq';
import { logger as rootLogger, Logger } from './lib/logger';
import { jobDurationSeconds, jobNameLabel, jobsTotal } from './metrics';
import processTaskCreated from './processors/taskCreated';
import processInviteCreated from './processors/inviteCreated';
import processPasswordResetRequested from './processors/passwordResetRequested';
import processDueReminders from './processors/dueReminders';
import processNotificationCleanup from './processors/notificationCleanup';
import { config } from './config';
import processSignupVerification from './processors/signupVerification';
import processSignupExistingAccount from './processors/signupExistingAccount';

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

/**
 * Whether BullMQ will give up on this job if the current attempt throws `err`. Mirrors BullMQ's rule:
 * retry while attemptsMade + 1 < attempts (attemptsMade counts earlier attempts), never after an
 * UnrecoverableError.
 */
export function isFinalAttempt(job: Job, err: unknown): boolean {
  if (err instanceof UnrecoverableError || (err as Error)?.name === 'UnrecoverableError') return true;
  return (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);
}

/**
 * Dispatch a job to its processor. Errors propagate so BullMQ can record the failure and retry.
 * Metrics: status="retrying" when this attempt failed but another is scheduled, "failed" when the job
 * gives up (that is the one that loses a notification and the one that alerts).
 */
export async function handleJob(job: Job, base: Logger = rootLogger): Promise<void> {
  const log = jobLogger(job, base);
  const job_name = jobNameLabel(job.name);
  const stopTimer = jobDurationSeconds.startTimer({ job_name });
  log.info('Processing job');

  try {
    if (job.name === 'task_created') {
      await processTaskCreated(job, log);
    } else if (job.name === 'invite_created') {
      await processInviteCreated(job, log);
    } else if (job.name === 'password_reset_requested') {
      await processPasswordResetRequested(job, log);
    } else if (job.name === 'signup_verification') {
      await processSignupVerification(job, log);
    } else if (job.name === 'signup_existing_account') {
      await processSignupExistingAccount(job, log);
    } else if (job.name === 'due_reminders') {
      await processDueReminders(log);
    } else if (job.name === 'notification_cleanup') {
      await processNotificationCleanup(config.NOTIFICATION_RETENTION_DAYS, log);
    } else {
      // A producer/consumer mismatch, typically mid-deploy (new API, old worker). Fail retryably so a
      // worker that knows this job can pick it up, instead of completing it and losing it.
      throw new Error(`No processor for job name "${job.name}"`);
    }
    jobsTotal.inc({ job_name, status: 'completed' });
  } catch (err) {
    const final = isFinalAttempt(job, err);
    jobsTotal.inc({ job_name, status: final ? 'failed' : 'retrying' });
    throw err; // BullMQ records the failure and applies the retry policy
  } finally {
    stopTimer(); // duration is recorded for failures too: slow failures are what you want to see
  }
}

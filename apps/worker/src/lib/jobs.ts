import { UnrecoverableError, type Job } from 'bullmq';

/**
 * Read the required string fields of a job's payload. A malformed job fails with UnrecoverableError:
 * retrying can't fix it, but it still shows up as failed (metrics, alert, BullMQ failed set) instead
 * of completing silently.
 */
export function requireFields<K extends string>(job: Job, keys: readonly K[]): Record<K, string> {
  const data = (job.data ?? {}) as Record<string, unknown>;
  const missing = keys.filter((k) => typeof data[k] !== 'string' || data[k] === '');
  if (missing.length > 0) {
    // Field names only: values may be secrets (tokens).
    throw new UnrecoverableError(`Malformed ${job.name} job: missing or invalid ${missing.join(', ')}`);
  }
  return Object.fromEntries(keys.map((k) => [k, data[k] as string])) as Record<K, string>;
}

/** Optional string field: undefined when absent or null; a malformed value fails the job (see above). */
export function optionalField(job: Job, key: string): string | undefined {
  const value = ((job.data ?? {}) as Record<string, unknown>)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value === '') {
    throw new UnrecoverableError(`Malformed ${job.name} job: invalid ${key}`);
  }
  return value;
}

/**
 * Stable across retries of one job, different for every job: the email provider uses it to send each
 * job's email at most once. The timestamp keeps keys unique even if Redis is reset and job ids restart.
 */
export function jobIdempotencyKey(job: Job): string {
  return `openpm/${job.name}/${job.id}/${job.timestamp}`;
}

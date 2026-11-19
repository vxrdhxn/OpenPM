import { pool } from '../lib/db';
import { logger, Logger } from '../lib/logger';

/** Rows per DELETE, so one run never holds locks on a large part of the table. */
export const CLEANUP_BATCH = 5000;

/** One batch: the oldest notifications past the retention period. */
export const CLEANUP_SQL = `
  DELETE FROM notifications WHERE id IN (
    SELECT id FROM notifications WHERE created_at < NOW() - make_interval(days => $1)
     ORDER BY created_at LIMIT $2)`;

/**
 * Delete notifications older than `retentionDays` (NOTIFICATION_RETENTION_DAYS, docs/notifications.md),
 * read or not, in batches, oldest first. Runs on a schedule (index.ts). Returns how many were deleted.
 */
export default async function processNotificationCleanup(retentionDays: number, log: Logger = logger): Promise<number> {
  let total = 0;
  for (;;) {
    const res = await pool.query(CLEANUP_SQL, [retentionDays, CLEANUP_BATCH]);
    const deleted = res.rowCount ?? 0;
    total += deleted;
    if (deleted < CLEANUP_BATCH) break;
  }
  log.info({ deleted: total, retention_days: retentionDays }, 'Old notifications deleted');
  return total;
}

import { Job } from 'bullmq';
import { pool } from '../lib/db';
import { sendEmailNotification } from '../lib/email';
import { logger, Logger } from '../lib/logger';
import { appUrl } from '../lib/appUrl';
import { hashToken } from '../lib/tokens';

/**
 * Email a password-reset link. The job carries the raw token (the database only has its hash). The job
 * data is never logged, so the token never reaches the log pipeline; only the email body contains it.
 */
export default async function processPasswordResetRequested(job: Job, log: Logger = logger) {
  const { user_id, token } = (job.data ?? {}) as Record<string, unknown>;

  // Retrying a malformed job can't fix it, so complete it with an error log instead of throwing.
  if (typeof user_id !== 'string' || typeof token !== 'string') {
    log.error('Malformed password_reset_requested job; skipping');
    return;
  }

  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;

  // Only send a link that still works: a newer request, a completed reset or expiry removes or
  // invalidates the row, and an email with a dead link would only confuse.
  const res = await pool.query(
    `SELECT u.email, u.name, t.expires_at
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.user_id = $1 AND t.token_hash = $2 AND t.expires_at > NOW()`,
    [user_id, hashToken(token)]
  );

  if (res.rows.length === 0) {
    log.info({ user_id }, 'Reset link was superseded, used or expired; skipping');
    return;
  }

  const { email, name } = res.rows[0];

  await sendEmailNotification(
    email,
    'Reset your OpenPM password',
    `Hi ${name},\n\nSomeone (hopefully you) asked to reset the password for your OpenPM account.\n\n` +
      `Choose a new password here:\n${link}\n\n` +
      `This link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email; ` +
      `your password has not been changed.`,
    log
  );

  log.info({ user_id }, 'Processed password_reset_requested');
}

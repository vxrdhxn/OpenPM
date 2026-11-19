import { Job } from 'bullmq';
import { pool } from '../lib/db';
import { sendEmailNotification } from '../lib/email';
import { logger, Logger } from '../lib/logger';
import { config } from '../config';
import { jobIdempotencyKey, requireFields } from '../lib/jobs';

/**
 * Someone tried to create a workspace with an address that already has an account (docs/signup.md).
 * The sign-up page answered exactly as for a new address, so the person learns about their account
 * only here, in their own inbox. Scoped to the job's org_id, like every worker lookup.
 */
export default async function processSignupExistingAccount(job: Job, log: Logger = logger) {
  const { user_id, org_id } = requireFields(job, ['user_id', 'org_id']);

  const res = await pool.query(
    'SELECT email, name FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL',
    [user_id, org_id]
  );
  if (res.rows.length === 0) {
    log.info({ user_id }, 'Account no longer active; skipping');
    return;
  }
  const { email, name } = res.rows[0];

  await sendEmailNotification(
    email,
    'You already have an OpenPM account',
    `Hi ${name},\n\nSomeone (hopefully you) tried to create a new OpenPM workspace with this email ` +
      `address, which already has an account.\n\nSign in: ${config.APP_URL}/login\n` +
      `Forgot your password? ${config.APP_URL}/forgot-password\n\n` +
      `If this wasn't you, you can ignore this email. Nothing was created or changed.`,
    log,
    { idempotencyKey: jobIdempotencyKey(job) }
  );
  log.info({ user_id }, 'Processed signup_existing_account');
}

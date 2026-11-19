import { Job } from 'bullmq';
import { pool } from '../lib/db';
import { sendEmailNotification } from '../lib/email';
import { logger, Logger } from '../lib/logger';
import { config } from '../config';
import { hashToken } from '../lib/tokens';
import { jobIdempotencyKey, requireFields } from '../lib/jobs';

/** Text that ends up in an email subject must not contain line breaks. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

/**
 * Email the link that finishes a sign-up (docs/signup.md). The job carries the raw token (the
 * database only has its hash) and is never logged. Sent only while that link still works: signing up
 * again, finishing the sign-up or expiry make it stale.
 */
export default async function processSignupVerification(job: Job, log: Logger = logger) {
  const { signup_id, token } = requireFields(job, ['signup_id', 'token']);

  const res = await pool.query(
    'SELECT email, name, org_name FROM signup_requests WHERE id = $1 AND token_hash = $2 AND expires_at > NOW()',
    [signup_id, hashToken(token)]
  );
  if (res.rows.length === 0) {
    log.info({ signup_id }, 'Sign-up link was superseded, used or expired; skipping');
    return;
  }
  const { email, name, org_name: orgName } = res.rows[0];
  const link = `${config.APP_URL}/verify-signup?token=${encodeURIComponent(token)}`;

  await sendEmailNotification(
    email,
    `Finish creating ${oneLine(orgName)} on OpenPM`,
    `Hi ${name},\n\nOpen this link to finish creating your OpenPM workspace "${orgName}":\n${link}\n\n` +
      `It works once and expires in 24 hours. If you didn't sign up, ignore this email: nothing is ` +
      `created until the link is opened.`,
    log,
    { idempotencyKey: jobIdempotencyKey(job) }
  );
  log.info({ signup_id }, 'Processed signup_verification');
}

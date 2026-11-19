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
 * Email an invite link. The job carries the raw token (the database only has its hash). The job data
 * is never logged, so the token never reaches the log pipeline; only the email body contains it.
 */
export default async function processInviteCreated(job: Job, log: Logger = logger) {
  const { invite_id, org_id, token } = requireFields(job, ['invite_id', 'org_id', 'token']);

  const link = `${config.APP_URL}/invite?token=${encodeURIComponent(token)}`;

  const res = await pool.query(
    `SELECT i.email, i.role, i.token_hash, i.expires_at, o.name AS org_name
       FROM organization_invites i
       JOIN organizations o ON o.id = i.org_id
      WHERE i.id = $1 AND i.org_id = $2`,
    [invite_id, org_id]
  );

  if (res.rows.length === 0) {
    log.info({ invite_id }, 'Invite no longer exists (revoked or accepted); skipping');
    return;
  }

  const invite = res.rows[0];

  // The admin re-sent the invite after this job was queued: that newer job sends the valid link.
  if (invite.token_hash !== hashToken(token)) {
    log.info({ invite_id }, 'Invite was re-issued; skipping the outdated link');
    return;
  }

  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    log.info({ invite_id }, 'Invite has expired; skipping');
    return;
  }

  const orgName = oneLine(String(invite.org_name));
  const expires = new Date(invite.expires_at).toUTCString();

  await sendEmailNotification(
    invite.email,
    `You're invited to join ${orgName} on OpenPM`,
    `Hi,\n\nYou've been invited to join "${orgName}" on OpenPM as ${invite.role === 'admin' ? 'an admin' : 'a member'}.\n\n` +
      `Accept the invitation and create your account here:\n${link}\n\n` +
      `This link expires on ${expires}. If you weren't expecting this invitation, you can ignore this email.`,
    log,
    { idempotencyKey: jobIdempotencyKey(job) }
  );

  log.info({ invite_id }, 'Processed invite_created');
}

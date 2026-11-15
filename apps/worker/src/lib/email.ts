import { Resend } from 'resend';
import { UnrecoverableError } from 'bullmq';
import dotenv from 'dotenv';
import { domainOf, logger, Logger } from './logger';
import { emailsTotal } from '../metrics';

dotenv.config({ path: '../../.env' });

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const fromEmail = process.env.EMAIL_FROM_ADDRESS || 'notifications@openpm.local';

/** Give up on one provider call after this long; the job is retried (the idempotency key prevents duplicates). */
export const EMAIL_SEND_TIMEOUT_MS = 15_000;

// Provider errors that may succeed later. Everything else (invalid recipient, bad API key, invalid
// from address, ...) fails the same way on every attempt, so it is not retried.
const RETRYABLE_PROVIDER_ERRORS = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'concurrent_idempotent_requests',
  'application_error',
  'internal_server_error',
]);

export function isRetryableProviderError(error: { name?: string; statusCode?: number | null }): boolean {
  if (error.name && RETRYABLE_PROVIDER_ERRORS.has(error.name)) return true;
  return error.statusCode == null || error.statusCode === 429 || error.statusCode >= 500;
}

export interface SendOptions {
  /**
   * Same key = same email: the provider sends it at most once (within 24h), so a retry after a timeout
   * or a crash can't deliver a duplicate. Use jobIdempotencyKey(job).
   */
  idempotencyKey?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Email provider did not respond within ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Send one email. Throws when it was not delivered to the provider, so the job fails and BullMQ
 * retries it: a plain Error for temporary failures (network, timeout, rate limit, provider outage),
 * an UnrecoverableError for permanent ones (no retry). Without a provider configured nothing is sent
 * and nothing is thrown (counted as "skipped").
 *
 * What gets logged about an email:
 * - Sent / failed: only the recipient's DOMAIN and the provider's message id. Never the address,
 *   subject or body, which are personal data (and may hold invite or reset links).
 * - Not configured (no RESEND_API_KEY): in development the full mail is printed so you can read it;
 *   in production only a warning with the domain, so mail content never reaches the log pipeline.
 */
export async function sendEmailNotification(
  email: string,
  subject: string,
  body: string,
  log: Logger = logger,
  options: SendOptions = {}
): Promise<void> {
  const to_domain = domainOf(email);

  if (resend) {
    let result: Awaited<ReturnType<typeof resend.emails.send>>;
    try {
      result = await withTimeout(
        resend.emails.send(
          { from: fromEmail, to: [email], subject, text: body },
          options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined
        ),
        EMAIL_SEND_TIMEOUT_MS
      );
    } catch (error) {
      emailsTotal.inc({ result: 'failed' });
      log.error({ err: error, to_domain }, 'Failed to send email via Resend');
      throw new Error('Email could not be sent (will retry)', { cause: error });
    }

    const { data, error } = result;
    if (error) {
      emailsTotal.inc({ result: 'failed' });
      const retryable = isRetryableProviderError(error);
      log.error({ err: error, to_domain, retryable }, 'Email provider rejected the message');
      if (retryable) {
        throw new Error(`Email provider error: ${error.name} (will retry)`);
      }
      throw new UnrecoverableError(`Email provider rejected the message permanently: ${error.name}`);
    }

    emailsTotal.inc({ result: 'sent' });
    log.info({ to_domain, message_id: data?.id }, 'Email sent');
  } else if (process.env.NODE_ENV === 'production') {
    emailsTotal.inc({ result: 'skipped' });
    log.warn({ to_domain }, 'Email not sent: RESEND_API_KEY is not configured');
  } else {
    emailsTotal.inc({ result: 'skipped' });
    log.info({ to: email, subject, body }, 'Email (development mock, not sent)');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

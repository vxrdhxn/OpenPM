import { Resend } from 'resend';
import dotenv from 'dotenv';
import { domainOf, logger, Logger } from './logger';

dotenv.config({ path: '../../.env' });

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const fromEmail = process.env.EMAIL_FROM_ADDRESS || 'notifications@openpm.local';

/**
 * What gets logged about an email:
 * - Sent / failed: only the recipient's DOMAIN and the provider's message id. Never the address,
 *   subject or body, which are personal data (and, in future mails, may hold reset links).
 * - Not configured (no RESEND_API_KEY): in development the full mail is printed so you can read it;
 *   in production only a warning with the domain, so mail content never reaches the log pipeline.
 */
export async function sendEmailNotification(email: string, subject: string, body: string, log: Logger = logger) {
  const to_domain = domainOf(email);

  if (resend) {
    try {
      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [email],
        subject: subject,
        text: body,
      });

      if (error) {
        log.error({ err: error, to_domain }, 'Email provider rejected the message');
      } else {
        log.info({ to_domain, message_id: data?.id }, 'Email sent');
      }
    } catch (error) {
      log.error({ err: error, to_domain }, 'Failed to send email via Resend');
    }
  } else if (process.env.NODE_ENV === 'production') {
    log.warn({ to_domain }, 'Email not sent: RESEND_API_KEY is not configured');
  } else {
    log.info({ to: email, subject, body }, 'Email (development mock, not sent)');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

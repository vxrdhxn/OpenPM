import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const fromEmail = process.env.EMAIL_FROM_ADDRESS || 'notifications@openpm.local';

export async function sendEmailNotification(email: string, subject: string, body: string) {
  if (resend) {
    try {
      const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [email],
        subject: subject,
        text: body,
      });

      if (error) {
        console.error('[EMAIL ERROR]', error);
      } else {
        console.log(`[EMAIL SENT] To: ${email}, ID: ${data?.id}`);
      }
    } catch (error) {
      console.error('[EMAIL ERROR] Failed to send via Resend:', error);
    }
  } else {
    console.log(`\n[EMAIL MOCK] To: ${email}`);
    console.log(`[EMAIL MOCK] Subject: ${subject}`);
    console.log(`[EMAIL MOCK] Body: ${body}\n`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

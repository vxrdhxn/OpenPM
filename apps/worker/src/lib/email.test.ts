import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from './logger';

const { send, emailInc } = vi.hoisted(() => ({ send: vi.fn(), emailInc: vi.fn() }));
vi.mock('../metrics', () => ({ emailsTotal: { inc: emailInc } }));
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send } })),
}));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

async function loadEmail() {
  vi.resetModules();
  return import('./email.js');
}

/** A logger double that records every call (level, fields, message). */
function fakeLog() {
  const calls: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
  const make = (level: string) => (fields: Record<string, unknown> | string, msg?: string) =>
    calls.push(typeof fields === 'string' ? { level, fields: {}, msg: fields } : { level, fields, msg: msg ?? '' });
  const log = { info: make('info'), warn: make('warn'), error: make('error') } as unknown as Logger;
  return { log, calls, all: () => JSON.stringify(calls) };
}

const ADDRESS = 'someone.private@example.org';
const SUBJECT = 'You have been assigned a task';
const BODY = 'Hi Someone, secret body text with a link https://x.test/reset?token=abc';

describe('sendEmailNotification', () => {
  beforeEach(() => {
    send.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe('with a Resend API key', () => {
    it('sends through Resend', async () => {
      vi.stubEnv('RESEND_API_KEY', 'test-key');
      vi.stubEnv('EMAIL_FROM_ADDRESS', 'no-reply@openpm.test');
      send.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
      const { log } = fakeLog();

      const { sendEmailNotification } = await loadEmail();
      await sendEmailNotification('a@b.com', 'Hi', 'Body', log);

      expect(send).toHaveBeenCalledWith({ from: 'no-reply@openpm.test', to: ['a@b.com'], subject: 'Hi', text: 'Body' });
    });

    it('logs only the recipient domain and the message id on success', async () => {
      vi.stubEnv('RESEND_API_KEY', 'test-key');
      send.mockResolvedValue({ data: { id: 'msg-1' }, error: null });
      const { log, calls, all } = fakeLog();

      const { sendEmailNotification } = await loadEmail();
      await sendEmailNotification(ADDRESS, SUBJECT, BODY, log);

      expect(calls).toEqual([{ level: 'info', fields: { to_domain: 'example.org', message_id: 'msg-1' }, msg: 'Email sent' }]);
      expect(all()).not.toContain('someone.private');
      expect(all()).not.toContain(SUBJECT);
      expect(all()).not.toContain('secret body');
    });

    it('logs a provider error (with domain only) without throwing', async () => {
      vi.stubEnv('RESEND_API_KEY', 'test-key');
      send.mockResolvedValueOnce({ data: null, error: { message: 'invalid recipient' } });
      const { log, calls, all } = fakeLog();

      const { sendEmailNotification } = await loadEmail();
      await expect(sendEmailNotification(ADDRESS, SUBJECT, BODY, log)).resolves.toBeUndefined();

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ level: 'error', msg: 'Email provider rejected the message' });
      expect(calls[0]!.fields).toMatchObject({ to_domain: 'example.org', err: { message: 'invalid recipient' } });
      expect(all()).not.toContain('someone.private');
    });

    it('logs a network failure (with domain only) without throwing', async () => {
      vi.stubEnv('RESEND_API_KEY', 'test-key');
      send.mockRejectedValueOnce(new Error('network'));
      const { log, calls, all } = fakeLog();

      const { sendEmailNotification } = await loadEmail();
      await expect(sendEmailNotification(ADDRESS, SUBJECT, BODY, log)).resolves.toBeUndefined();

      expect(calls[0]).toMatchObject({ level: 'error', msg: 'Failed to send email via Resend' });
      expect(all()).not.toContain('someone.private');
    });
  });

  describe('without an API key', () => {
    beforeEach(() => {
      vi.stubEnv('RESEND_API_KEY', '');
      vi.useFakeTimers();
    });

    const run = async (log: Logger) => {
      const { sendEmailNotification } = await loadEmail();
      const pending = sendEmailNotification(ADDRESS, SUBJECT, BODY, log);
      await vi.runAllTimersAsync();
      await pending;
    };

    it('in development prints the whole mail so it can be read, and sends nothing', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const { log, calls } = fakeLog();

      await run(log);

      expect(send).not.toHaveBeenCalled();
      expect(calls).toEqual([
        { level: 'info', fields: { to: ADDRESS, subject: SUBJECT, body: BODY }, msg: 'Email (development mock, not sent)' },
      ]);
    });

    it('in production never logs the address, subject or body, only a warning with the domain', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const { log, calls, all } = fakeLog();

      await run(log);

      expect(send).not.toHaveBeenCalled();
      expect(calls).toEqual([
        { level: 'warn', fields: { to_domain: 'example.org' }, msg: 'Email not sent: RESEND_API_KEY is not configured' },
      ]);
      expect(all()).not.toContain('someone.private');
      expect(all()).not.toContain(SUBJECT);
      expect(all()).not.toContain('secret body');
      expect(all()).not.toContain('token=abc');
    });
  });
});

describe('email result metrics', () => {
  beforeEach(() => {
    send.mockReset();
    emailInc.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  const resultsRecorded = () => emailInc.mock.calls.map((c) => c[0].result);

  it('counts a sent email', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    send.mockResolvedValue({ data: { id: 'm1' }, error: null });

    const { sendEmailNotification } = await loadEmail();
    await sendEmailNotification('a@b.com', 's', 'b', fakeLog().log);

    expect(resultsRecorded()).toEqual(['sent']);
  });

  it('counts a provider rejection and a network failure as failed', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const { sendEmailNotification } = await loadEmail();

    send.mockResolvedValueOnce({ data: null, error: { message: 'invalid' } });
    await sendEmailNotification('a@b.com', 's', 'b', fakeLog().log);
    send.mockRejectedValueOnce(new Error('network'));
    await sendEmailNotification('a@b.com', 's', 'b', fakeLog().log);

    expect(resultsRecorded()).toEqual(['failed', 'failed']);
  });

  it.each(['development', 'production'])('counts a mail not sent for lack of a provider as skipped (%s)', async (env) => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('NODE_ENV', env);
    vi.useFakeTimers();

    const { sendEmailNotification } = await loadEmail();
    const pending = sendEmailNotification('a@b.com', 's', 'b', fakeLog().log);
    await vi.runAllTimersAsync();
    await pending;

    expect(resultsRecorded()).toEqual(['skipped']);
  });

  it('labels only with the result, never with an address, subject or body', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    send.mockResolvedValue({ data: { id: 'm1' }, error: null });

    const { sendEmailNotification } = await loadEmail();
    await sendEmailNotification('someone.private@example.org', 'Private subject', 'Private body', fakeLog().log);

    expect(emailInc.mock.calls).toEqual([[{ result: 'sent' }]]);
  });
});

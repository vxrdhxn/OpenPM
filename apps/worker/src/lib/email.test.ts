import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send } })),
}));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

async function loadEmail() {
  vi.resetModules();
  return import('./email.js');
}

describe('sendEmailNotification', () => {
  beforeEach(() => {
    send.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sends through Resend when an API key is configured', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'no-reply@openpm.test');
    send.mockResolvedValue({ data: { id: 'msg-1' }, error: null });

    const { sendEmailNotification } = await loadEmail();
    await sendEmailNotification('a@b.com', 'Hi', 'Body');

    expect(send).toHaveBeenCalledWith({
      from: 'no-reply@openpm.test',
      to: ['a@b.com'],
      subject: 'Hi',
      text: 'Body',
    });
  });

  it('does not throw when Resend reports an error or rejects', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const { sendEmailNotification } = await loadEmail();

    send.mockResolvedValueOnce({ data: null, error: { message: 'bad' } });
    await expect(sendEmailNotification('a@b.com', 's', 'b')).resolves.toBeUndefined();

    send.mockRejectedValueOnce(new Error('network'));
    await expect(sendEmailNotification('a@b.com', 's', 'b')).resolves.toBeUndefined();
  });

  it('falls back to a console mock when no API key is set', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.useFakeTimers();

    const { sendEmailNotification } = await loadEmail();
    const pending = sendEmailNotification('a@b.com', 'Subject', 'Body');
    await vi.runAllTimersAsync();
    await pending;
    vi.useRealTimers();

    expect(send).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[EMAIL MOCK] To: a@b.com'));
  });
});

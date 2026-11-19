import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import type { Logger } from '../lib/logger';

const { query, sendEmailNotification } = vi.hoisted(() => ({ query: vi.fn(), sendEmailNotification: vi.fn() }));

vi.mock('../lib/db', () => ({ pool: { query } }));
vi.mock('../lib/email', () => ({ sendEmailNotification }));
vi.mock('../config', async (importOriginal) => {
  const { config } = await importOriginal<typeof import('../config')>();
  return { config: { ...config, APP_URL: 'https://pm.example.com' } };
});

import processSignupVerification from './signupVerification';
import processSignupExistingAccount from './signupExistingAccount';

const TOKEN = 'e'.repeat(64);
const rows = (r: unknown[] = []) => ({ rows: r, rowCount: r.length });
const job = (name: string, data: Record<string, unknown>) => ({ id: 'j1', name, data }) as unknown as Job;
const makeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const asLogger = (l: ReturnType<typeof makeLog>) => l as unknown as Logger;

describe('processSignupVerification', () => {
  let log: ReturnType<typeof makeLog>;
  beforeEach(() => {
    vi.clearAllMocks();
    log = makeLog();
  });

  it('emails the finish link with the raw token, only while that request is live', async () => {
    query.mockResolvedValueOnce(rows([{ email: 'new@example.com', name: 'Ada', org_name: 'Acme\nInjected: header' }]));

    await processSignupVerification(job('signup_verification', { signup_id: 's1', token: TOKEN }), asLogger(log));

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('expires_at > NOW()');
    expect(params).toEqual(['s1', crypto.createHash('sha256').update(TOKEN).digest('hex')]);
    const [to, subject, body] = sendEmailNotification.mock.calls[0]!;
    expect(to).toBe('new@example.com');
    expect(subject).not.toMatch(/[\r\n]/);
    expect(body).toContain(`https://pm.example.com/verify-signup?token=${TOKEN}`);
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(TOKEN);
  });

  it('sends nothing for a superseded, used or expired request', async () => {
    query.mockResolvedValueOnce(rows());
    await processSignupVerification(job('signup_verification', { signup_id: 's1', token: TOKEN }), asLogger(log));
    expect(sendEmailNotification).not.toHaveBeenCalled();
  });

  it('fails permanently on a malformed payload', async () => {
    await expect(processSignupVerification(job('signup_verification', { signup_id: 's1' }), asLogger(log))).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('processSignupExistingAccount', () => {
  let log: ReturnType<typeof makeLog>;
  beforeEach(() => {
    vi.clearAllMocks();
    log = makeLog();
  });

  it('tells the account owner, scoped to their organization, with sign-in and reset links and no token', async () => {
    query.mockResolvedValueOnce(rows([{ email: 'ada@example.com', name: 'Ada' }]));

    await processSignupExistingAccount(job('signup_existing_account', { user_id: 'u1', org_id: 'o1' }), asLogger(log));

    expect(query.mock.calls[0]![1]).toEqual(['u1', 'o1']);
    const [to, , body] = sendEmailNotification.mock.calls[0]!;
    expect(to).toBe('ada@example.com');
    expect(body).toContain('https://pm.example.com/login');
    expect(body).toContain('https://pm.example.com/forgot-password');
  });

  it('sends nothing to an account that is gone', async () => {
    query.mockResolvedValueOnce(rows());
    await processSignupExistingAccount(job('signup_existing_account', { user_id: 'u1', org_id: 'o1' }), asLogger(log));
    expect(sendEmailNotification).not.toHaveBeenCalled();
  });
});

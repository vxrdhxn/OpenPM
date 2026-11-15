import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { Logger } from '../lib/logger';

const { query, sendEmailNotification } = vi.hoisted(() => ({ query: vi.fn(), sendEmailNotification: vi.fn() }));

vi.mock('../lib/db', () => ({ pool: { query } }));
vi.mock('../lib/email', () => ({ sendEmailNotification }));

import processPasswordResetRequested from './passwordResetRequested';

const TOKEN = 'd'.repeat(64);
const rows = (r: unknown[] = []) => ({ rows: r, rowCount: r.length });
const job = (data: Record<string, unknown>) => ({ id: 'j1', name: 'password_reset_requested', data }) as unknown as Job;
const makeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const asLogger = (l: ReturnType<typeof makeLog>) => l as unknown as Logger;

describe('processPasswordResetRequested', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    log = makeLog();
  });

  it('emails a reset link with the raw token, only if that token is still valid', async () => {
    vi.stubEnv('APP_URL', 'https://pm.example.com');
    query.mockResolvedValueOnce(rows([{ email: 'ada@example.com', name: 'Ada', expires_at: new Date() }]));

    await processPasswordResetRequested(job({ user_id: 'u1', token: TOKEN }), asLogger(log));

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('expires_at > NOW()');
    expect(params).toEqual(['u1', crypto.createHash('sha256').update(TOKEN).digest('hex')]);

    const [to, subject, body] = sendEmailNotification.mock.calls[0]!;
    expect(to).toBe('ada@example.com');
    expect(subject).toMatch(/reset/i);
    expect(body).toContain(`https://pm.example.com/reset-password?token=${TOKEN}`);
    expect(body).toContain('Ada');
  });

  it('never logs the token', async () => {
    query.mockResolvedValueOnce(rows([{ email: 'ada@example.com', name: 'Ada', expires_at: new Date() }]));

    await processPasswordResetRequested(job({ user_id: 'u1', token: TOKEN }), asLogger(log));

    expect(JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls])).not.toContain(TOKEN);
  });

  it('skips a link that was superseded, used or has expired', async () => {
    query.mockResolvedValueOnce(rows());

    await processPasswordResetRequested(job({ user_id: 'u1', token: TOKEN }), asLogger(log));

    expect(sendEmailNotification).not.toHaveBeenCalled();
  });

  it('completes a malformed job without retrying or querying', async () => {
    await processPasswordResetRequested(job({ token: TOKEN }), asLogger(log));

    expect(query).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it('lets database errors propagate so BullMQ records the failure', async () => {
    query.mockRejectedValueOnce(new Error('db down'));

    await expect(processPasswordResetRequested(job({ user_id: 'u1', token: TOKEN }), asLogger(log))).rejects.toThrow('db down');
  });
});

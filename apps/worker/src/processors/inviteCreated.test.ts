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

import processInviteCreated from './inviteCreated';

const TOKEN = 'b'.repeat(64);
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const rows = (r: unknown[] = []) => ({ rows: r, rowCount: r.length });
const job = (data: Record<string, unknown>) => ({ id: 'j1', name: 'invite_created', data }) as unknown as Job;
const makeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const asLogger = (l: ReturnType<typeof makeLog>) => l as unknown as Logger;

const future = new Date(Date.now() + 86_400_000).toISOString();
const invite = (over: Record<string, unknown> = {}) => ({
  email: 'new@example.com',
  role: 'member',
  token_hash: hash(TOKEN),
  expires_at: future,
  org_name: 'Acme',
  ...over,
});

describe('processInviteCreated', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    vi.clearAllMocks();
    log = makeLog();
  });

  it('emails an accept link with the raw token to the invited address', async () => {
    query.mockResolvedValueOnce(rows([invite()]));

    await processInviteCreated(job({ invite_id: 'i1', org_id: 'o1', token: TOKEN }), asLogger(log));

    // Scoped to the job's org.
    expect(query.mock.calls[0]![1]).toEqual(['i1', 'o1']);
    expect(sendEmailNotification).toHaveBeenCalledTimes(1);
    const [to, subject, body] = sendEmailNotification.mock.calls[0]!;
    expect(to).toBe('new@example.com');
    expect(subject).toContain('Acme');
    expect(body).toContain(`https://pm.example.com/invite?token=${TOKEN}`);
    expect(body).toContain('a member');
  });

  it('never logs the token', async () => {
    query.mockResolvedValueOnce(rows([invite()]));

    await processInviteCreated(job({ invite_id: 'i1', org_id: 'o1', token: TOKEN }), asLogger(log));

    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(logged).not.toContain(TOKEN);
  });

  it('skips an invite that was revoked or accepted', async () => {
    query.mockResolvedValueOnce(rows());

    await processInviteCreated(job({ invite_id: 'i1', org_id: 'o1', token: TOKEN }), asLogger(log));

    expect(sendEmailNotification).not.toHaveBeenCalled();
  });

  it('skips an outdated link after the invite was re-issued', async () => {
    query.mockResolvedValueOnce(rows([invite({ token_hash: hash('c'.repeat(64)) })]));

    await processInviteCreated(job({ invite_id: 'i1', org_id: 'o1', token: TOKEN }), asLogger(log));

    expect(sendEmailNotification).not.toHaveBeenCalled();
  });

  it('skips an expired invite', async () => {
    query.mockResolvedValueOnce(rows([invite({ expires_at: new Date(Date.now() - 1000).toISOString() })]));

    await processInviteCreated(job({ invite_id: 'i1', org_id: 'o1', token: TOKEN }), asLogger(log));

    expect(sendEmailNotification).not.toHaveBeenCalled();
  });

  it('fails a malformed job without retrying or querying', async () => {
    await expect(processInviteCreated(job({ invite_id: 'i1' }), asLogger(log))).rejects.toBeInstanceOf(UnrecoverableError);

    expect(query).not.toHaveBeenCalled();
  });

  it('passes an idempotency key so a retry cannot send the invite twice', async () => {
    query.mockResolvedValueOnce(rows([invite()]));

    await processInviteCreated(
      { ...job({ invite_id: 'i1', org_id: 'o1', token: TOKEN }), timestamp: 99 } as unknown as Job,
      asLogger(log)
    );

    expect(sendEmailNotification.mock.calls[0]![4]).toEqual({ idempotencyKey: 'openpm/invite_created/j1/99' });
  });

  it('keeps line breaks in the organization name out of the subject', async () => {
    query.mockResolvedValueOnce(rows([invite({ org_name: 'Acme\r\nBcc: victim@example.com' })]));

    await processInviteCreated(job({ invite_id: 'i1', org_id: 'o1', token: TOKEN }), asLogger(log));

    expect(sendEmailNotification.mock.calls[0]![1]).not.toMatch(/[\r\n]/);
  });

  it('lets database errors propagate so BullMQ records the failure', async () => {
    query.mockRejectedValueOnce(new Error('db down'));

    await expect(
      processInviteCreated(job({ invite_id: 'i1', org_id: 'o1', token: TOKEN }), asLogger(log))
    ).rejects.toThrow('db down');
  });
});

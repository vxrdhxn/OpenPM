import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

const { query, release, connect, sendEmailNotification } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  return {
    query,
    release,
    connect: vi.fn(async () => ({ query, release })),
    sendEmailNotification: vi.fn(),
  };
});

vi.mock('../lib/db', () => ({ pool: { connect } }));
vi.mock('../lib/email', () => ({ sendEmailNotification }));

import processTaskCreated from './taskCreated';

const rows = (r: unknown[] = []) => ({ rows: r, rowCount: r.length });
const job = (data: Record<string, unknown>) => ({ id: 'j1', name: 'task_created', data }) as unknown as Job;

describe('processTaskCreated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('skips without touching the database when there is no assignee', async () => {
    await processTaskCreated(job({ task_id: 't1', org_id: 'o1' }));

    expect(connect).not.toHaveBeenCalled();
    expect(sendEmailNotification).not.toHaveBeenCalled();
  });

  it('emails the assignee with task and project details', async () => {
    query
      .mockResolvedValueOnce(rows([{ title: 'Fix bug', project_id: 'p1' }]))
      .mockResolvedValueOnce(rows([{ name: 'Ada', email: 'ada@example.com' }]))
      .mockResolvedValueOnce(rows([{ name: 'Apollo' }]));

    await processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }));

    expect(sendEmailNotification).toHaveBeenCalledTimes(1);
    const [to, subject, body] = sendEmailNotification.mock.calls[0];
    expect(to).toBe('ada@example.com');
    expect(subject).toContain('Fix bug');
    expect(body).toContain('Ada');
    expect(body).toContain('Apollo');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('falls back to a placeholder when the project cannot be found', async () => {
    query
      .mockResolvedValueOnce(rows([{ title: 'T', project_id: 'p1' }]))
      .mockResolvedValueOnce(rows([{ name: 'Ada', email: 'ada@example.com' }]))
      .mockResolvedValueOnce(rows());

    await processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }));

    expect(sendEmailNotification.mock.calls[0][2]).toContain('Unknown Project');
  });

  it('does not send mail if the task or assignee no longer exists, and still releases the client', async () => {
    query.mockResolvedValueOnce(rows());
    await processTaskCreated(job({ task_id: 'gone', assignee_id: 'u1', org_id: 'o1' }));
    expect(sendEmailNotification).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);

    query
      .mockResolvedValueOnce(rows([{ title: 'T', project_id: 'p1' }]))
      .mockResolvedValueOnce(rows());
    await processTaskCreated(job({ task_id: 't1', assignee_id: 'gone', org_id: 'o1' }));
    expect(sendEmailNotification).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('propagates failures (so BullMQ retries) and releases the client', async () => {
    query.mockRejectedValueOnce(new Error('db down'));

    await expect(
      processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }))
    ).rejects.toThrow('db down');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

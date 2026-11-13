import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { Logger } from '../lib/logger';

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
const makeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const asLogger = (l: ReturnType<typeof makeLog>) => l as unknown as Logger;

describe('processTaskCreated', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    vi.clearAllMocks();
    log = makeLog();
  });

  it('skips without touching the database when there is no assignee', async () => {
    await processTaskCreated(job({ task_id: 't1', org_id: 'o1' }), asLogger(log));

    expect(connect).not.toHaveBeenCalled();
    expect(sendEmailNotification).not.toHaveBeenCalled();
  });

  it('emails the assignee with task and project details', async () => {
    query
      .mockResolvedValueOnce(rows([{ title: 'Fix bug', project_id: 'p1' }]))
      .mockResolvedValueOnce(rows([{ name: 'Ada', email: 'ada@example.com' }]))
      .mockResolvedValueOnce(rows([{ name: 'Apollo' }]));

    await processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }), asLogger(log));

    expect(sendEmailNotification).toHaveBeenCalledTimes(1);
    const [to, subject, body] = sendEmailNotification.mock.calls[0]!;
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

    await processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }), asLogger(log));

    expect(sendEmailNotification.mock.calls[0]![2]).toContain('Unknown Project');
  });

  it('does not send mail if the task or assignee no longer exists, and still releases the client', async () => {
    query.mockResolvedValueOnce(rows());
    await processTaskCreated(job({ task_id: 'gone', assignee_id: 'u1', org_id: 'o1' }), asLogger(log));
    expect(sendEmailNotification).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);

    query
      .mockResolvedValueOnce(rows([{ title: 'T', project_id: 'p1' }]))
      .mockResolvedValueOnce(rows());
    await processTaskCreated(job({ task_id: 't1', assignee_id: 'gone', org_id: 'o1' }), asLogger(log));
    expect(sendEmailNotification).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('propagates failures (so BullMQ retries) and releases the client', async () => {
    query.mockRejectedValueOnce(new Error('db down'));

    await expect(
      processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }), asLogger(log))
    ).rejects.toThrow('db down');
    expect(release).toHaveBeenCalledTimes(1);
  });

  describe('logging', () => {
    it('logs the skip when there is no assignee', async () => {
      await processTaskCreated(job({ task_id: 't1', org_id: 'o1' }), asLogger(log));

      expect(log.info).toHaveBeenCalledWith({ task_id: 't1' }, 'Task has no assignee; skipping notification');
    });

    it('passes the job logger on to the email sender and logs success without any address', async () => {
      query
        .mockResolvedValueOnce(rows([{ title: 'Fix bug', project_id: 'p1' }]))
        .mockResolvedValueOnce(rows([{ name: 'Ada', email: 'ada@example.com' }]))
        .mockResolvedValueOnce(rows([{ name: 'Apollo' }]));

      await processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }), asLogger(log));

      expect(sendEmailNotification.mock.calls[0]![3]).toBe(log); // same logger, so email lines carry job/request ids
      expect(log.info).toHaveBeenCalledWith({ task_id: 't1', assignee_id: 'u1' }, 'Processed task_created');
      expect(JSON.stringify(log.info.mock.calls)).not.toContain('ada@example.com');
    });

    it('warns (rather than failing silently) when the task or the assignee is gone', async () => {
      query.mockResolvedValueOnce(rows());
      await processTaskCreated(job({ task_id: 'gone', assignee_id: 'u1', org_id: 'o1' }), asLogger(log));
      expect(log.warn).toHaveBeenCalledWith({ task_id: 'gone' }, 'Task no longer exists; skipping notification');

      query.mockResolvedValueOnce(rows([{ title: 'T', project_id: 'p1' }])).mockResolvedValueOnce(rows());
      await processTaskCreated(job({ task_id: 't1', assignee_id: 'gone', org_id: 'o1' }), asLogger(log));
      expect(log.warn).toHaveBeenCalledWith(
        { task_id: 't1', assignee_id: 'gone' },
        'Assignee no longer exists; skipping notification'
      );
    });
  });
});

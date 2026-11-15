import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
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
const job = (data: Record<string, unknown>) =>
  ({ id: 'j1', name: 'task_created', timestamp: 1700000000000, data }) as unknown as Job;
const makeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const asLogger = (l: ReturnType<typeof makeLog>) => l as unknown as Logger;

const TASK = { title: 'Fix bug', project_name: 'Apollo' };
const ASSIGNEE = { name: 'Ada', email: 'ada@example.com' };

describe('processTaskCreated', () => {
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    vi.clearAllMocks();
    query.mockReset(); // also drops queued mockResolvedValueOnce values
    log = makeLog();
  });

  it('skips without touching the database when there is no assignee', async () => {
    await processTaskCreated(job({ task_id: 't1', org_id: 'o1' }), asLogger(log));

    expect(connect).not.toHaveBeenCalled();
    expect(sendEmailNotification).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith({ task_id: 't1' }, 'Task has no assignee; skipping notification');
  });

  it('emails the assignee with task and project details, with an idempotency key for retries', async () => {
    query.mockResolvedValueOnce(rows([TASK])).mockResolvedValueOnce(rows([ASSIGNEE]));

    await processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }), asLogger(log));

    expect(sendEmailNotification).toHaveBeenCalledTimes(1);
    const [to, subject, body, passedLog, options] = sendEmailNotification.mock.calls[0]!;
    expect(to).toBe('ada@example.com');
    expect(subject).toContain('Fix bug');
    expect(body).toContain('Ada');
    expect(body).toContain('Apollo');
    expect(passedLog).toBe(log); // same logger, so email lines carry job/request ids
    expect(options).toEqual({ idempotencyKey: 'openpm/task_created/j1/1700000000000' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith({ task_id: 't1', assignee_id: 'u1' }, 'Processed task_created');
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('ada@example.com');
  });

  it('scopes the task, project and assignee lookups to the job org', async () => {
    query.mockResolvedValueOnce(rows([TASK])).mockResolvedValueOnce(rows([ASSIGNEE]));

    await processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }), asLogger(log));

    const [taskSql, taskParams] = query.mock.calls[0]!;
    expect(taskSql).toContain('t.org_id = $2');
    expect(taskSql).toContain('p.org_id = t.org_id');
    expect(taskParams).toEqual(['t1', 'o1']);
    expect(query.mock.calls[1]).toEqual(['SELECT name, email FROM users WHERE id = $1 AND org_id = $2', ['u1', 'o1']]);
  });

  it('does not send when the task or the assignee is not in the org (or gone), and still releases the client', async () => {
    query.mockResolvedValueOnce(rows());
    await processTaskCreated(job({ task_id: 'gone', assignee_id: 'u1', org_id: 'o1' }), asLogger(log));
    expect(log.warn).toHaveBeenCalledWith({ task_id: 'gone' }, 'Task no longer exists; skipping notification');

    query.mockResolvedValueOnce(rows([TASK])).mockResolvedValueOnce(rows());
    await processTaskCreated(job({ task_id: 't1', assignee_id: 'other-org-user', org_id: 'o1' }), asLogger(log));
    expect(log.warn).toHaveBeenCalledWith(
      { task_id: 't1', assignee_id: 'other-org-user' },
      'Assignee no longer exists in this organization; skipping notification'
    );

    expect(sendEmailNotification).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('keeps line breaks in the task title out of the subject', async () => {
    query.mockResolvedValueOnce(rows([{ ...TASK, title: 'Fix\r\nBcc: x@example.com' }])).mockResolvedValueOnce(rows([ASSIGNEE]));

    await processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }), asLogger(log));

    expect(sendEmailNotification.mock.calls[0]![1]).not.toMatch(/[\r\n]/);
  });

  it('propagates database and email failures (so BullMQ retries) and releases the client', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    await expect(
      processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }), asLogger(log))
    ).rejects.toThrow('db down');

    query.mockResolvedValueOnce(rows([TASK])).mockResolvedValueOnce(rows([ASSIGNEE]));
    sendEmailNotification.mockRejectedValueOnce(new Error('provider down'));
    await expect(
      processTaskCreated(job({ task_id: 't1', assignee_id: 'u1', org_id: 'o1' }), asLogger(log))
    ).rejects.toThrow('provider down');

    expect(release).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ assignee_id: 'u1', org_id: 'o1' }],
    [{ task_id: 't1', assignee_id: 'u1' }],
    [{ task_id: 't1', org_id: 'o1', assignee_id: 42 }],
  ])('fails a malformed job without retrying or querying: %o', async (data) => {
    await expect(processTaskCreated(job(data), asLogger(log))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(connect).not.toHaveBeenCalled();
  });
});

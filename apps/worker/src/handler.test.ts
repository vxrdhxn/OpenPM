import { beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { Job } from 'bullmq';

const { processTaskCreated } = vi.hoisted(() => ({ processTaskCreated: vi.fn() }));
vi.mock('./processors/taskCreated', () => ({ default: processTaskCreated }));
vi.mock('./lib/db', () => ({ pool: {} }));

import { handleJob, jobLogger } from './handler';
import { loggerOptions } from './lib/logger';

type Line = Record<string, any>;

function capture() {
  const lines: Line[] = [];
  const base = pino(loggerOptions, { write: (c: string) => lines.push(JSON.parse(c)) });
  return { lines, base };
}

const job = (name: string, data: Record<string, unknown> = {}, id = '42') => ({ id, name, data }) as unknown as Job;

describe('jobLogger', () => {
  it('stamps job id/name, plus the originating request id and org when present', () => {
    const { lines, base } = capture();

    jobLogger(job('task_created', { request_id: 'req-abc-123', org_id: 'org-1', task_id: 't1' }), base).info('hi');

    expect(lines[0]).toMatchObject({ job_id: '42', job_name: 'task_created', request_id: 'req-abc-123', org_id: 'org-1' });
    expect(lines[0]).not.toHaveProperty('task_id'); // payload is not blindly copied into every line
  });

  it('omits request_id and org_id for jobs that do not carry them', () => {
    const { lines, base } = capture();

    jobLogger(job('task_created', {}), base).info('hi');

    expect(lines[0]).toMatchObject({ job_id: '42', job_name: 'task_created' });
    expect(lines[0]).not.toHaveProperty('request_id');
    expect(lines[0]).not.toHaveProperty('org_id');
  });

  it('tolerates a job with no data', () => {
    const { lines, base } = capture();
    const bare = { id: '1', name: 'x' } as unknown as Job;

    expect(() => jobLogger(bare, base).info('hi')).not.toThrow();
    expect(lines[0]).toMatchObject({ job_id: '1' });
  });
});

describe('handleJob', () => {
  beforeEach(() => {
    processTaskCreated.mockReset().mockResolvedValue(undefined);
  });

  it('dispatches task_created with the per-job logger, so the processor logs under the same ids', async () => {
    const { lines, base } = capture();
    const j = job('task_created', { request_id: 'req-abc-123' });

    await handleJob(j, base);

    expect(processTaskCreated).toHaveBeenCalledTimes(1);
    expect(processTaskCreated.mock.calls[0]![0]).toBe(j);

    // Whatever the processor logs through the logger it was given carries the request id.
    processTaskCreated.mock.calls[0]![1].info('from processor');
    expect(lines.find((l) => l.msg === 'from processor')).toMatchObject({ job_id: '42', request_id: 'req-abc-123' });
    expect(lines.find((l) => l.msg === 'Processing job')).toMatchObject({ level: 'info', job_name: 'task_created' });
  });

  it('warns and ignores a job name it has no processor for', async () => {
    const { lines, base } = capture();

    await expect(handleJob(job('mystery_job'), base)).resolves.toBeUndefined();

    expect(processTaskCreated).not.toHaveBeenCalled();
    expect(lines.find((l) => l.level === 'warn')).toMatchObject({
      msg: 'No processor for job name; ignoring',
      job_name: 'mystery_job',
    });
  });

  it('lets processor errors propagate so BullMQ records the failure', async () => {
    const { base } = capture();
    processTaskCreated.mockRejectedValue(new Error('db down'));

    await expect(handleJob(job('task_created'), base)).rejects.toThrow('db down');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { Job } from 'bullmq';

const { processTaskCreated } = vi.hoisted(() => ({ processTaskCreated: vi.fn() }));
vi.mock('./processors/taskCreated', () => ({ default: processTaskCreated }));
vi.mock('./lib/db', () => ({ pool: {} }));

import { handleJob, jobLogger } from './handler';
import { loggerOptions } from './lib/logger';
import { jobDurationSeconds, jobsTotal } from './metrics';

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

describe('job metrics', () => {
  beforeEach(() => {
    processTaskCreated.mockReset().mockResolvedValue(undefined);
    jobsTotal.reset();
    jobDurationSeconds.reset();
  });

  const count = async (job_name: string, status: string) =>
    (await jobsTotal.get()).values.find((v) => v.labels.job_name === job_name && v.labels.status === status)?.value ?? 0;
  const observations = async (job_name: string) =>
    (await jobDurationSeconds.get()).values.find(
      (v) => (v as { metricName?: string }).metricName === 'worker_job_duration_seconds_count' && v.labels.job_name === job_name
    )?.value ?? 0;

  it('counts a completed job and observes its duration', async () => {
    await handleJob(job('task_created'), capture().base);

    expect(await count('task_created', 'completed')).toBe(1);
    expect(await count('task_created', 'failed')).toBe(0);
    expect(await observations('task_created')).toBe(1);
  });

  it('counts a failed job, still observes its duration, and rethrows for BullMQ', async () => {
    processTaskCreated.mockRejectedValue(new Error('db down'));

    await expect(handleJob(job('task_created'), capture().base)).rejects.toThrow('db down');

    expect(await count('task_created', 'failed')).toBe(1);
    expect(await count('task_created', 'completed')).toBe(0);
    expect(await observations('task_created')).toBe(1);
  });

  it('reports an unrecognized job name as "other", never as an arbitrary label value', async () => {
    await handleJob(job('totally_unknown_job'), capture().base);

    expect(await count('other', 'completed')).toBe(1);
    expect(JSON.stringify((await jobsTotal.get()).values)).not.toContain('totally_unknown_job');
  });

  it('accumulates across jobs', async () => {
    await handleJob(job('task_created', {}, '1'), capture().base);
    await handleJob(job('task_created', {}, '2'), capture().base);
    processTaskCreated.mockRejectedValueOnce(new Error('x'));
    await handleJob(job('task_created', {}, '3'), capture().base).catch(() => undefined);

    expect(await count('task_created', 'completed')).toBe(2);
    expect(await count('task_created', 'failed')).toBe(1);
  });
});

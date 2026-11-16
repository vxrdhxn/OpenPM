import { afterEach, describe, expect, it, vi } from 'vitest';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../queue', () => ({ getJobQueue: () => ({ add }) }));

import { enqueue, ENQUEUE_TIMEOUT_MS } from './enqueue';
import { jobsEnqueueFailedTotal } from '../metrics';

const failures = async (name: string) =>
  (await jobsEnqueueFailedTotal.get()).values.find((v) => v.labels.job_name === name)?.value ?? 0;
const log = () => ({ warn: vi.fn() });

describe('enqueue', () => {
  afterEach(() => {
    add.mockReset();
    jobsEnqueueFailedTotal.reset();
    vi.useRealTimers();
  });

  it('queues the job and says so', async () => {
    add.mockResolvedValue({ id: '1' });

    expect(await enqueue('task_created', { task_id: 't' }, { attempts: 1 })).toBe(true);
    expect(add).toHaveBeenCalledWith('task_created', { task_id: 't' }, { attempts: 1 });
    expect(await enqueue('plain', {})).toBe(true);
    expect(add).toHaveBeenLastCalledWith('plain', {});
  });

  it('carries on when Redis refuses, and counts it without logging the payload', async () => {
    add.mockRejectedValue(new Error("Stream isn't writeable and enableOfflineQueue options is false"));
    const logger = log();

    expect(await enqueue('invite_created', { token: 'secret-token' }, undefined, logger)).toBe(false);
    expect(await failures('invite_created')).toBe(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret-token');
  });

  it('gives up after the deadline when Redis hangs', async () => {
    vi.useFakeTimers();
    add.mockReturnValue(new Promise(() => {}));

    const result = enqueue('task_created', {}, undefined, log());
    await vi.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS);

    expect(await result).toBe(false);
    expect(await failures('task_created')).toBe(1);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { Queue } = vi.hoisted(() => ({
  Queue: vi.fn().mockImplementation(function (this: Record<string, unknown>, name: string, opts: unknown) {
    this.name = name;
    this.opts = opts;
  }),
}));
vi.mock('bullmq', () => ({ Queue }));

describe('getJobQueue', () => {
  beforeEach(() => {
    vi.resetModules();
    Queue.mockClear();
  });

  it('creates one shared queue lazily, with the retry policy as default job options', async () => {
    const { getJobQueue, DEFAULT_JOB_OPTIONS } = await import('./queue.js');
    expect(Queue).not.toHaveBeenCalled();

    const q = getJobQueue();
    expect(getJobQueue()).toBe(q);
    expect(Queue).toHaveBeenCalledTimes(1);
    expect(Queue.mock.calls[0]![0]).toBe('tasks');
    expect(Queue.mock.calls[0]![1]).toMatchObject({ defaultJobOptions: DEFAULT_JOB_OPTIONS });
  });

  it('retries with exponential backoff within the 1h reset-link lifetime, and trims finished jobs', async () => {
    const { DEFAULT_JOB_OPTIONS } = await import('./queue.js');
    const { attempts = 1, backoff } = DEFAULT_JOB_OPTIONS;
    const delay = (backoff as { type: string; delay: number }).delay;

    expect(attempts).toBeGreaterThan(1);
    expect((backoff as { type: string }).type).toBe('exponential');
    // Sum of waits between attempts: delay * (1 + 2 + 4 + ...)
    const totalWaitMs = delay * (2 ** (attempts - 1) - 1);
    expect(totalWaitMs).toBeLessThan(60 * 60 * 1000);
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toBeTruthy();
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toBeTruthy();
  });
});

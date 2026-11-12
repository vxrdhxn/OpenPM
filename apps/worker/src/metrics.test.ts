import { beforeEach, describe, expect, it, vi } from 'vitest';
import client from 'prom-client';

vi.mock('./lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { logger } from './lib/logger';
import { QueueLike, jobNameLabel, registerQueueMetrics } from './metrics';

const gauge = async (name: string, labels: Record<string, string> = {}): Promise<number | undefined> => {
  const { values } = await client.register.getSingleMetric(name)!.get();
  return values.find((v) => Object.entries(labels).every(([k, want]) => v.labels[k] === want))?.value;
};

describe('jobNameLabel', () => {
  it('passes known job names through', () => {
    expect(jobNameLabel('task_created')).toBe('task_created');
  });

  it.each(['mystery', '', 'x'.repeat(500), 'task_created; DROP TABLE'])('collapses %j to "other" (bounded cardinality)', (name) => {
    expect(jobNameLabel(name)).toBe('other');
  });
});

describe('queue metrics', () => {
  const NOW = 1_700_000_000_000;
  // Gauges register on the global registry once, so the queue double is created and registered
  // once; each test just re-programs its behaviour.
  const queue = { getJobCounts: vi.fn(), getWaiting: vi.fn() };
  registerQueueMetrics(queue as unknown as QueueLike);

  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(logger.error).mockReset();
    queue.getJobCounts.mockReset().mockResolvedValue({ waiting: 5, active: 2, delayed: 1, failed: 3 });
    queue.getWaiting.mockReset().mockResolvedValue([]);
  });

  it('reports depth for every state at scrape time', async () => {
    expect(await gauge('worker_queue_jobs', { state: 'waiting' })).toBe(5);
    expect(await gauge('worker_queue_jobs', { state: 'active' })).toBe(2);
    expect(await gauge('worker_queue_jobs', { state: 'delayed' })).toBe(1);
    expect(await gauge('worker_queue_jobs', { state: 'failed' })).toBe(3);
    expect(queue.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'delayed', 'failed');
  });

  it('reads fresh values on every scrape, not a cached snapshot', async () => {
    expect(await gauge('worker_queue_jobs', { state: 'waiting' })).toBe(5);

    queue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, delayed: 0, failed: 3 });

    expect(await gauge('worker_queue_jobs', { state: 'waiting' })).toBe(0);
  });

  it('treats a state missing from the response as zero', async () => {
    queue.getJobCounts.mockResolvedValue({ waiting: 4 });

    expect(await gauge('worker_queue_jobs', { state: 'failed' })).toBe(0);
  });

  it('reports queue lag as the age of the oldest waiting job', async () => {
    vi.useFakeTimers({ now: NOW });
    queue.getWaiting.mockResolvedValue([{ timestamp: NOW - 42_500 }]);

    expect(await gauge('worker_queue_oldest_waiting_age_seconds')).toBeCloseTo(42.5, 3);
    expect(queue.getWaiting).toHaveBeenCalledWith(0, 0); // only the oldest, not the whole queue
  });

  it('reports zero lag when nothing is waiting', async () => {
    queue.getWaiting.mockResolvedValue([]);
    expect(await gauge('worker_queue_oldest_waiting_age_seconds')).toBe(0);
  });

  it('never reports negative lag if clocks disagree slightly', async () => {
    vi.useFakeTimers({ now: NOW });
    queue.getWaiting.mockResolvedValue([{ timestamp: NOW + 5_000 }]);

    expect(await gauge('worker_queue_oldest_waiting_age_seconds')).toBe(0);
  });

  it('survives Redis failing during a scrape: logs it, keeps serving the metrics endpoint', async () => {
    queue.getJobCounts.mockRejectedValue(new Error('redis down'));
    queue.getWaiting.mockRejectedValue(new Error('redis down'));

    // Rendering the whole registry must still succeed.
    await expect(client.register.metrics()).resolves.toContain('worker_queue_jobs');
    expect(logger.error).toHaveBeenCalled();
  });
});

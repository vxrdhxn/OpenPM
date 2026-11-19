import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../lib/logger';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../lib/db', () => ({ pool: { query } }));

import processNotificationCleanup, { CLEANUP_BATCH } from './notificationCleanup';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

describe('processNotificationCleanup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes in batches until a batch comes back short, with the retention period as a parameter', async () => {
    query
      .mockResolvedValueOnce({ rowCount: CLEANUP_BATCH })
      .mockResolvedValueOnce({ rowCount: CLEANUP_BATCH })
      .mockResolvedValueOnce({ rowCount: 12 });

    expect(await processNotificationCleanup(90, log)).toBe(2 * CLEANUP_BATCH + 12);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]![1]).toEqual([90, CLEANUP_BATCH]);
  });

  it('stops after one query when nothing is old enough', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    expect(await processNotificationCleanup(30, log)).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

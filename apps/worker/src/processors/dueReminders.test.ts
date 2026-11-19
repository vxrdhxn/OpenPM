import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../lib/logger';

const { query, publish } = vi.hoisted(() => ({ query: vi.fn(), publish: vi.fn() }));
vi.mock('../lib/db', () => ({ pool: { query } }));
vi.mock('../lib/publish', () => ({ publish }));

import processDueReminders, { DUE_REMINDER_SQL, REMINDER_WINDOW_HOURS } from './dueReminders';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

describe('processDueReminders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the sweep with the 24-hour window and announces each organization once, with ids only', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { org_id: 'o1', user_id: 'u1' },
        { org_id: 'o1', user_id: 'u1' }, // two tasks for the same person
        { org_id: 'o1', user_id: 'u2' },
        { org_id: 'o2', user_id: 'u3' },
      ],
    });

    expect(await processDueReminders(log)).toBe(4);

    expect(query).toHaveBeenCalledWith(DUE_REMINDER_SQL, [REMINDER_WINDOW_HOURS]);
    expect(REMINDER_WINDOW_HOURS).toBe(24);
    expect(publish.mock.calls).toEqual([
      ['org:o1:updates', { type: 'notification', user_ids: ['u1', 'u2'] }, log],
      ['org:o2:updates', { type: 'notification', user_ids: ['u3'] }, log],
    ]);
  });

  it('publishes nothing when nothing is due', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await processDueReminders(log)).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('fails the job when the database does (the next scheduled run retries)', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    await expect(processDueReminders(log)).rejects.toThrow('connection refused');
  });
});

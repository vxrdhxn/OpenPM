import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('./client', () => ({
  db: { query: vi.fn(), getClient: vi.fn() },
}));

import { db } from './client';
import { logger } from '../logger';
import { withTransaction } from './transaction';

const client = { query: vi.fn(), release: vi.fn() };
const statements = () => client.query.mock.calls.map((c) => String(c[0]));

describe('withTransaction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.getClient).mockResolvedValue(client as never);
    client.query.mockResolvedValue({ rows: [] });
  });

  it('commits, returns the callback value and releases the client', async () => {
    const result = await withTransaction(async (c) => {
      await c.query('INSERT 1');
      return 42;
    });

    expect(result).toBe(42);
    expect(statements()).toEqual(['BEGIN', 'INSERT 1', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back, re-throws the original error and releases when the callback throws', async () => {
    const boom = new Error('boom');

    await expect(
      withTransaction(async (c) => {
        await c.query('INSERT 1');
        throw boom;
      })
    ).rejects.toBe(boom);

    expect(statements()).toEqual(['BEGIN', 'INSERT 1', 'ROLLBACK']);
    expect(statements()).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not let a failing ROLLBACK mask the original error', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'ROLLBACK') throw new Error('connection lost');
      return { rows: [] };
    });
    const original = new Error('original');

    await expect(
      withTransaction(async () => {
        throw original;
      })
    ).rejects.toBe(original);
    expect(client.release).toHaveBeenCalledTimes(1);
    // The failed rollback is not swallowed silently: it is logged with its error.
    expect(logger.error).toHaveBeenCalledWith({ err: expect.objectContaining({ message: 'connection lost' }) }, 'ROLLBACK failed');
  });

  it('rolls back nothing and still releases when COMMIT fails', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('commit failed');
      return { rows: [] };
    });

    await expect(withTransaction(async () => 'ok')).rejects.toThrow('commit failed');
    expect(statements()).not.toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('releases the client when BEGIN itself fails and never runs the callback', async () => {
    client.query.mockRejectedValueOnce(new Error('cannot begin'));
    const fn = vi.fn();

    await expect(withTransaction(fn)).rejects.toThrow('cannot begin');
    expect(fn).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not acquire a connection to run anything else when getClient fails', async () => {
    vi.mocked(db.getClient).mockRejectedValue(new Error('pool exhausted'));

    await expect(withTransaction(async () => 1)).rejects.toThrow('pool exhausted');
    expect(client.release).not.toHaveBeenCalled();
  });
});

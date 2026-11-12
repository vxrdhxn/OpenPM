import type { PoolClient } from 'pg';
import { db } from './client';

/**
 * Run `fn` inside a database transaction.
 *
 * - COMMITs if `fn` resolves, and returns its value.
 * - ROLLBACKs if `fn` throws, and re-throws the original error (a failing
 *   ROLLBACK never masks it).
 * - Always releases the client back to the pool.
 *
 * Do side effects that must only happen once the data is durable (queue jobs,
 * cache invalidation, pub/sub) AFTER this returns, never inside `fn`.
 * To abort and roll back from inside `fn`, throw.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    let result: T;
    try {
      result = await fn(client);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('ROLLBACK failed', rollbackErr);
      }
      throw err;
    }
    await client.query('COMMIT');
    return result;
  } finally {
    client.release();
  }
}

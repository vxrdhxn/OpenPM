import type { PoolClient } from 'pg';
import { db } from '../db/client';

/**
 * Object-storage deletions still owed (migration 028, docs/attachments.md). Not scoped to an
 * organization: the keys are random, the rows they came from are gone, and only the API's own
 * cleanup reads them.
 */

/** Record that these objects must be deleted. Call inside the transaction that deletes their rows. */
export async function owe(client: PoolClient, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await client.query(
    'INSERT INTO storage_deletions (storage_key) SELECT unnest($1::text[]) ON CONFLICT (storage_key) DO NOTHING',
    [keys]
  );
}

/** These objects are gone. */
export async function settle(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.query('DELETE FROM storage_deletions WHERE storage_key = ANY($1::text[])', [keys]);
}

/**
 * Lock up to `limit` owed deletions that are due, for the rest of the transaction. SKIP LOCKED lets
 * every API pod sweep at once without two of them working on the same key.
 */
export async function claimDue(client: PoolClient, limit: number): Promise<string[]> {
  const res = await client.query<{ storage_key: string }>(
    `SELECT storage_key FROM storage_deletions WHERE next_attempt_at <= NOW()
      ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit]
  );
  return res.rows.map((r) => r.storage_key);
}

/** Try again later: backs off with the number of attempts (5 min, 10, 20, ... up to a day). */
export async function postpone(client: PoolClient, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await client.query(
    `UPDATE storage_deletions
        SET attempts = attempts + 1,
            next_attempt_at = NOW() + LEAST(interval '1 day', interval '5 minutes' * power(2, attempts))
      WHERE storage_key = ANY($1::text[])`,
    [keys]
  );
}

/** Delete these settled keys inside the sweep's transaction. */
export async function settleIn(client: PoolClient, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await client.query('DELETE FROM storage_deletions WHERE storage_key = ANY($1::text[])', [keys]);
}

/** Owed deletions, for the metric. */
export async function countOwed(): Promise<number> {
  const rows = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM storage_deletions');
  return rows[0]?.n ?? 0;
}

/**
 * Delete up to `limit` uploads that were started but never completed, older than `olderThanMinutes`
 * (well past the upload URL's lifetime), and owe their objects in the same statement's transaction.
 */
export async function reapAbandonedUploads(client: PoolClient, olderThanMinutes: number, limit: number): Promise<string[]> {
  const res = await client.query<{ storage_key: string }>(
    `DELETE FROM task_attachments WHERE id IN (
       SELECT id FROM task_attachments
        WHERE status = 'pending' AND created_at < NOW() - make_interval(mins => $1)
        ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     RETURNING storage_key`,
    [olderThanMinutes, limit]
  );
  const keys = res.rows.map((r) => r.storage_key);
  await owe(client, keys);
  return keys;
}

import type { PoolClient } from 'pg';
import { db } from '../db/client';
import type { TenantScope } from './scope';

/** The scope's own organization row. There is no organization id from a request: it is always `scope.orgId`. */

const ORG_COLUMNS = 'id, name, slug, created_at, updated_at';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export async function find(scope: TenantScope): Promise<Organization | null> {
  const rows = await db.query<Organization>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = $1`, [scope.orgId]);
  return rows[0] ?? null;
}

/** Lock the organization's row for the transaction; null if it no longer exists. */
export async function lock(client: PoolClient, scope: TenantScope): Promise<Pick<Organization, 'name' | 'slug'> | null> {
  const res = await client.query<Pick<Organization, 'name' | 'slug'>>('SELECT name, slug FROM organizations WHERE id = $1 FOR UPDATE', [
    scope.orgId,
  ]);
  return res.rows[0] ?? null;
}

export async function rename(client: PoolClient, scope: TenantScope, name: string): Promise<Organization | null> {
  const res = await client.query<Organization>(`UPDATE organizations SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING ${ORG_COLUMNS}`, [
    name,
    scope.orgId,
  ]);
  return res.rows[0] ?? null;
}

/** The password hash of the scope's own (active) account, to re-confirm a destructive action. */
export async function ownPasswordHash(client: PoolClient, scope: TenantScope): Promise<string | undefined> {
  const res = await client.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL',
    [scope.userId, scope.orgId]
  );
  return res.rows[0]?.password_hash;
}

/** Storage keys of every attachment in the organization (files live outside the database cascade). */
export async function allStorageKeys(client: PoolClient, scope: TenantScope): Promise<string[]> {
  const res = await client.query<{ storage_key: string }>('SELECT storage_key FROM task_attachments WHERE org_id = $1', [scope.orgId]);
  return res.rows.map((r) => r.storage_key);
}

/** Every table references organizations ON DELETE CASCADE, so this removes all of its data. */
export async function remove(client: PoolClient, scope: TenantScope): Promise<void> {
  await client.query('DELETE FROM organizations WHERE id = $1', [scope.orgId]);
}

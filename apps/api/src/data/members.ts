import type { PoolClient } from 'pg';
import { db } from '../db/client';
import type { TenantScope } from './scope';

/**
 * Organization members: the active user rows of the scope's organization (one organization per user,
 * users.org_id). Every statement is scoped to `scope.orgId`.
 */

/** Shape of a member in every response. Never includes the password hash or token version. */
const MEMBER_COLUMNS = 'id, name, email, role, created_at';

/** Marks a removed account's password: never a valid bcrypt hash, so it can never match. */
const REMOVED_PASSWORD = '!removed';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

export async function listActive(scope: TenantScope): Promise<Member[]> {
  return db.query<Member>(
    `SELECT ${MEMBER_COLUMNS} FROM users WHERE org_id = $1 AND deactivated_at IS NULL ORDER BY created_at ASC, id ASC`,
    [scope.orgId]
  );
}

/**
 * Lock the organization's row until the transaction ends. Membership changes take it first, so two
 * concurrent changes cannot both pass the "at least one admin remains" check (e.g. the last two
 * admins demoting each other at once).
 */
export async function lockOrganization(client: PoolClient, scope: TenantScope): Promise<void> {
  await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [scope.orgId]);
}

/** An active member, locked for the transaction; null if there is none with this id in the organization. */
export async function lockActive(client: PoolClient, scope: TenantScope, userId: string): Promise<Pick<Member, 'id' | 'name' | 'role'> | null> {
  const res = await client.query<Pick<Member, 'id' | 'name' | 'role'>>(
    'SELECT id, name, role FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL FOR UPDATE',
    [userId, scope.orgId]
  );
  return res.rows[0] ?? null;
}

/** An active member (no lock); inside a transaction, pass its client. */
export async function findActive(scope: TenantScope, userId: string, client?: PoolClient): Promise<Pick<Member, 'id' | 'name'> | null> {
  const sql = 'SELECT id, name FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL';
  const rows = client ? (await client.query(sql, [userId, scope.orgId])).rows : await db.query(sql, [userId, scope.orgId]);
  return rows[0] ?? null;
}

/** Whether an active member other than `userId` has one of `roles`. */
export async function anotherHasRole(client: PoolClient, scope: TenantScope, userId: string, roles: string[]): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM users
      WHERE org_id = $1 AND id <> $2 AND deactivated_at IS NULL AND role = ANY($3::text[])
      LIMIT 1`,
    [scope.orgId, userId, roles]
  );
  return res.rows.length > 0;
}

export async function setRole(client: PoolClient, scope: TenantScope, userId: string, role: string): Promise<Member> {
  const res = await client.query<Member>(`UPDATE users SET role = $1 WHERE id = $2 AND org_id = $3 RETURNING ${MEMBER_COLUMNS}`, [
    role,
    userId,
    scope.orgId,
  ]);
  return res.rows[0]!;
}

/** Make `newOwnerId` the owner and the scope's user an admin, in one statement. */
export async function swapOwner(client: PoolClient, scope: TenantScope, newOwnerId: string): Promise<Member[]> {
  const res = await client.query<Member>(
    `UPDATE users SET role = CASE WHEN id = $1 THEN 'owner' ELSE 'admin' END
      WHERE org_id = $3 AND id IN ($1, $2)
      RETURNING ${MEMBER_COLUMNS}`,
    [newOwnerId, scope.userId, scope.orgId]
  );
  return res.rows;
}

/**
 * Deactivate a member (see migration 013): tombstone the row, end their sessions, drop their reset
 * links and project memberships, and unassign their tasks. Returns the projects whose boards changed.
 * The caller has already locked the member's row in this organization.
 */
export async function deactivate(client: PoolClient, scope: TenantScope, userId: string): Promise<string[]> {
  await client.query(
    `UPDATE users
        SET deactivated_at = NOW(),
            email = 'removed-' || id || '@removed.invalid',
            password_hash = $3,
            token_version = token_version + 1
      WHERE id = $1 AND org_id = $2`,
    [userId, scope.orgId, REMOVED_PASSWORD]
  );
  await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM project_members WHERE user_id = $1 AND org_id = $2', [userId, scope.orgId]);
  const unassigned = await client.query<{ project_id: string }>(
    'UPDATE tasks SET assignee_id = NULL, updated_at = NOW() WHERE assignee_id = $1 AND org_id = $2 RETURNING project_id',
    [userId, scope.orgId]
  );
  return [...new Set(unassigned.rows.map((r) => r.project_id))];
}

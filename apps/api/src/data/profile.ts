import { db } from '../db/client';
import type { TenantScope } from './scope';

/** The scope user's own account row, always matched by user id AND organization. */

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
}

export async function findOwn(scope: TenantScope): Promise<Profile | null> {
  const rows = await db.query<Profile>(
    'SELECT id, name, email, role, created_at FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL',
    [scope.userId, scope.orgId]
  );
  return rows[0] ?? null;
}

export interface ProfileChanges {
  name?: string;
  /** Already hashed. Setting it also bumps token_version, which ends every session (plugins/session.ts). */
  passwordHash?: string;
}

/** Apply the changes; null if the account is gone. Each column is written out: no request key becomes SQL. */
export async function updateOwn(
  scope: TenantScope,
  changes: ProfileChanges
): Promise<{ id: string; name: string; email: string; role: string; org_id: string; token_version: number } | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (changes.name !== undefined) {
    values.push(changes.name);
    setClauses.push(`name = $${values.length}`);
  }
  if (changes.passwordHash !== undefined) {
    values.push(changes.passwordHash);
    setClauses.push(`password_hash = $${values.length}`);
    setClauses.push('token_version = token_version + 1');
  }
  values.push(scope.userId, scope.orgId);

  const rows = await db.query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${values.length - 1} AND org_id = $${values.length} RETURNING id, name, email, role, org_id, token_version`,
    values
  );
  return rows[0] ?? null;
}

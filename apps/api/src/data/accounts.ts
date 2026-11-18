import type { PoolClient } from 'pg';
import { db } from '../db/client';

/**
 * Accounts before anyone is signed in: registration, sign-in and password reset. There is no session
 * yet, so there is no TenantScope: an account is found by its email (unique across organizations,
 * one organization per user) or by the hash of a reset token. The organization always comes from the
 * matched row, never from the request. Everything after sign-in goes through the scoped repositories.
 */

export async function slugTaken(client: PoolClient, slug: string): Promise<boolean> {
  const res = await client.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
  return res.rows.length > 0;
}

export async function emailTaken(client: PoolClient, email: string): Promise<boolean> {
  const res = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  return res.rows.length > 0;
}

export async function createOrganization(client: PoolClient, name: string, slug: string): Promise<string> {
  const res = await client.query<{ id: string }>('INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id', [name, slug]);
  return res.rows[0]!.id;
}

export async function createUser(
  client: PoolClient,
  user: { orgId: string; email: string; passwordHash: string; name: string; role: string }
): Promise<string> {
  const res = await client.query<{ id: string }>(
    'INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [user.orgId, user.email, user.passwordHash, user.name, user.role]
  );
  return res.rows[0]!.id;
}

export interface LoginAccount {
  id: string;
  org_id: string;
  role: string;
  password_hash: string;
  token_version: number | null;
}

/** The active account with this email, with what sign-in needs; null if there is none. */
export async function findForLogin(email: string): Promise<LoginAccount | null> {
  const rows = await db.query<LoginAccount>(
    'SELECT id, org_id, role, password_hash, token_version FROM users WHERE email = $1 AND deactivated_at IS NULL',
    [email]
  );
  return rows[0] ?? null;
}

export async function findByEmail(client: PoolClient, email: string): Promise<{ id: string; org_id: string } | null> {
  const res = await client.query<{ id: string; org_id: string }>('SELECT id, org_id FROM users WHERE email = $1', [email]);
  return res.rows[0] ?? null;
}

/** Replace the user's reset links with one new one (only its hash is stored). */
export async function replaceResetToken(client: PoolClient, userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
  await deleteResetTokens(client, userId);
  await client.query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, tokenHash, expiresAt]);
}

/** Lock a live reset token (so one link cannot be used twice concurrently); null if unknown or expired. */
export async function lockResetToken(client: PoolClient, tokenHash: string): Promise<{ user_id: string; org_id: string } | null> {
  const res = await client.query<{ user_id: string; org_id: string }>(
    `SELECT t.user_id, u.org_id
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.expires_at > NOW()
      FOR UPDATE OF t`,
    [tokenHash]
  );
  return res.rows[0] ?? null;
}

/** Set the password of the user a locked reset token belongs to. */
export async function setPassword(client: PoolClient, userId: string, passwordHash: string): Promise<void> {
  await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

export async function deleteResetTokens(client: PoolClient, userId: string): Promise<void> {
  await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
}

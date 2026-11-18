import type { PoolClient } from 'pg';
import { db } from '../db/client';
import type { TenantScope } from './scope';

/**
 * Organization invites. Two kinds of access, kept apart on purpose:
 *
 * - Admin functions take a TenantScope and are scoped to `scope.orgId`, like every other repository.
 * - Invitee functions (`*ByToken`) run without a session: the invitee has no account yet. There the
 *   token is the authority. Only its hash is stored and matched, and the organization, email and
 *   role always come from the invite row, never from the request.
 */

/** Shape of an invite in every response. Never includes the token or its hash. */
const INVITE_COLUMNS = 'id, email, role, expires_at, created_at, declined_at';

export interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
  /** Set when the invitee declined (the link no longer works; inviting them again resets it). */
  declined_at: string | null;
}

export interface InviteForAccept {
  id: string;
  org_id: string;
  email: string;
  role: string;
}

// ── Admin (scoped) ────────────────────────────────────────────────────────────

export async function isMemberEmail(client: PoolClient, scope: TenantScope, email: string): Promise<boolean> {
  const res = await client.query('SELECT id FROM users WHERE email = $1 AND org_id = $2', [email, scope.orgId]);
  return res.rows.length > 0;
}

/** Create or refresh the invite for `email`: re-inviting replaces the old link (its token hash is overwritten). */
export async function upsert(
  client: PoolClient,
  scope: TenantScope,
  invite: { email: string; tokenHash: string; role: string; expiresAt: Date }
): Promise<Invite> {
  const res = await client.query<Invite>(
    `INSERT INTO organization_invites (org_id, email, token_hash, role, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (org_id, email) DO UPDATE SET token_hash = $3, role = $4, expires_at = $5, declined_at = NULL
     RETURNING ${INVITE_COLUMNS}`,
    [scope.orgId, invite.email, invite.tokenHash, invite.role, invite.expiresAt]
  );
  return res.rows[0]!;
}

export async function list(scope: TenantScope): Promise<Invite[]> {
  return db.query<Invite>(`SELECT ${INVITE_COLUMNS} FROM organization_invites WHERE org_id = $1 ORDER BY created_at DESC`, [scope.orgId]);
}

/** Revoke; false if there is no such invite in the organization. */
export async function revoke(client: PoolClient, scope: TenantScope, id: string): Promise<boolean> {
  const res = await client.query('DELETE FROM organization_invites WHERE id = $1 AND org_id = $2 RETURNING id', [id, scope.orgId]);
  return res.rows.length > 0;
}

// ── Invitee (by token) ────────────────────────────────────────────────────────

/** What a live invite is for, so the accept page can show it; null if unknown, expired or declined. */
export async function describeByToken(
  tokenHash: string
): Promise<{ email: string; role: string; expires_at: string; org_name: string } | null> {
  const rows = await db.query<{ email: string; role: string; expires_at: string; org_name: string }>(
    `SELECT i.email, i.role, i.expires_at, o.name AS org_name
       FROM organization_invites i
       JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = $1 AND i.expires_at > NOW() AND i.declined_at IS NULL`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

/** Mark a live invite declined; null if unknown, expired or already declined. */
export async function declineByToken(tokenHash: string): Promise<{ id: string; org_id: string; email: string } | null> {
  const rows = await db.query<{ id: string; org_id: string; email: string }>(
    `UPDATE organization_invites SET declined_at = NOW()
      WHERE token_hash = $1 AND expires_at > NOW() AND declined_at IS NULL
      RETURNING id, org_id, email`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

/** Lock a live invite, so two simultaneous accepts of the same link cannot both create an account. */
export async function lockByToken(client: PoolClient, tokenHash: string): Promise<InviteForAccept | null> {
  const res = await client.query<InviteForAccept>(
    `SELECT id, org_id, email, role
       FROM organization_invites
      WHERE token_hash = $1 AND expires_at > NOW() AND declined_at IS NULL
      FOR UPDATE`,
    [tokenHash]
  );
  return res.rows[0] ?? null;
}

/** Users.email is unique across organizations: each user belongs to exactly one. */
export async function emailRegistered(client: PoolClient, email: string): Promise<boolean> {
  const res = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  return res.rows.length > 0;
}

/** Create the invitee's account from the invite (org, email and role). Throws 23505 if the email was taken meanwhile. */
export async function createUserFromInvite(client: PoolClient, invite: InviteForAccept, name: string, passwordHash: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [invite.org_id, invite.email, passwordHash, name, invite.role]
  );
  return res.rows[0]!.id;
}

/** Consume an invite already locked by `lockByToken` in this transaction. */
export async function consume(client: PoolClient, invite: InviteForAccept): Promise<void> {
  await client.query('DELETE FROM organization_invites WHERE id = $1', [invite.id]);
}

import type { PoolClient } from 'pg';

/**
 * Pending sign-ups (verify-by-email, docs/signup.md). Like data/accounts.ts there is no session and no
 * organization yet: a request is found by its email or by the hash of its emailed token.
 */

export interface SignupRequest {
  id: string;
  email: string;
  org_name: string;
  org_slug: string;
  name: string;
  password_hash: string;
}

/**
 * Store the sign-up for `email`, replacing an earlier one (its link stops working). Expired requests
 * of anyone are deleted on the way, so the table only holds live ones.
 */
export async function replace(
  client: PoolClient,
  request: { email: string; tokenHash: string; orgName: string; orgSlug: string; name: string; passwordHash: string; expiresAt: Date }
): Promise<string> {
  await client.query('DELETE FROM signup_requests WHERE expires_at < NOW()');
  const res = await client.query<{ id: string }>(
    `INSERT INTO signup_requests (email, token_hash, org_name, org_slug, name, password_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO UPDATE
       SET token_hash = EXCLUDED.token_hash, org_name = EXCLUDED.org_name, org_slug = EXCLUDED.org_slug,
           name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, expires_at = EXCLUDED.expires_at,
           created_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [request.email, request.tokenHash, request.orgName, request.orgSlug, request.name, request.passwordHash, request.expiresAt]
  );
  return res.rows[0]!.id;
}

/** The live request with this token hash, locked for the rest of the transaction; null if unknown or expired. */
export async function lockByToken(client: PoolClient, tokenHash: string): Promise<SignupRequest | null> {
  const res = await client.query<SignupRequest>(
    `SELECT id, email, org_name, org_slug, name, password_hash
       FROM signup_requests WHERE token_hash = $1 AND expires_at > NOW() FOR UPDATE`,
    [tokenHash]
  );
  return res.rows[0] ?? null;
}

export async function remove(client: PoolClient, id: string): Promise<void> {
  await client.query('DELETE FROM signup_requests WHERE id = $1', [id]);
}

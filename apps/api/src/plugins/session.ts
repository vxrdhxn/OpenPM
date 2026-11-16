import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import type { SessionClaims } from './auth';
import { db } from '../db/client';

export const SESSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Sign a session JWT and set it as the httpOnly auth cookie. Returns the token, which the auth routes
 * also return in the body for non-browser clients. `tv` must be the user's current token_version, or
 * the session is rejected as revoked.
 */
export function issueSession(
  fastify: FastifyInstance,
  reply: FastifyReply,
  payload: Required<SessionClaims>
): string {
  const token = fastify.jwt.sign(payload, { expiresIn: SESSION_TTL_SECONDS });

  reply.setCookie('auth_token', token, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_TTL_SECONDS,
  });

  return token;
}

/** Clear the auth cookie (the browser drops it at once). */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.setCookie('auth_token', '', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
  });
}

/**
 * End every session of a user, on every device: bumps token_version, so all tokens issued before
 * now fail authentication (and open WebSockets close at their next heartbeat). Returns the new
 * version, for re-issuing the caller's own session when it should survive (password change).
 */
export async function revokeSessions(userId: string, client?: PoolClient): Promise<number> {
  const sql = 'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version';
  const rows = client ? (await client.query(sql, [userId])).rows : await db.query(sql, [userId]);
  return rows[0]?.token_version;
}

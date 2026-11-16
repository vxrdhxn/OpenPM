import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { FastifyRequest, FastifyReply } from 'fastify';
import { getJwtSecret } from '../config';
import { db } from '../db/client';
import { authFailuresTotal } from '../metrics';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export const ROLE_RANKS: Record<string, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export function hasMinRole(userRole: string, minRequiredRole: Role): boolean {
  const userRank = ROLE_RANKS[userRole?.toLowerCase()] || 0;
  const requiredRank = ROLE_RANKS[minRequiredRole.toLowerCase()] || 999;
  return userRank >= requiredRank;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Verify the request's token (cookie or Bearer) and that its session is still current. On
     * success `request.user` is set, with the role as stored now. Never sends a response.
     */
    verifySession: (request: FastifyRequest) => Promise<SessionCheck>;
    /** Whether a verified token's session is still current (for long-lived connections). */
    isSessionCurrent: (claims: SessionClaims) => Promise<boolean>;
    requireRole: (minRole: Role) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionClaims;
    user: SessionClaims & { exp?: number; iat?: number };
  }
}

/** What a session JWT carries. `tv` is the user's token_version at sign-in (absent on old tokens = 0). */
export interface SessionClaims {
  user_id: string;
  org_id: string;
  role: string;
  tv?: number;
}

/**
 * Looks up the session's user: null if the session was revoked (token_version changed) or the user no
 * longer exists in that organization; otherwise the user's current role.
 */
export type SessionVerifier = (claims: SessionClaims) => Promise<{ role: string } | null>;

export const databaseSessionVerifier: SessionVerifier = async (claims) => {
  const [user] = await db.query<{ role: string; token_version: number }>(
    'SELECT role, token_version FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL',
    [claims.user_id, claims.org_id]
  );
  if (!user || user.token_version !== (claims.tv ?? 0)) return null;
  return { role: user.role };
};

export interface AuthPluginOptions {
  /**
   * How a verified token's session is checked against current state. Defaults to the database
   * (revocation + current role). Route unit tests, which mock the database, pass one that trusts
   * the claims (src/test/auth.ts).
   */
  verifySession?: SessionVerifier;
}

export type SessionCheck = { ok: true } | { ok: false; reason: 'missing' | 'expired' | 'invalid' | 'revoked' };

/** Coarse, safe classification of a JWT failure for logs and metrics. */
export function authFailureReason(err: unknown): 'missing' | 'expired' | 'invalid' {
  const code = String((err as { code?: string })?.code ?? '');
  if (code.includes('NO_AUTHORIZATION')) return 'missing';
  if (code.includes('EXPIRED')) return 'expired';
  return 'invalid';
}

export default fp<AuthPluginOptions>(async function (fastify, opts) {
  const sessionVerifier = opts.verifySession ?? databaseSessionVerifier;

  fastify.register(jwt, {
    secret: getJwtSecret(),
    cookie: {
      cookieName: 'auth_token',
      signed: false,
    },
  });

  fastify.decorate('isSessionCurrent', async function (claims: SessionClaims) {
    return (await sessionVerifier(claims)) !== null;
  });

  fastify.decorate('verifySession', async function (request: FastifyRequest): Promise<SessionCheck> {
    try {
      await request.jwtVerify();
    } catch (err) {
      return { ok: false, reason: authFailureReason(err) };
    }

    const current = await sessionVerifier(request.user);
    if (!current) return { ok: false, reason: 'revoked' };

    // Authorize with the role as it is now, not as it was when the token was issued.
    request.user.role = current.role;
    return { ok: true };
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    const check = await fastify.verifySession(request);
    if (!check.ok) {
      // Record why, never the credential itself.
      authFailuresTotal.inc({ reason: check.reason });
      request.log.warn({ event: 'auth_failure', reason: check.reason }, 'Authentication failed');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // From here on every log line for this request (including Fastify's own "request completed")
    // carries who made it. Only ids are added: no email, name or token.
    const { user_id, org_id } = request.user;
    const log = request.log.child({ user_id, org_id });
    request.log = log;
    reply.log = log;
  });

  fastify.decorate('requireRole', function (minRole: Role) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      if (!hasMinRole(request.user.role, minRole)) {
        return reply.code(403).send({ error: 'Forbidden: Insufficient permissions' });
      }
    };
  });
});


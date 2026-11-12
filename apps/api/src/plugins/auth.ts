import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { FastifyRequest, FastifyReply } from 'fastify';
import { getJwtSecret } from '../config';
import { authFailuresTotal } from '../metrics';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

const ROLE_RANKS: Record<string, number> = {
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
    requireRole: (minRole: Role) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      user_id: string;
      org_id: string;
      role: string;
    };
    user: {
      user_id: string;
      org_id: string;
      role: string;
    };
  }
}

/** Coarse, safe classification of a JWT failure for logs and metrics. */
export function authFailureReason(err: unknown): 'missing' | 'expired' | 'invalid' {
  const code = String((err as { code?: string })?.code ?? '');
  if (code.includes('NO_AUTHORIZATION')) return 'missing';
  if (code.includes('EXPIRED')) return 'expired';
  return 'invalid';
}

export default fp(async function (fastify, _opts) {
  fastify.register(jwt, {
    secret: getJwtSecret(),
    cookie: {
      cookieName: 'auth_token',
      signed: false,
    },
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      // Record why, never the credential itself.
      const reason = authFailureReason(err);
      authFailuresTotal.inc({ reason });
      request.log.warn({ event: 'auth_failure', reason }, 'Authentication failed');
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


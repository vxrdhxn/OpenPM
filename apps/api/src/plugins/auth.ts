import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';

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

export default fp(async function (fastify, _opts) {
  fastify.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: {
      cookieName: 'auth_token',
      signed: false,
    },
  });

  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
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


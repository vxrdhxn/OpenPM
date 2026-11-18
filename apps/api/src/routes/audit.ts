import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import * as auditLog from '../data/auditLog';
import { AUDIT_ACTIONS } from '../security/audit';
import { paginationQuerySchema } from '../query/pagination';

/**
 * GET /api/audit: the organization's security audit log, newest first. Admins and owners only: entries
 * carry IP addresses and show failed sign-ins. Read-only.
 */
const auditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get<{ Querystring: { limit: number; cursor?: string; action?: string; user_id?: string } }>('/', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          ...paginationQuerySchema,
          action: { type: 'string', enum: [...AUDIT_ACTIONS] },
          // Entries by this person, or about them (sign-in failures, role changes, removal).
          user_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const { limit, cursor, action, user_id } = request.query;
    return auditLog.list(scopeOf(request.user), { limit, cursor, action, userId: user_id });
  });
};

export default auditRoutes;

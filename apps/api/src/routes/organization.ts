import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import { clearSessionCookie } from '../plugins/session';
import { originOf } from '../security/audit';
import * as organizationService from '../services/organization';

/**
 * /api/organization: the caller's own organization. Always the organization in the session; there is
 * no organization id in any URL. Rules: services/organization.ts.
 */
const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // Everyone in the organization can see its name and slug.
  fastify.get('/', { preHandler: fastify.requireRole('viewer') }, async (request) => organizationService.getOrganization(scopeOf(request.user)));

  // Rename (admins).
  fastify.patch<{ Body: { name: string } }>('/', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', minLength: 2, maxLength: 255, pattern: '\\S' } },
        additionalProperties: false,
      },
    },
  }, async (request) => organizationService.renameOrganization(scopeOf(request.user), request.body.name, originOf(request)));

  // Delete everything (owners, with the slug typed out and their password).
  fastify.delete<{ Body: { confirm_slug: string; password: string } }>('/', {
    preHandler: fastify.requireRole('owner'),
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['confirm_slug', 'password'],
        properties: {
          confirm_slug: { type: 'string', maxLength: 255 },
          password: { type: 'string', maxLength: 1024 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    await organizationService.deleteOrganization(scopeOf(request.user), request.body.confirm_slug, request.body.password, request.log, request.ip);
    // Members' tokens now fail (their users are gone); open WebSockets close at the next heartbeat.
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
};

export default organizationRoutes;

import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import { clearSessionCookie } from '../plugins/session';
import { ROLES } from '../security/memberPolicy';
import { originOf } from '../security/audit';
import * as memberService from '../services/members';

/** /api/members: the organization's people. Rules: services/members.ts. */
const memberRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // Everyone in the organization can see who is in it.
  fastify.get('/', { preHandler: fastify.requireRole('viewer') }, async (request) => memberService.listMembers(scopeOf(request.user)));

  // Change a member's role.
  fastify.patch<{ Params: { id: string }; Body: { role: string } }>('/:id', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['role'],
        properties: { role: { type: 'string', enum: [...ROLES] } },
        additionalProperties: false,
      },
    },
  }, async (request) => memberService.changeRole(scopeOf(request.user), request.params.id, request.body.role, originOf(request)));

  // Remove a member from the organization.
  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: fastify.requireRole('admin') }, async (request, reply) => {
    await memberService.removeMember(scopeOf(request.user), request.params.id, originOf(request));
    return reply.code(204).send();
  });

  // Make another member the owner and step down to admin.
  fastify.post<{ Params: { id: string } }>('/:id/transfer-ownership', { preHandler: fastify.requireRole('owner') }, async (request) =>
    memberService.transferOwnership(scopeOf(request.user), request.params.id, originOf(request))
  );

  // Leave the organization yourself.
  fastify.post('/leave', { preHandler: fastify.requireRole('viewer') }, async (request, reply) => {
    await memberService.leave(scopeOf(request.user), originOf(request));
    clearSessionCookie(reply);
    return reply.send({ success: true });
  });
};

export default memberRoutes;

import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import { originOf } from '../security/audit';
import * as projectMemberService from '../services/projectMembers';

/** /api/projects/:projectId/members. Rules: services/projectMembers.ts. */
const projectMemberRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // Everyone who can see the project, with `member` true for those added to it explicitly.
  fastify.get<{ Params: { projectId: string } }>('/:projectId/members', { preHandler: fastify.requireRole('viewer') }, async (request) =>
    projectMemberService.listProjectPeople(scopeOf(request.user), request.params.projectId)
  );

  // Add someone from the organization (members and up).
  fastify.post<{ Params: { projectId: string }; Body: { user_id: string } }>('/:projectId/members', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['user_id'],
        properties: { user_id: { type: 'string', format: 'uuid' } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { user_id } = request.body;
    const added = await projectMemberService.addProjectMember(scopeOf(request.user), request.params.projectId, user_id, originOf(request));
    return reply.code(added ? 201 : 200).send({ user_id, member: true });
  });

  // Remove someone (members and up), or leave yourself (anyone).
  fastify.delete<{ Params: { projectId: string; userId: string } }>('/:projectId/members/:userId', async (request, reply) => {
    await projectMemberService.removeProjectMember(scopeOf(request.user), request.params.projectId, request.params.userId, originOf(request));
    return reply.code(204).send();
  });
};

export default projectMemberRoutes;

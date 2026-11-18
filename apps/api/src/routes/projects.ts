import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import type { ProjectChanges, ProjectListFilter } from '../data/projects';
import { paginationQuerySchema, searchQuerySchema } from '../query/pagination';
import { originOf } from '../security/audit';
import { VISIBILITIES, type Visibility } from '../security/projectAccess';
import * as projectService from '../services/projects';
import type { NewProject } from '../services/projects';

/**
 * /api/projects. HTTP only: validation schemas, roles and status codes. The rules live in
 * services/projects.ts and the SQL in data/projects.ts. Errors thrown there (404, 403) are answered by
 * the central error handler.
 *
 * Private projects: the project gate in app.ts answers 404 to non-members on /:id routes. Path ids are
 * validated as UUIDs app-wide (plugins/uuidParams.ts), so routes declare no params schema.
 */

const projectFields = {
  name: { type: 'string', minLength: 1 },
  description: { type: 'string' },
  visibility: { type: 'string', enum: [...VISIBILITIES] },
} as const;

const projectRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // POST / (member or higher)
  fastify.post<{ Body: NewProject }>('/', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: projectFields,
        minProperties: 1,
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const project = await projectService.createProject(scopeOf(request.user), request.body);
    return reply.code(201).send(project);
  });

  // GET / (viewer or higher): newest first, paginated, optionally searched by name and filtered by
  // status. Response: { items, next_cursor } (see query/pagination.ts).
  fastify.get<{ Querystring: ProjectListFilter }>('/', {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          ...paginationQuerySchema,
          q: searchQuerySchema,
          status: { type: 'string', enum: ['active', 'archived'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => projectService.listProjects(scopeOf(request.user), request.query));

  // GET /:id (viewer or higher)
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: fastify.requireRole('viewer'),
  }, async (request) => projectService.getProject(scopeOf(request.user), request.params.id));

  // PATCH /:id (member or higher; visibility: admins, owners and the creator)
  fastify.patch<{ Params: { id: string }; Body: ProjectChanges & { visibility?: Visibility } }>('/:id', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        properties: { ...projectFields, status: { type: 'string', enum: ['active', 'archived'] } },
        minProperties: 1,
        additionalProperties: false,
      },
    },
  }, async (request) =>
    projectService.updateProject(scopeOf(request.user), request.params.id, request.body, originOf(request))
  );

  // DELETE /:id (admin or higher)
  fastify.delete<{ Params: { id: string } }>('/:id', {
    preHandler: fastify.requireRole('admin'),
  }, async (request, reply) => {
    await projectService.deleteProject(scopeOf(request.user), request.params.id, originOf(request), request.log);
    return reply.code(204).send();
  });
};

export default projectRoutes;

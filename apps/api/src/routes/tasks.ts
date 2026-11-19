import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import type { TaskChanges } from '../data/tasks';
import { taskFilterQuerySchema, type TaskFilters } from '../query/taskFilters';
import * as taskService from '../services/tasks';
import { sendJson } from './send';
import { MAX_DESCRIPTION_LENGTH, type NewTask } from '../services/tasks';

/**
 * /api/projects/:projectId/tasks. HTTP only: schemas, roles and status codes. The rules live in
 * services/tasks.ts and the SQL in data/tasks.ts; errors thrown there are answered by the central
 * error handler. Path ids are validated as UUIDs app-wide (plugins/uuidParams.ts), and the project
 * gate in app.ts has already answered 404 to anyone who cannot see a private project.
 */

export { BOARD_COLUMN_LIMIT, MAX_DESCRIPTION_LENGTH } from '../services/tasks';

type ProjectParams = { projectId: string };
type TaskParams = ProjectParams & { taskId: string };

const PRIORITY = { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] } as const;

const taskRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // POST /:projectId/tasks (member or higher)
  fastify.post<{ Params: ProjectParams; Body: NewTask }>('/:projectId/tasks', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', maxLength: MAX_DESCRIPTION_LENGTH },
          priority: PRIORITY,
          assignee_id: { type: 'string', format: 'uuid' },
          due_date: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    const task = await taskService.createTask(scopeOf(request.user), request.params.projectId, request.body, request.id, request.log);
    return reply.code(201).send(task);
  });

  // GET /:projectId/tasks (viewer or higher): the board (see services/tasks.getBoard for its shape).
  fastify.get<{ Params: ProjectParams; Querystring: TaskFilters }>('/:projectId/tasks', {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: {
        type: 'object',
        properties: taskFilterQuerySchema,
        additionalProperties: false,
      },
    },
  }, async (request, reply) => sendJson(reply, await taskService.getBoard(scopeOf(request.user), request.params.projectId, request.query)));

  // PATCH /:projectId/tasks/:taskId (member or higher)
  fastify.patch<{ Params: TaskParams; Body: TaskChanges & { version?: number } }>('/:projectId/tasks/:taskId', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', maxLength: MAX_DESCRIPTION_LENGTH },
          status: { type: 'string', enum: ['todo', 'in_progress', 'in_review', 'done'] },
          priority: PRIORITY,
          assignee_id: { type: 'string', format: 'uuid', nullable: true },
          due_date: { type: 'string', format: 'date-time', nullable: true },
          // The version the edit is based on: refused with 409 if the task changed since (docs/concurrency.md).
          version: { type: 'integer', minimum: 1 },
        },
        // Reject unknown keys (the app runs Ajv with removeAdditional: false) and empty bodies.
        minProperties: 1,
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const { version, ...changes } = request.body;
    return taskService.updateTask(scopeOf(request.user), request.params.projectId, request.params.taskId, changes, version);
  });

  // DELETE /:projectId/tasks/:taskId (admin or higher)
  fastify.delete<{ Params: TaskParams }>('/:projectId/tasks/:taskId', {
    preHandler: fastify.requireRole('admin'),
  }, async (request, reply) => {
    await taskService.deleteTask(scopeOf(request.user), request.params.projectId, request.params.taskId, request.log);
    return reply.code(204).send();
  });
};

export default taskRoutes;

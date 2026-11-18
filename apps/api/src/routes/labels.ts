import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import * as labelService from '../services/labels';
import { LABEL_COLORS, MAX_LABELS_PER_TASK } from '../services/labels';

/** /api/labels and PUT /api/projects/:projectId/tasks/:taskId/labels. Rules: services/labels.ts. */

export { LABEL_COLORS, MAX_LABELS_PER_ORG, MAX_LABELS_PER_TASK } from '../services/labels';

const nameSchema = { type: 'string', minLength: 1, maxLength: 50, pattern: '\\S' } as const;
const colorSchema = { type: 'string', enum: [...LABEL_COLORS] } as const;

/** The organization's labels: viewers read, members create and edit, admins delete. */
export const labelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get('/', { preHandler: fastify.requireRole('viewer') }, async (request) => labelService.listLabels(scopeOf(request.user)));

  fastify.post<{ Body: { name: string; color: string } }>('/', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: nameSchema, color: { ...colorSchema, default: 'gray' } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const label = await labelService.createLabel(scopeOf(request.user), request.body.name, request.body.color);
    return reply.code(201).send(label);
  });

  fastify.patch<{ Params: { id: string }; Body: { name?: string; color?: string } }>('/:id', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        properties: { name: nameSchema, color: colorSchema },
        minProperties: 1,
        additionalProperties: false,
      },
    },
  }, async (request) => labelService.updateLabel(scopeOf(request.user), request.params.id, request.body));

  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: fastify.requireRole('admin') }, async (request, reply) => {
    await labelService.deleteLabel(scopeOf(request.user), request.params.id);
    return reply.code(204).send();
  });
};

/** A task's labels: PUT { label_ids } replaces the set (members and above). */
export const taskLabelRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.put<{ Params: { projectId: string; taskId: string }; Body: { label_ids: string[] } }>('/:projectId/tasks/:taskId/labels', {
    preHandler: fastify.requireRole('member'),
    schema: {
      body: {
        type: 'object',
        required: ['label_ids'],
        properties: {
          label_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: MAX_LABELS_PER_TASK, uniqueItems: true },
        },
        additionalProperties: false,
      },
    },
  }, async (request) =>
    labelService.setTaskLabels(scopeOf(request.user), request.params.projectId, request.params.taskId, request.body.label_ids)
  );
};

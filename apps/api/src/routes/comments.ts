import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import { paginationQuerySchema } from '../query/pagination';
import * as commentService from '../services/comments';
import { MAX_COMMENT_LENGTH, MAX_MENTIONS } from '../services/comments';
import type { TaskPath } from '../data/tasks';

/**
 * /api/projects/:projectId/tasks/:taskId/comments. HTTP only; the rules (who may edit or delete,
 * mentions, notifications) are in services/comments.ts.
 */

export { MAX_COMMENT_LENGTH, MAX_MENTIONS } from '../services/comments';

type CommentPath = TaskPath & { commentId: string };
type CommentBody = { body: string; mention_ids?: string[] };

const bodySchema = {
  type: 'object',
  required: ['body'],
  properties: {
    // At least one non-whitespace character.
    body: { type: 'string', minLength: 1, maxLength: MAX_COMMENT_LENGTH, pattern: '\\S' },
    // People to notify (the UI's @-autocomplete). Each must be an active member who can see the project.
    mention_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: MAX_MENTIONS, uniqueItems: true },
  },
  additionalProperties: false,
} as const;

const commentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  const base = '/:projectId/tasks/:taskId/comments';

  fastify.get<{ Params: TaskPath; Querystring: { limit: number; cursor?: string } }>(base, {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: { type: 'object', properties: { ...paginationQuerySchema }, additionalProperties: false },
    },
  }, async (request) =>
    commentService.listComments(scopeOf(request.user), request.params, request.query.limit, request.query.cursor)
  );

  fastify.post<{ Params: TaskPath; Body: CommentBody }>(base, {
    preHandler: fastify.requireRole('member'),
    schema: { body: bodySchema },
  }, async (request, reply) => {
    const comment = await commentService.addComment(scopeOf(request.user), request.params, request.body.body, request.body.mention_ids);
    return reply.code(201).send(comment);
  });

  fastify.patch<{ Params: CommentPath; Body: CommentBody }>(`${base}/:commentId`, {
    preHandler: fastify.requireRole('member'),
    schema: { body: bodySchema },
  }, async (request) =>
    commentService.editComment(scopeOf(request.user), request.params, request.params.commentId, request.body.body, request.body.mention_ids)
  );

  fastify.delete<{ Params: CommentPath }>(`${base}/:commentId`, {
    preHandler: fastify.requireRole('member'),
  }, async (request, reply) => {
    await commentService.deleteComment(scopeOf(request.user), request.params, request.params.commentId);
    return reply.code(204).send();
  });
};

export default commentRoutes;

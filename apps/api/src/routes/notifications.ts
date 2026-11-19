import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import * as notifications from '../data/notifications';
import { NotFoundError } from '../domain/errors';
import { paginationQuerySchema } from '../query/pagination';
import { NOTIFICATION_TYPES } from '../notifications/notify';

/** /api/notifications: the caller's own notifications (read model: data/notifications.ts). */
const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // Newest first, paginated; ?unread=true for unread only.
  fastify.get<{ Querystring: { limit: number; cursor?: string; unread?: boolean } }>('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: { ...paginationQuerySchema, unread: { type: 'boolean' } },
        additionalProperties: false,
      },
    },
  }, async (request) => notifications.list(scopeOf(request.user), request.query));

  // For the badge.
  fastify.get('/unread-count', async (request) => ({ count: await notifications.unreadCount(scopeOf(request.user)) }));

  // Mark one read (idempotent).
  fastify.post<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
    if (!(await notifications.markRead(scopeOf(request.user), request.params.id))) throw new NotFoundError('Notification not found');
    return reply.code(204).send();
  });

  // Preferences: which types the caller has switched off (docs/notifications.md).
  fastify.get('/preferences', async (request) => ({
    types: NOTIFICATION_TYPES,
    muted: await notifications.mutedTypes(scopeOf(request.user)),
  }));

  fastify.put<{ Body: { muted: string[] } }>('/preferences', {
    schema: {
      body: {
        type: 'object',
        required: ['muted'],
        properties: {
          muted: { type: 'array', items: { type: 'string', enum: [...NOTIFICATION_TYPES] }, uniqueItems: true, maxItems: NOTIFICATION_TYPES.length },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const scope = scopeOf(request.user);
    if (!(await notifications.setMutedTypes(scope, request.body.muted))) throw new NotFoundError('User not found');
    return { types: NOTIFICATION_TYPES, muted: request.body.muted };
  });

  // Mark everything read.
  fastify.post('/read-all', async (request) => ({ marked: await notifications.markAllRead(scopeOf(request.user)) }));
};

export default notificationRoutes;

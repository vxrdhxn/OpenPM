import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import * as notifications from '../data/notifications';
import { NotFoundError } from '../domain/errors';
import { paginationQuerySchema } from '../query/pagination';

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

  // Mark everything read.
  fastify.post('/read-all', async (request) => ({ marked: await notifications.markAllRead(scopeOf(request.user)) }));
};

export default notificationRoutes;

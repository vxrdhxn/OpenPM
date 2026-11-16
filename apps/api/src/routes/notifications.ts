import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { Conditions, decodeCursor, paginationQuerySchema, toPage } from '../query/pagination';

/**
 * The caller's own notifications: /api/notifications. Every query is scoped to the caller's user id
 * AND organization, so nobody can read or mark anyone else's.
 */
const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // GET / — newest first, paginated; ?unread=true for unread only.
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: { ...paginationQuerySchema, unread: { type: 'boolean' } },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const { org_id, user_id } = request.user;
    const { limit, cursor, unread } = request.query as { limit: number; cursor?: string; unread?: boolean };

    const where = new Conditions()
      .add((p) => `n.user_id = ${p(user_id)}`)
      .add((p) => `n.org_id = ${p(org_id)}`);
    if (unread) where.add(() => 'n.read_at IS NULL');
    if (cursor) {
      const after = decodeCursor(cursor);
      where.add((p) => `(n.created_at, n.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
    }

    const rows = await db.query(
      `SELECT n.id, n.type, n.project_id, n.task_id, n.comment_id, n.data, n.read_at, n.created_at,
              n.actor_id, a.name AS actor_name, t.title AS task_title,
              n.created_at::text AS sort_key
         FROM notifications n
         LEFT JOIN users a ON a.id = n.actor_id
         LEFT JOIN tasks t ON t.id = n.task_id AND t.org_id = n.org_id
        WHERE ${where.sql()}
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT ${where.param(limit + 1)}`,
      where.params
    );
    return toPage(rows, limit);
  });

  // GET /unread-count — for the badge.
  fastify.get('/unread-count', async (request) => {
    const { org_id, user_id } = request.user;
    const [row] = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND org_id = $2 AND read_at IS NULL',
      [user_id, org_id]
    );
    return { count: row?.count ?? 0 };
  });

  // POST /:id/read — mark one read (idempotent).
  fastify.post('/:id/read', async (request, reply) => {
    const { org_id, user_id } = request.user;
    const { id } = request.params as { id: string };
    const res = await db.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND user_id = $2 AND org_id = $3 RETURNING id`,
      [id, user_id, org_id]
    );
    if (res.length === 0) return reply.code(404).send({ error: 'Notification not found' });
    return reply.code(204).send();
  });

  // POST /read-all — mark everything read.
  fastify.post('/read-all', async (request) => {
    const { org_id, user_id } = request.user;
    const res = await db.query(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND org_id = $2 AND read_at IS NULL RETURNING id',
      [user_id, org_id]
    );
    return { marked: res.length };
  });
};

export default notificationRoutes;

import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { AUDIT_ACTIONS } from '../security/audit';
import { Conditions, decodeCursor, paginationQuerySchema, toPage } from '../query/pagination';

/**
 * GET /api/audit: the organization's security audit log, newest first (docs/audit-log.md). Admins
 * and owners only: entries carry IP addresses and show failed sign-ins.
 *
 * Read-only. No route writes, edits or deletes entries; only the retention sweep removes old ones.
 */
const auditRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get('/', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          ...paginationQuerySchema,
          action: { type: 'string', enum: [...AUDIT_ACTIONS] },
          // Entries by this person, or about them (sign-in failures, role changes, removal).
          user_id: { type: 'string', format: 'uuid' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const { org_id } = request.user;
    const { limit, cursor, action, user_id } = request.query as { limit: number; cursor?: string; action?: string; user_id?: string };

    const where = new Conditions().add((p) => `a.org_id = ${p(org_id)}`);
    if (action) where.add((p) => `a.action = ${p(action)}`);
    if (user_id) where.add((p) => `(a.actor_id = ${p(user_id)} OR (a.target_type = 'user' AND a.target_id = ${p(user_id)}))`);
    if (cursor) {
      const after = decodeCursor(cursor);
      where.add((p) => `(a.created_at, a.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
    }

    // Names come from the live rows when they still exist (scoped to the organization), else from
    // what the entry recorded.
    const rows = await db.query(
      `SELECT a.id, a.action, a.created_at, a.created_at::text AS sort_key,
              a.actor_id, actor.name AS actor_name, actor.email AS actor_email,
              a.target_type, a.target_id,
              COALESCE(tu.name, tp.name, a.metadata->>'name', a.metadata->>'email') AS target_name,
              a.ip, a.user_agent, a.request_id, a.metadata
         FROM audit_log a
         LEFT JOIN users actor ON actor.id = a.actor_id AND actor.org_id = a.org_id
         LEFT JOIN users tu ON a.target_type = 'user' AND tu.id = a.target_id AND tu.org_id = a.org_id
         LEFT JOIN projects tp ON a.target_type = 'project' AND tp.id = a.target_id AND tp.org_id = a.org_id
        WHERE ${where.sql()}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${where.param(limit + 1)}`,
      where.params
    );
    return toPage(rows, limit);
  });
};

export default auditRoutes;

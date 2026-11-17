import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { visibleProjectSql } from '../security/projectAccess';
import { Conditions, decodeCursor, paginationQuerySchema, toPage } from '../query/pagination';
import { TASK_LABELS_COLUMN } from '../query/taskLabels';
import {
  applyTaskFilters,
  taskFilterQuerySchema,
  taskSortExpression,
  type SortOrder,
  type TaskFilters,
  type TaskSort,
} from '../query/taskFilters';

interface TaskSearchQuery extends TaskFilters {
  project_id?: string;
  sort: TaskSort;
  order: SortOrder;
  limit: number;
  cursor?: string;
}

/**
 * GET /api/tasks: search tasks across every project of the caller's organization (e.g. "assigned
 * to me, due this week, most urgent first"). Paginated with a cursor; response `{ items, next_cursor }`.
 *
 *   ?assignee=me&status=todo&status=in_progress&sort=due_date&order=asc&limit=20
 *
 * A cursor is only valid with the same filters and sort it was issued for.
 */
const taskSearchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get('/', {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          ...taskFilterQuerySchema,
          ...paginationQuerySchema,
          project_id: { type: 'string', format: 'uuid' },
          sort: { type: 'string', enum: ['created_at', 'updated_at', 'due_date', 'priority'], default: 'created_at' },
          order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const query = request.query as TaskSearchQuery;
    const { expr, type } = taskSortExpression(query.sort, query.order);
    const direction = query.order === 'asc' ? 'ASC' : 'DESC';

    const where = new Conditions().add((p) => `t.org_id = ${p(org_id)}`).add((p) => visibleProjectSql('p', request.user, p));
    if (query.project_id) where.add((p) => `t.project_id = ${p(query.project_id)}`);
    applyTaskFilters(where, query, user_id);

    if (query.cursor) {
      const after = decodeCursor(query.cursor);
      const op = query.order === 'asc' ? '>' : '<';
      // `type` and `expr` come from taskSortExpression's fixed list, never from the request.
      where.add((p) => `(${expr}, t.id) ${op} (${p(after.key)}::${type}, ${p(after.id)}::uuid)`);
    }

    const rows = await db.query(
      `SELECT t.id, t.project_id, p.name AS project_name, t.title, t.description, t.status, t.priority,
              t.assignee_id, u.name AS assignee_name, t.due_date, t.created_at, t.updated_at, ${TASK_LABELS_COLUMN},
              (${expr})::text AS sort_key
         FROM tasks t
         JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
         LEFT JOIN users u ON u.id = t.assignee_id
        WHERE ${where.sql()}
        ORDER BY ${expr} ${direction}, t.id ${direction}
        LIMIT ${where.param(query.limit + 1)}`,
      where.params
    );

    return reply.send(toPage(rows, query.limit));
  });
};

export default taskSearchRoutes;

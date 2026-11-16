import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { Conditions, decodeCursor, paginationQuerySchema, toPage } from '../query/pagination';

/** How many projects the dashboard's progress list shows (most recently active first). */
export const DASHBOARD_PROJECTS = 6;

/** The activity feed shows product activity only: account and membership events stay out of it. */
export const FEED_ENTITY_TYPES = ['project', 'task', 'comment'] as const;

const UUID_REGEX = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

/**
 * GET /api/dashboard: the numbers the dashboard leads with, for the caller's organization.
 *
 * - `my`: the caller's open tasks (not done), how many are overdue, and how many are due within the
 *   next 7 days. "Now" is the database clock.
 * - `projects`: how many projects are active, and progress (tasks by status) for the most recently
 *   active ones.
 *
 * The task lists on the dashboard come from GET /api/tasks; the feed from GET /api/activity.
 */
export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get('/', { preHandler: fastify.requireRole('viewer') }, async (request) => {
    const { org_id, user_id } = request.user;

    const [mine, activeCount, projects] = await Promise.all([
      db.query<{ open: number; overdue: number; due_soon: number }>(
        `SELECT count(*) FILTER (WHERE status <> 'done')::int AS open,
                count(*) FILTER (WHERE status <> 'done' AND due_date < NOW())::int AS overdue,
                count(*) FILTER (WHERE status <> 'done' AND due_date >= NOW() AND due_date < NOW() + INTERVAL '7 days')::int AS due_soon
           FROM tasks
          WHERE org_id = $1 AND assignee_id = $2`,
        [org_id, user_id]
      ),
      db.query<{ n: number }>(`SELECT count(*)::int AS n FROM projects WHERE org_id = $1 AND status = 'active'`, [org_id]),
      // First pick the most recently active projects (one index lookup each, on
      // idx_tasks_project_updated), then count statuses for those few only. Aggregating every task
      // of the organization first took 57 ms at 50,000 tasks; this takes 8 ms (docs/load-testing.md).
      db.query(
        `SELECT top.id, top.name, top.last_activity, c.total, c.todo, c.in_progress, c.in_review, c.done
           FROM (
             SELECT p.id, p.name, COALESCE(la.last, p.created_at) AS last_activity
               FROM projects p
               LEFT JOIN LATERAL (
                 SELECT t.updated_at AS last FROM tasks t
                  WHERE t.project_id = p.id ORDER BY t.updated_at DESC LIMIT 1
               ) la ON TRUE
              WHERE p.org_id = $1 AND p.status = 'active'
              ORDER BY COALESCE(la.last, p.created_at) DESC, p.id
              LIMIT $2
           ) top
           CROSS JOIN LATERAL (
             SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE t.status = 'todo')::int AS todo,
                    count(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
                    count(*) FILTER (WHERE t.status = 'in_review')::int AS in_review,
                    count(*) FILTER (WHERE t.status = 'done')::int AS done
               FROM tasks t
              WHERE t.project_id = top.id AND t.org_id = $1 -- a parameter, not top.org_id: see migration 019
           ) c
          ORDER BY top.last_activity DESC, top.id`,
        [org_id, DASHBOARD_PROJECTS]
      ),
    ]);

    return {
      my: mine[0] ?? { open: 0, overdue: 0, due_soon: 0 },
      projects: { active: activeCount[0]?.n ?? 0, recent: projects },
    };
  });
};

/**
 * GET /api/activity: the organization's recent product activity, newest first, paginated.
 * `project_id` narrows it to one project. Each entry names who did it and, where the thing still
 * exists, what it was done to (`entity_name`, and the `task_id` / `project_id` to link to).
 */
export const activityRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get('/', {
    preHandler: fastify.requireRole('viewer'),
    schema: {
      querystring: {
        type: 'object',
        properties: { ...paginationQuerySchema, project_id: { type: 'string', format: 'uuid' } },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const { org_id } = request.user;
    const { limit, cursor, project_id } = request.query as { limit: number; cursor?: string; project_id?: string };

    const where = new Conditions()
      .add((p) => `a.org_id = ${p(org_id)}`)
      .add((p) => `a.entity_type = ANY(${p([...FEED_ENTITY_TYPES])}::text[])`);
    if (project_id) where.add((p) => `COALESCE(t.project_id, ct.project_id, pr.id) = ${p(project_id)}`);
    if (cursor) {
      const after = decodeCursor(cursor);
      where.add((p) => `(a.created_at, a.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
    }

    // A comment's task comes from its metadata; the CASE guards the cast so an unexpected value can
    // never make the whole feed fail. Every join is also scoped to the organization.
    const rows = await db.query(
      `SELECT a.id, a.entity_type, a.entity_id, a.action, a.created_at, a.created_at::text AS sort_key,
              a.user_id, u.name AS user_name,
              COALESCE(t.title, ct.title, pr.name, a.metadata->>'title', a.metadata->>'name') AS entity_name,
              COALESCE(t.id, ct.id) AS task_id,
              COALESCE(t.project_id, ct.project_id, pr.id) AS project_id,
              CASE WHEN a.action = 'updated' AND a.entity_type = 'task' THEN a.metadata ELSE NULL END AS changes
         FROM activity_log a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN tasks t ON a.entity_type = 'task' AND t.id = a.entity_id AND t.org_id = a.org_id
         LEFT JOIN tasks ct ON a.entity_type = 'comment' AND ct.org_id = a.org_id
               AND ct.id = CASE WHEN a.metadata->>'task_id' ~ '${UUID_REGEX}' THEN (a.metadata->>'task_id')::uuid END
         LEFT JOIN projects pr ON a.entity_type = 'project' AND pr.id = a.entity_id AND pr.org_id = a.org_id
        WHERE ${where.sql()}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${where.param(limit + 1)}`,
      where.params
    );
    return toPage(rows, limit);
  });
};

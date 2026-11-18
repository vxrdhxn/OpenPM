import { db } from '../db/client';
import { seesAllProjects, visibleProjectSql } from '../security/projectAccess';
import { Conditions, decodeCursor, toPage, type Page } from '../query/pagination';
import { viewerOf, type TenantScope } from './scope';

/** Read models for the dashboard and the activity feed. Org-scoped, and private projects stay out. */

/** How many projects the dashboard's progress list shows (most recently active first). */
export const DASHBOARD_PROJECTS = 6;

/** The activity feed shows product activity only: account and membership events stay out of it. */
export const FEED_ENTITY_TYPES = ['project', 'task', 'comment'] as const;

const UUID_REGEX = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

/**
 * The project an activity entry belongs to: the live task's, the comment's task's, the project
 * itself, or for a deleted task the project recorded with it (metadata, guarded like task_id).
 */
const ENTRY_PROJECT = `COALESCE(t.project_id, ct.project_id, pr.id,
  CASE WHEN a.metadata->>'project_id' ~ '${UUID_REGEX}' THEN (a.metadata->>'project_id')::uuid END)`;

export interface DashboardSummary {
  my: { open: number; overdue: number; due_soon: number };
  projects: { active: number; recent: unknown[] };
}

/**
 * - `my`: the scope user's open tasks (not done), how many are overdue, and how many are due within
 *   the next 7 days. "Now" is the database clock.
 * - `projects`: how many projects are active, and progress (tasks by status) for the most recently
 *   active ones.
 */
export async function summary(scope: TenantScope): Promise<DashboardSummary> {
  // `$n` is the caller's id; it is referenced either way, because Postgres rejects a bound parameter
  // the query never uses.
  const visible = (alias: string, n: number) =>
    seesAllProjects(scope.role) ? `$${n}::uuid IS NOT NULL` : visibleProjectSql(alias, viewerOf(scope), () => `$${n}`);

  const [mine, activeCount, projects] = await Promise.all([
    db.query<DashboardSummary['my']>(
      `SELECT count(*) FILTER (WHERE t.status <> 'done')::int AS open,
              count(*) FILTER (WHERE t.status <> 'done' AND t.due_date < NOW())::int AS overdue,
              count(*) FILTER (WHERE t.status <> 'done' AND t.due_date >= NOW() AND t.due_date < NOW() + INTERVAL '7 days')::int AS due_soon
         FROM tasks t
         JOIN projects vp ON vp.id = t.project_id
        WHERE t.org_id = $1 AND t.assignee_id = $2 AND ${visible('vp', 2)}`,
      [scope.orgId, scope.userId]
    ),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM projects p WHERE p.org_id = $1 AND p.status = 'active' AND ${visible('p', 2)}`, [
      scope.orgId,
      scope.userId,
    ]),
    // First pick the most recently active projects (one index lookup each, on
    // idx_tasks_project_updated), then count statuses for those few only. Aggregating every task of
    // the organization first took 57 ms at 50,000 tasks; this takes 8 ms (docs/load-testing.md).
    db.query(
      `SELECT top.id, top.name, top.last_activity, c.total, c.todo, c.in_progress, c.in_review, c.done
         FROM (
           SELECT p.id, p.name, COALESCE(la.last, p.created_at) AS last_activity
             FROM projects p
             LEFT JOIN LATERAL (
               SELECT t.updated_at AS last FROM tasks t
                WHERE t.project_id = p.id ORDER BY t.updated_at DESC LIMIT 1
             ) la ON TRUE
            WHERE p.org_id = $1 AND p.status = 'active' AND ${visible('p', 3)}
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
      [scope.orgId, DASHBOARD_PROJECTS, scope.userId]
    ),
  ]);

  return {
    my: mine[0] ?? { open: 0, overdue: 0, due_soon: 0 },
    projects: { active: activeCount[0]?.n ?? 0, recent: projects },
  };
}

/**
 * The organization's recent product activity, newest first. Each entry names who did it and, where
 * the thing still exists, what it was done to (`entity_name`, and the `task_id` / `project_id`).
 */
export async function activityFeed(scope: TenantScope, page: { limit: number; cursor?: string; projectId?: string }): Promise<Page<unknown>> {
  const where = new Conditions()
    .add((p) => `a.org_id = ${p(scope.orgId)}`)
    .add((p) => `a.entity_type = ANY(${p([...FEED_ENTITY_TYPES])}::text[])`);
  if (page.projectId) where.add((p) => `${ENTRY_PROJECT} = ${p(page.projectId)}`);
  // Private projects: an entry shows only if its project still exists and the caller can see it. So
  // someone outside a private project never sees its tasks' titles, even of deleted tasks; for them,
  // entries about deleted projects are gone too (admins and owners still see everything).
  where.add((p) => {
    const rule = visibleProjectSql('vp', viewerOf(scope), p);
    return rule === 'TRUE' ? 'TRUE' : `EXISTS (SELECT 1 FROM projects vp WHERE vp.id = ${ENTRY_PROJECT} AND vp.org_id = a.org_id AND ${rule})`;
  });
  if (page.cursor) {
    const after = decodeCursor(page.cursor);
    where.add((p) => `(a.created_at, a.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
  }

  // A comment's task comes from its metadata; the CASE guards the cast so an unexpected value can
  // never make the whole feed fail. Every join is also scoped to the organization.
  const rows = await db.query<{ id: string; sort_key: string }>(
    `SELECT a.id, a.entity_type, a.entity_id, a.action, a.created_at, a.created_at::text AS sort_key,
            a.user_id, u.name AS user_name,
            COALESCE(t.title, ct.title, pr.name, a.metadata->>'title', a.metadata->>'name') AS entity_name,
            COALESCE(t.id, ct.id) AS task_id,
            ${ENTRY_PROJECT} AS project_id,
            CASE WHEN a.action = 'updated' AND a.entity_type = 'task' THEN a.metadata ELSE NULL END AS changes
       FROM activity_log a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN tasks t ON a.entity_type = 'task' AND t.id = a.entity_id AND t.org_id = a.org_id
       LEFT JOIN tasks ct ON a.entity_type = 'comment' AND ct.org_id = a.org_id
             AND ct.id = CASE WHEN a.metadata->>'task_id' ~ '${UUID_REGEX}' THEN (a.metadata->>'task_id')::uuid END
       LEFT JOIN projects pr ON a.entity_type = 'project' AND pr.id = a.entity_id AND pr.org_id = a.org_id
      WHERE ${where.sql()}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${where.param(page.limit + 1)}`,
    where.params
  );
  return toPage(rows, page.limit);
}

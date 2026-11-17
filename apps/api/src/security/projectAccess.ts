import type { PoolClient } from 'pg';
import { db } from '../db/client';

/**
 * Who can see a project (docs/projects.md):
 * - a project with visibility 'workspace' (the default): everyone in its organization;
 * - a 'private' project: its members (project_members) and the organization's admins and owners.
 *
 * Seeing a project means seeing everything in it: tasks, comments, attachments, its activity, its
 * live events and notifications about it. What someone may DO inside it still comes from their
 * organization role. Every check here is in addition to the organization scoping, never instead.
 */
export type Visibility = 'workspace' | 'private';
export const VISIBILITIES: readonly Visibility[] = ['workspace', 'private'];

export interface Viewer {
  user_id: string;
  role: string;
}

/** Admins and owners see every project in their organization. */
export const seesAllProjects = (role: string) => role === 'owner' || role === 'admin';

/**
 * SQL condition: the project row `alias` is visible to `viewer`. Uses `param` to bind values (the
 * Conditions helper in query/pagination.ts, or any function returning `$n`). Org scoping is separate.
 */
export function visibleProjectSql(alias: string, viewer: Viewer, param: (value: unknown) => string): string {
  if (seesAllProjects(viewer.role)) return 'TRUE';
  return `(${alias}.visibility = 'workspace' OR EXISTS (
    SELECT 1 FROM project_members pm WHERE pm.project_id = ${alias}.id AND pm.user_id = ${param(viewer.user_id)}))`;
}

/** Same rule for a user identified by a SQL expression (e.g. `u.id`, `u.role`), for other people. */
export function userSeesProjectSql(projectAlias: string, userIdExpr: string, roleExpr: string): string {
  return `(${projectAlias}.visibility = 'workspace' OR ${roleExpr} IN ('owner', 'admin') OR EXISTS (
    SELECT 1 FROM project_members pm WHERE pm.project_id = ${projectAlias}.id AND pm.user_id = ${userIdExpr}))`;
}

/** Whether `viewer` can see project `projectId` of organization `orgId`. */
export async function canSeeProject(viewer: Viewer & { org_id: string }, projectId: string, client?: PoolClient): Promise<boolean> {
  const params: unknown[] = [projectId, viewer.org_id];
  const param = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const sql = `SELECT 1 FROM projects p WHERE p.id = $1 AND p.org_id = $2 AND ${visibleProjectSql('p', viewer, param)}`;
  const rows = client ? (await client.query(sql, params)).rows : await db.query(sql, params);
  return rows.length > 0;
}

/**
 * Whether user `userId` (an active member of `orgId`) can see project `projectId`. Used before giving
 * someone a task in it or mentioning them, so nobody is pointed at something they cannot open.
 */
export async function userCanSeeProject(client: PoolClient, orgId: string, projectId: string, userId: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM users u JOIN projects p ON p.id = $2 AND p.org_id = u.org_id
      WHERE u.id = $3 AND u.org_id = $1 AND u.deactivated_at IS NULL
        AND ${userSeesProjectSql('p', 'u.id', 'u.role')}`,
    [orgId, projectId, userId]
  );
  return res.rows.length > 0;
}

/**
 * The private projects of an organization that user `userId` cannot see, judged by their CURRENT role
 * and memberships (empty for admins and owners). Live connections drop events about these
 * (routes/websocket.ts) and reload the set when access changes.
 */
export async function hiddenProjectIds(orgId: string, userId: string): Promise<Set<string>> {
  const rows = await db.query<{ id: string }>(
    `SELECT p.id FROM projects p
       JOIN users u ON u.id = $2 AND u.org_id = p.org_id
      WHERE p.org_id = $1 AND p.visibility = 'private' AND u.role NOT IN ('owner', 'admin')
        AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id)`,
    [orgId, userId]
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * Unassign tasks of project `projectId` whose assignee can no longer see it (after the project became
 * private or someone was removed from it): an assignee must always be able to open their task.
 * Returns how many tasks were unassigned.
 */
export async function unassignWithoutAccess(client: PoolClient, orgId: string, projectId: string): Promise<number> {
  const res = await client.query(
    `UPDATE tasks t SET assignee_id = NULL, updated_at = NOW()
       FROM projects p, users u
      WHERE t.project_id = $2 AND t.org_id = $1 AND p.id = t.project_id AND u.id = t.assignee_id
        AND NOT ${userSeesProjectSql('p', 'u.id', 'u.role')}`,
    [orgId, projectId]
  );
  return res.rowCount ?? 0;
}

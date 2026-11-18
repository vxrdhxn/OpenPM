import type { PoolClient } from 'pg';
import { db } from '../db/client';
import { seesAllProjects, visibleProjectSql } from '../security/projectAccess';
import { viewerOf, type TenantScope } from './scope';

/** The organization's labels and the task_labels join. Every statement is scoped to `scope.orgId`. */

export interface Label {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export type TaskLabel = Pick<Label, 'id' | 'name' | 'color'>;

const LABEL_COLUMNS = 'id, name, color, created_at';

/** Every label, each with the number of tasks using it in projects the scope's user can see. */
export async function listWithCounts(scope: TenantScope): Promise<(Label & { task_count: number })[]> {
  // $2 is the caller's id; it is referenced either way, because Postgres rejects a bound parameter
  // the query never uses.
  const visible = seesAllProjects(scope.role) ? '$2::uuid IS NOT NULL' : visibleProjectSql('p', viewerOf(scope), () => '$2');
  return db.query(
    `SELECT l.id, l.name, l.color, l.created_at,
            (SELECT count(*)::int FROM task_labels tl
               JOIN tasks t ON t.id = tl.task_id
               JOIN projects p ON p.id = t.project_id
              WHERE tl.label_id = l.id AND tl.org_id = $1 AND ${visible}) AS task_count
       FROM labels l
      WHERE l.org_id = $1
      ORDER BY lower(l.name), l.id`,
    [scope.orgId, scope.userId]
  );
}

/**
 * Lock the organization's row until the transaction ends, so concurrent label creates run one after
 * the other and the per-organization limit holds.
 */
export async function lockOrgForLabelCreate(client: PoolClient, scope: TenantScope): Promise<void> {
  await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [scope.orgId]);
}

export async function count(client: PoolClient, scope: TenantScope): Promise<number> {
  const res = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM labels WHERE org_id = $1', [scope.orgId]);
  return res.rows[0]!.n;
}

/** Throws Postgres 23505 on a duplicate name (unique per organization). */
export async function insert(client: PoolClient, scope: TenantScope, name: string, color: string): Promise<Label> {
  const res = await client.query<Label>(`INSERT INTO labels (org_id, name, color) VALUES ($1, $2, $3) RETURNING ${LABEL_COLUMNS}`, [
    scope.orgId,
    name,
    color,
  ]);
  return res.rows[0]!;
}

/** Null if the label is not in the organization. Throws 23505 on a duplicate name. */
export async function update(client: PoolClient, scope: TenantScope, id: string, changes: { name?: string; color?: string }): Promise<Label | null> {
  const res = await client.query<Label>(
    `UPDATE labels SET name = COALESCE($1, name), color = COALESCE($2, color)
      WHERE id = $3 AND org_id = $4 RETURNING ${LABEL_COLUMNS}`,
    [changes.name ?? null, changes.color ?? null, id, scope.orgId]
  );
  return res.rows[0] ?? null;
}

/** Null if the label is not in the organization. Its task_labels rows go by cascade. */
export async function remove(client: PoolClient, scope: TenantScope, id: string): Promise<{ name: string } | null> {
  const res = await client.query<{ name: string }>('DELETE FROM labels WHERE id = $1 AND org_id = $2 RETURNING name', [id, scope.orgId]);
  return res.rows[0] ?? null;
}

/** Projects whose boards show this label (their cached boards must be dropped when it changes). */
export async function projectsUsing(client: PoolClient, scope: TenantScope, labelId: string): Promise<string[]> {
  const res = await client.query<{ project_id: string }>(
    `SELECT DISTINCT t.project_id
       FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
      WHERE tl.label_id = $1 AND tl.org_id = $2`,
    [labelId, scope.orgId]
  );
  return res.rows.map((r) => r.project_id);
}

/** How many of `ids` are labels of the organization. */
export async function countKnown(client: PoolClient, scope: TenantScope, ids: string[]): Promise<number> {
  const res = await client.query('SELECT id FROM labels WHERE org_id = $1 AND id = ANY($2::uuid[])', [scope.orgId, ids]);
  return res.rows.length;
}

/** Lock a task (so concurrent label edits apply one after the other); false if it is not in this project of the org. */
export async function lockTask(client: PoolClient, scope: TenantScope, projectId: string, taskId: string): Promise<boolean> {
  const res = await client.query('SELECT id FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3 FOR UPDATE', [
    taskId,
    projectId,
    scope.orgId,
  ]);
  return res.rows.length > 0;
}

export async function labelIdsOfTask(client: PoolClient, scope: TenantScope, taskId: string): Promise<string[]> {
  const res = await client.query<{ label_id: string }>('SELECT label_id FROM task_labels WHERE task_id = $1 AND org_id = $2', [
    taskId,
    scope.orgId,
  ]);
  return res.rows.map((r) => r.label_id);
}

export async function detach(client: PoolClient, scope: TenantScope, taskId: string, labelIds: string[]): Promise<void> {
  await client.query('DELETE FROM task_labels WHERE task_id = $1 AND org_id = $2 AND label_id = ANY($3::uuid[])', [
    taskId,
    scope.orgId,
    labelIds,
  ]);
}

export async function attach(client: PoolClient, scope: TenantScope, taskId: string, labelIds: string[]): Promise<void> {
  await client.query('INSERT INTO task_labels (task_id, label_id, org_id) SELECT $1, unnest($2::uuid[]), $3', [taskId, labelIds, scope.orgId]);
}

export async function touchTask(client: PoolClient, scope: TenantScope, taskId: string): Promise<void> {
  await client.query('UPDATE tasks SET updated_at = NOW() WHERE id = $1 AND org_id = $2', [taskId, scope.orgId]);
}

export async function labelsOfTask(client: PoolClient, scope: TenantScope, taskId: string): Promise<TaskLabel[]> {
  const res = await client.query<TaskLabel>(
    `SELECT l.id, l.name, l.color FROM task_labels tl JOIN labels l ON l.id = tl.label_id
      WHERE tl.task_id = $1 AND tl.org_id = $2 ORDER BY lower(l.name), l.id`,
    [taskId, scope.orgId]
  );
  return res.rows;
}

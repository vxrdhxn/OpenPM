import type { PoolClient } from 'pg';
import { db } from '../db/client';
import { BadRequestError } from '../domain/errors';
import { Conditions } from '../query/pagination';
import { applyTaskFilters, type TaskFilters } from '../query/taskFilters';
import type { TenantScope } from './scope';

/**
 * Tasks table access. Every statement is scoped to `scope.orgId` and to the task's project, so a task
 * id from another project or organization matches nothing. Callers pass a transaction client for writes.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskRow {
  id: string;
  org_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Bumped by every update; a PATCH may name the version it was based on (docs/concurrency.md). */
  version: number;
}

export interface NewTaskFields {
  title: string;
  description?: string;
  priority: TaskPriority;
  assignee_id?: string;
  due_date?: string;
}

/**
 * Columns a client may change via PATCH. Everything else (org_id, project_id, created_by, id, ...) is
 * server-controlled. Defense in depth: only these names ever become SQL identifiers, even if the
 * route's JSON Schema is loosened later.
 */
const UPDATABLE_COLUMNS = new Set(['title', 'description', 'status', 'priority', 'assignee_id', 'due_date']);

export type TaskChanges = Partial<Pick<TaskRow, 'title' | 'description' | 'status' | 'priority' | 'assignee_id' | 'due_date'>>;

/** A task's place in the URL (`/projects/:projectId/tasks/:taskId/...`), as its sub-resources receive it. */
export interface TaskPath {
  projectId: string;
  taskId: string;
}

/** What other features need of a task: it must be in this project, and both in the organization. */
export type TaskRef = Pick<TaskRow, 'id' | 'title' | 'assignee_id' | 'created_by'>;

/** The task if it is in this project of the organization, else null; inside a transaction, pass its client. */
export async function findInProject(scope: TenantScope, projectId: string, taskId: string, client?: PoolClient): Promise<TaskRef | null> {
  const sql = 'SELECT id, title, assignee_id, created_by FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3';
  const params = [taskId, projectId, scope.orgId];
  const rows = client ? (await client.query<TaskRef>(sql, params)).rows : await db.query<TaskRef>(sql, params);
  return rows[0] ?? null;
}

export async function insert(client: PoolClient, scope: TenantScope, projectId: string, task: NewTaskFields): Promise<TaskRow> {
  const res = await client.query<TaskRow>(
    `INSERT INTO tasks (org_id, project_id, title, description, priority, assignee_id, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [scope.orgId, projectId, task.title, task.description, task.priority, task.assignee_id, task.due_date, scope.userId]
  );
  return res.rows[0]!;
}

/**
 * Lock a task for the rest of the transaction and return it as it is before the update; null if it is
 * not in this project of the organization. The lock makes concurrent edits queue, so each one sees the
 * status and version the previous one left (the activity feed, notifications and the version check
 * stay right).
 */
export async function lockForUpdate(
  client: PoolClient,
  scope: TenantScope,
  projectId: string,
  taskId: string
): Promise<TaskRow | null> {
  const res = await client.query<TaskRow>(
    'SELECT * FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3 FOR UPDATE',
    [taskId, projectId, scope.orgId]
  );
  return res.rows[0] ?? null;
}

export async function update(
  client: PoolClient,
  scope: TenantScope,
  projectId: string,
  taskId: string,
  changes: TaskChanges
): Promise<TaskRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of Object.entries(changes)) {
    if (!UPDATABLE_COLUMNS.has(column)) throw new BadRequestError('Unsupported task field');
    values.push(value);
    setClauses.push(`${column} = $${values.length}`);
  }
  if (setClauses.length === 0) throw new BadRequestError('No fields to update');
  setClauses.push('updated_at = NOW()', 'version = version + 1');
  values.push(taskId, projectId, scope.orgId);
  const n = values.length;

  const res = await client.query<TaskRow>(
    `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${n - 2} AND project_id = $${n - 1} AND org_id = $${n} RETURNING *`,
    values
  );
  return res.rows[0] ?? null;
}

/** Delete the task's attachment rows and return their storage keys (see data/projects.deleteAttachments). */
export async function deleteAttachments(client: PoolClient, scope: TenantScope, taskId: string): Promise<string[]> {
  const res = await client.query<{ storage_key: string }>(
    'DELETE FROM task_attachments WHERE task_id = $1 AND org_id = $2 RETURNING storage_key',
    [taskId, scope.orgId]
  );
  return res.rows.map((r) => r.storage_key);
}

export async function remove(
  client: PoolClient,
  scope: TenantScope,
  projectId: string,
  taskId: string
): Promise<Pick<TaskRow, 'id' | 'title'> | null> {
  const res = await client.query<Pick<TaskRow, 'id' | 'title'>>(
    'DELETE FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3 RETURNING id, title',
    [taskId, projectId, scope.orgId]
  );
  return res.rows[0] ?? null;
}

export type BoardRow = TaskRow & { assignee_name: string | null; sort_key: string };

/**
 * The first `perColumn` tasks (oldest first) of each status in `columns`, plus the number of matching
 * tasks per status. One bounded index range scan per column (idx_tasks_project_status_created).
 */
export async function boardColumns(
  scope: TenantScope,
  projectId: string,
  filters: TaskFilters,
  columns: readonly string[],
  perColumn: number
): Promise<{ rows: BoardRow[]; counts: { status: string; n: number }[] }> {
  const where = new Conditions()
    .add((p) => `t.project_id = ${p(projectId)}`)
    .add((p) => `t.org_id = ${p(scope.orgId)}`);
  applyTaskFilters(where, filters, scope.userId);
  const filterParams = [...where.params];

  const columnParam = where.param(columns);
  const limitParam = where.param(perColumn);
  const [rows, counts] = await Promise.all([
    db.query<BoardRow>(
      `SELECT t.*, u.name AS assignee_name, t.created_at::text AS sort_key
         FROM unnest(${columnParam}::text[]) AS col(status)
         CROSS JOIN LATERAL (
           SELECT t.* FROM tasks t
            WHERE ${where.sql()} AND t.status = col.status
            ORDER BY t.created_at ASC, t.id ASC
            LIMIT ${limitParam}
         ) t
         LEFT JOIN users u ON u.id = t.assignee_id`,
      where.params
    ),
    db.query<{ status: string; n: number }>(
      `SELECT t.status, count(*)::int AS n FROM tasks t WHERE ${where.sql()} GROUP BY t.status`,
      filterParams
    ),
  ]);
  return { rows, counts };
}

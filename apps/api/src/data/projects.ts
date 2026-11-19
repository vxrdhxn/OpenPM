import type { PoolClient } from 'pg';
import { db } from '../db/client';
import { BadRequestError } from '../domain/errors';
import { Conditions, decodeCursor, likePattern, toPage, type Page } from '../query/pagination';
import { visibleProjectSql, type Visibility } from '../security/projectAccess';
import { viewerOf, type TenantScope } from './scope';

/**
 * Projects table access. Every statement is scoped to `scope.orgId`; reads that list projects also
 * apply private-project visibility for the scope's user. Callers pass a transaction client for writes.
 */

export type ProjectStatus = 'active' | 'archived';

export interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  visibility: Visibility;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ProjectListItem = Pick<ProjectRow, 'id' | 'name' | 'description' | 'status' | 'visibility' | 'created_at'>;

export interface ProjectListFilter {
  limit: number;
  cursor?: string;
  q?: string;
  status?: ProjectStatus;
}

/** The fields a PATCH may change, and the column each one maps to (only these become SQL). */
const COLUMN_BY_FIELD = {
  name: 'name',
  description: 'description',
  status: 'status',
  visibility: 'visibility',
} as const;

export type ProjectChanges = Partial<Record<keyof typeof COLUMN_BY_FIELD, string>>;

/** Projects the scope's user can see, newest first, one page at a time. */
export async function listVisible(scope: TenantScope, filter: ProjectListFilter): Promise<Page<ProjectListItem>> {
  const where = new Conditions()
    .add((p) => `p.org_id = ${p(scope.orgId)}`)
    .add((p) => visibleProjectSql('p', viewerOf(scope), p));
  if (filter.status) where.add((p) => `p.status = ${p(filter.status)}`);
  if (filter.q) where.add((p) => `p.name ILIKE ${p(likePattern(filter.q!))} ESCAPE '\\'`);
  if (filter.cursor) {
    const after = decodeCursor(filter.cursor);
    where.add((p) => `(p.created_at, p.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
  }

  const rows = await db.query<ProjectListItem & { sort_key: string }>(
    `SELECT p.id, p.name, p.description, p.status, p.visibility, p.created_at, p.created_at::text AS sort_key
       FROM projects p
      WHERE ${where.sql()}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${where.param(filter.limit + 1)}`,
    where.params
  );
  return toPage(rows, filter.limit);
}

/**
 * One project of the organization, or null. Private-project visibility is not checked here: the
 * project gate in app.ts has already answered 404 to anyone who cannot see it.
 */
export async function findById(scope: TenantScope, id: string): Promise<ProjectRow | null> {
  const rows = await db.query<ProjectRow>('SELECT * FROM projects WHERE id = $1 AND org_id = $2', [id, scope.orgId]);
  return rows[0] ?? null;
}

/** Whether the project is in the organization; inside a transaction, pass its client. */
/** The project's name, for notifications; null if it is not in the organization. */
export async function nameOf(client: PoolClient, scope: TenantScope, id: string): Promise<string | null> {
  const res = await client.query<{ name: string }>('SELECT name FROM projects WHERE id = $1 AND org_id = $2', [id, scope.orgId]);
  return res.rows[0]?.name ?? null;
}

export async function existsInOrg(scope: TenantScope, id: string, client?: PoolClient): Promise<boolean> {
  const sql = 'SELECT id FROM projects WHERE id = $1 AND org_id = $2';
  const rows = client ? (await client.query(sql, [id, scope.orgId])).rows : await db.query(sql, [id, scope.orgId]);
  return rows.length > 0;
}

/** Lock a project row for the rest of the transaction; null if it is not in the organization. */
export async function lockForUpdate(
  client: PoolClient,
  scope: TenantScope,
  id: string
): Promise<Pick<ProjectRow, 'id' | 'visibility' | 'created_by'> | null> {
  const res = await client.query<Pick<ProjectRow, 'id' | 'visibility' | 'created_by'>>(
    'SELECT id, visibility, created_by FROM projects WHERE id = $1 AND org_id = $2 FOR UPDATE',
    [id, scope.orgId]
  );
  return res.rows[0] ?? null;
}

export async function insert(
  client: PoolClient,
  scope: TenantScope,
  project: { name: string; description?: string; visibility: Visibility }
): Promise<ProjectRow> {
  const res = await client.query<ProjectRow>(
    'INSERT INTO projects (org_id, name, description, created_by, visibility) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [scope.orgId, project.name, project.description, scope.userId, project.visibility]
  );
  return res.rows[0]!;
}

/** Apply `changes` (already validated) and bump updated_at; null if the project is not in the organization. */
export async function update(client: PoolClient, scope: TenantScope, id: string, changes: ProjectChanges): Promise<ProjectRow | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [field, value] of Object.entries(changes)) {
    const column = COLUMN_BY_FIELD[field as keyof typeof COLUMN_BY_FIELD];
    if (!column) throw new BadRequestError(`Unsupported project field: ${field}`);
    values.push(value);
    setClauses.push(`${column} = $${values.length}`);
  }
  values.push(id, scope.orgId);

  const res = await client.query<ProjectRow>(
    `UPDATE projects
        SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length - 1}
        AND org_id = $${values.length}
      RETURNING *`,
    values
  );
  return res.rows[0] ?? null;
}

/** Add a user to the project's members (no-op if they already are). */
export async function addMember(client: PoolClient, scope: TenantScope, projectId: string, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO project_members (project_id, user_id, org_id, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, user_id) DO NOTHING`,
    [projectId, userId, scope.orgId, scope.userId]
  );
}

/**
 * Delete the attachment rows of every task in the project and return their storage keys, so the
 * files can be removed once the transaction commits (the rows would otherwise go by ON DELETE CASCADE
 * without telling us which files they pointed at).
 */
export async function deleteAttachments(client: PoolClient, scope: TenantScope, projectId: string): Promise<string[]> {
  const res = await client.query<{ storage_key: string }>(
    `DELETE FROM task_attachments a
      USING tasks t
      WHERE a.task_id = t.id AND t.project_id = $1 AND a.org_id = $2
      RETURNING a.storage_key`,
    [projectId, scope.orgId]
  );
  return res.rows.map((r) => r.storage_key);
}

/** Delete the project (its tasks go by cascade); null if it is not in the organization. */
export async function remove(client: PoolClient, scope: TenantScope, id: string): Promise<Pick<ProjectRow, 'id' | 'name'> | null> {
  const res = await client.query<Pick<ProjectRow, 'id' | 'name'>>(
    'DELETE FROM projects WHERE id = $1 AND org_id = $2 RETURNING id, name',
    [id, scope.orgId]
  );
  return res.rows[0] ?? null;
}

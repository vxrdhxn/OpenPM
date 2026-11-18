import type { PoolClient } from 'pg';
import { db } from '../db/client';
import { Conditions, decodeCursor, toPage, type Page } from '../query/pagination';
import { userSeesProjectSql } from '../security/projectAccess';
import type { TenantScope } from './scope';

/**
 * Task comments and their mentions. Every statement is scoped to `scope.orgId` (comment_mentions has
 * no org column, so it is only reached through a comment id already checked against the org).
 */

/** Every comment response has this shape (author name joined in, removed authors flagged). */
export interface Comment {
  id: string;
  task_id: string;
  body: string;
  author_id: string;
  author_name: string;
  author_removed: boolean;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  mentions: { id: string; name: string }[];
}

const commentSelect = (extraColumns = '') => `
  SELECT c.id, c.task_id, c.body, c.author_id, u.name AS author_name,
         (u.deactivated_at IS NOT NULL) AS author_removed,
         c.created_at, c.updated_at, c.edited_at,
         COALESCE((
           SELECT json_agg(json_build_object('id', mu.id, 'name', mu.name) ORDER BY mu.name, mu.id)
             FROM comment_mentions cm JOIN users mu ON mu.id = cm.user_id
            WHERE cm.comment_id = c.id
         ), '[]'::json) AS mentions${extraColumns}
    FROM task_comments c
    JOIN users u ON u.id = c.author_id`;

/** A task's comments, newest first, one page at a time. */
export async function listForTask(scope: TenantScope, taskId: string, limit: number, cursor?: string): Promise<Page<Comment>> {
  const where = new Conditions()
    .add((p) => `c.task_id = ${p(taskId)}`)
    .add((p) => `c.org_id = ${p(scope.orgId)}`);
  if (cursor) {
    const after = decodeCursor(cursor);
    where.add((p) => `(c.created_at, c.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
  }

  const rows = await db.query<Comment & { sort_key: string }>(
    `${commentSelect(', c.created_at::text AS sort_key')}
      WHERE ${where.sql()}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${where.param(limit + 1)}`,
    where.params
  );
  return toPage(rows, limit);
}

export async function find(client: PoolClient, scope: TenantScope, taskId: string, commentId: string): Promise<Comment | null> {
  const res = await client.query<Comment>(`${commentSelect()} WHERE c.id = $1 AND c.task_id = $2 AND c.org_id = $3`, [
    commentId,
    taskId,
    scope.orgId,
  ]);
  return res.rows[0] ?? null;
}

export async function insert(client: PoolClient, scope: TenantScope, taskId: string, body: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'INSERT INTO task_comments (org_id, task_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id',
    [scope.orgId, taskId, scope.userId, body]
  );
  return res.rows[0]!.id;
}

export async function updateBody(client: PoolClient, scope: TenantScope, commentId: string, body: string): Promise<void> {
  await client.query('UPDATE task_comments SET body = $1, edited_at = NOW(), updated_at = NOW() WHERE id = $2 AND org_id = $3', [
    body,
    commentId,
    scope.orgId,
  ]);
}

export async function remove(client: PoolClient, scope: TenantScope, commentId: string): Promise<void> {
  await client.query('DELETE FROM task_comments WHERE id = $1 AND org_id = $2', [commentId, scope.orgId]);
}

/** How many of `ids` are active members of the organization who can see the project. */
export async function countMentionable(client: PoolClient, scope: TenantScope, projectId: string, ids: string[]): Promise<number> {
  const res = await client.query(
    `SELECT u.id FROM users u JOIN projects p ON p.id = $3 AND p.org_id = u.org_id
      WHERE u.org_id = $1 AND u.id = ANY($2::uuid[]) AND u.deactivated_at IS NULL
        AND ${userSeesProjectSql('p', 'u.id', 'u.role')}`,
    [scope.orgId, ids, projectId]
  );
  return res.rows.length;
}

/**
 * Replace a comment's mentions; returns the ids that were not mentioned before. The comment must
 * already have been checked against the organization (find/insert above).
 */
export async function replaceMentions(client: PoolClient, commentId: string, ids: string[]): Promise<string[]> {
  const before = await client.query<{ user_id: string }>('DELETE FROM comment_mentions WHERE comment_id = $1 RETURNING user_id', [
    commentId,
  ]);
  if (ids.length) {
    await client.query('INSERT INTO comment_mentions (comment_id, user_id) SELECT $1, unnest($2::uuid[])', [commentId, ids]);
  }
  const had = new Set(before.rows.map((r) => r.user_id));
  return ids.filter((id) => !had.has(id));
}

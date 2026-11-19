import type { PoolClient } from 'pg';
import { db } from '../db/client';
import type { TenantScope } from './scope';

/**
 * Task attachment metadata. Every statement is scoped to `scope.orgId`, and lookups also to the task
 * and its project, so an id from another tenant (or another task) is indistinguishable from a missing one.
 */

/** What clients see. The storage key is an internal detail and is never returned. */
const PUBLIC_COLUMNS = 'id, task_id, filename, content_type, size_bytes, status, uploaded_by, created_at, completed_at';

export interface AttachmentRow {
  id: string;
  task_id: string;
  filename: string;
  content_type: string;
  size_bytes: string | number; // BIGINT arrives as a string from pg
  storage_key: string;
  status: 'pending' | 'ready';
  uploaded_by: string;
}

export type PublicAttachment = Omit<AttachmentRow, 'storage_key'> & { created_at: string; completed_at: string | null };

/** Whether the task is in this project of the organization. */
export async function taskExists(scope: TenantScope, projectId: string, taskId: string): Promise<boolean> {
  const rows = await db.query('SELECT id FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3', [taskId, projectId, scope.orgId]);
  return rows.length > 0;
}

export async function find(scope: TenantScope, projectId: string, taskId: string, attachmentId: string): Promise<AttachmentRow | null> {
  const rows = await db.query<AttachmentRow>(
    `SELECT a.id, a.task_id, a.filename, a.content_type, a.size_bytes, a.storage_key, a.status, a.uploaded_by
       FROM task_attachments a
       JOIN tasks t ON t.id = a.task_id
      WHERE a.id = $1 AND a.task_id = $2 AND t.project_id = $3 AND a.org_id = $4 AND t.org_id = $4`,
    [attachmentId, taskId, projectId, scope.orgId]
  );
  return rows[0] ?? null;
}

export async function findPublic(scope: TenantScope, attachmentId: string): Promise<PublicAttachment | null> {
  const rows = await db.query<PublicAttachment>(`SELECT ${PUBLIC_COLUMNS} FROM task_attachments WHERE id = $1 AND org_id = $2`, [
    attachmentId,
    scope.orgId,
  ]);
  return rows[0] ?? null;
}

/** Number of attachments (pending included) on a task. */
export async function countForTask(scope: TenantScope, taskId: string): Promise<number> {
  const rows = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM task_attachments WHERE task_id = $1 AND org_id = $2', [
    taskId,
    scope.orgId,
  ]);
  return Number(rows[0]?.count ?? 0);
}

export async function insertPending(
  scope: TenantScope,
  taskId: string,
  file: { filename: string; contentType: string; size: number; storageKey: string }
): Promise<PublicAttachment> {
  const rows = await db.query<PublicAttachment>(
    `INSERT INTO task_attachments (org_id, task_id, uploaded_by, filename, content_type, size_bytes, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${PUBLIC_COLUMNS}`,
    [scope.orgId, taskId, scope.userId, file.filename, file.contentType, file.size, file.storageKey]
  );
  return rows[0]!;
}

export async function markReady(scope: TenantScope, attachmentId: string): Promise<PublicAttachment | null> {
  const rows = await db.query<PublicAttachment>(
    `UPDATE task_attachments SET status = 'ready', completed_at = NOW()
      WHERE id = $1 AND org_id = $2 RETURNING ${PUBLIC_COLUMNS}`,
    [attachmentId, scope.orgId]
  );
  return rows[0] ?? null;
}

/** A task's verified attachments, oldest first. */
export async function listReady(scope: TenantScope, taskId: string): Promise<PublicAttachment[]> {
  return db.query<PublicAttachment>(
    `SELECT ${PUBLIC_COLUMNS} FROM task_attachments
      WHERE task_id = $1 AND org_id = $2 AND status = 'ready' ORDER BY created_at ASC`,
    [taskId, scope.orgId]
  );
}

/** Delete the row inside the caller's transaction (which owes its object, data/storageDeletions.ts). */
export async function removeIn(client: PoolClient, scope: TenantScope, attachmentId: string): Promise<void> {
  await client.query('DELETE FROM task_attachments WHERE id = $1 AND org_id = $2', [attachmentId, scope.orgId]);
}

/** Activity entries for attachment changes are recorded against the task (outside any transaction). */
export async function logTaskActivity(scope: TenantScope, taskId: string, action: string, metadata: object): Promise<void> {
  await db.query('INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)', [
    scope.orgId,
    scope.userId,
    'task',
    taskId,
    action,
    JSON.stringify(metadata),
  ]);
}

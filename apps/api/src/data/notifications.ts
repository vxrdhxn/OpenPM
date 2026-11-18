import { db } from '../db/client';
import { visibleProjectSql } from '../security/projectAccess';
import { Conditions, decodeCursor, toPage, type Page } from '../query/pagination';
import { viewerOf, type TenantScope } from './scope';

/**
 * The scope user's own notifications. Every statement is scoped to the user id AND the organization,
 * so nobody can read or mark anyone else's. (Creating them is notifications/notify.ts.)
 */

/** A notification is shown while its project (if any) is visible to the user. */
function visibleNotification(scope: TenantScope, p: (v: unknown) => string): string {
  const rule = visibleProjectSql('np', viewerOf(scope), p);
  if (rule === 'TRUE') return 'TRUE';
  return `(n.project_id IS NULL OR EXISTS (SELECT 1 FROM projects np WHERE np.id = n.project_id AND ${rule}))`;
}

/** Newest first, paginated; `unread` for unread only. */
export async function list(scope: TenantScope, page: { limit: number; cursor?: string; unread?: boolean }): Promise<Page<unknown>> {
  const where = new Conditions()
    .add((p) => `n.user_id = ${p(scope.userId)}`)
    .add((p) => `n.org_id = ${p(scope.orgId)}`)
    .add((p) => visibleNotification(scope, p));
  if (page.unread) where.add(() => 'n.read_at IS NULL');
  if (page.cursor) {
    const after = decodeCursor(page.cursor);
    where.add((p) => `(n.created_at, n.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
  }

  const rows = await db.query<{ id: string; sort_key: string }>(
    `SELECT n.id, n.type, n.project_id, n.task_id, n.comment_id, n.data, n.read_at, n.created_at,
            n.actor_id, a.name AS actor_name, t.title AS task_title,
            n.created_at::text AS sort_key
       FROM notifications n
       LEFT JOIN users a ON a.id = n.actor_id
       LEFT JOIN tasks t ON t.id = n.task_id AND t.org_id = n.org_id
      WHERE ${where.sql()}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ${where.param(page.limit + 1)}`,
    where.params
  );
  return toPage(rows, page.limit);
}

export async function unreadCount(scope: TenantScope): Promise<number> {
  const where = new Conditions()
    .add((p) => `n.user_id = ${p(scope.userId)}`)
    .add((p) => `n.org_id = ${p(scope.orgId)}`)
    .add(() => 'n.read_at IS NULL')
    .add((p) => visibleNotification(scope, p));
  const [row] = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM notifications n WHERE ${where.sql()}`, where.params);
  return row?.count ?? 0;
}

/** Mark one read (idempotent); false if the user has no such notification. */
export async function markRead(scope: TenantScope, id: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
      WHERE id = $1 AND user_id = $2 AND org_id = $3 RETURNING id`,
    [id, scope.userId, scope.orgId]
  );
  return rows.length > 0;
}

/** Mark everything read; returns how many changed. */
export async function markAllRead(scope: TenantScope): Promise<number> {
  const rows = await db.query('UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND org_id = $2 AND read_at IS NULL RETURNING id', [
    scope.userId,
    scope.orgId,
  ]);
  return rows.length;
}

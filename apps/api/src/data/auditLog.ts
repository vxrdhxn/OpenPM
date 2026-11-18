import { db } from '../db/client';
import { Conditions, decodeCursor, toPage, type Page } from '../query/pagination';
import type { TenantScope } from './scope';

/**
 * Reading the organization's security audit log, newest first (docs/audit-log.md). Writing it is
 * security/audit.ts; no code edits or deletes entries except the retention sweep.
 */
export async function list(
  scope: TenantScope,
  page: { limit: number; cursor?: string; action?: string; userId?: string }
): Promise<Page<unknown>> {
  const where = new Conditions().add((p) => `a.org_id = ${p(scope.orgId)}`);
  if (page.action) where.add((p) => `a.action = ${p(page.action)}`);
  // Entries by this person, or about them (sign-in failures, role changes, removal).
  if (page.userId) where.add((p) => `(a.actor_id = ${p(page.userId)} OR (a.target_type = 'user' AND a.target_id = ${p(page.userId)}))`);
  if (page.cursor) {
    const after = decodeCursor(page.cursor);
    where.add((p) => `(a.created_at, a.id) < (${p(after.key)}::timestamptz, ${p(after.id)}::uuid)`);
  }

  // Names come from the live rows when they still exist (scoped to the organization), else from what
  // the entry recorded.
  const rows = await db.query<{ id: string; sort_key: string }>(
    `SELECT a.id, a.action, a.created_at, a.created_at::text AS sort_key,
            a.actor_id, actor.name AS actor_name, actor.email AS actor_email,
            a.target_type, a.target_id,
            COALESCE(tu.name, tp.name, a.metadata->>'name', a.metadata->>'email') AS target_name,
            a.ip, a.user_agent, a.request_id, a.metadata
       FROM audit_log a
       LEFT JOIN users actor ON actor.id = a.actor_id AND actor.org_id = a.org_id
       LEFT JOIN users tu ON a.target_type = 'user' AND tu.id = a.target_id AND tu.org_id = a.org_id
       LEFT JOIN projects tp ON a.target_type = 'project' AND tp.id = a.target_id AND tp.org_id = a.org_id
      WHERE ${where.sql()}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${where.param(page.limit + 1)}`,
    where.params
  );
  return toPage(rows, page.limit);
}

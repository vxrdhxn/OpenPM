import { pool } from '../lib/db';
import { publish } from '../lib/publish';
import { logger, Logger } from '../lib/logger';

/** How far ahead a due date earns a reminder. */
export const REMINDER_WINDOW_HOURS = 24;

/**
 * Remind assignees of open tasks due within the next 24 hours (docs/notifications.md). Runs on a
 * schedule (index.ts), not per request.
 *
 * One statement claims the tasks and writes the notifications: `due_reminder_sent_for` is set to the
 * due date being reminded about, so each due date is reminded once even if sweeps overlap (the row
 * lock makes a second sweep re-check the condition and skip it), and a moved due date is reminded
 * again. Only active members who can still see the project are notified, as for every notification.
 */
export const DUE_REMINDER_SQL = `
  WITH due AS (
    UPDATE tasks t
       SET due_reminder_sent_for = t.due_date
      FROM users u, projects p
     WHERE u.id = t.assignee_id AND u.org_id = t.org_id AND u.deactivated_at IS NULL
       AND p.id = t.project_id AND p.org_id = t.org_id
       AND (p.visibility = 'workspace' OR u.role IN ('owner', 'admin')
            OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = u.id))
       AND t.status <> 'done'
       AND t.due_date > NOW() AND t.due_date <= NOW() + make_interval(hours => $1)
       AND t.due_reminder_sent_for IS DISTINCT FROM t.due_date
    RETURNING t.id, t.org_id, t.project_id, t.assignee_id, t.title, t.due_date
  )
  INSERT INTO notifications (org_id, user_id, actor_id, type, project_id, task_id, data)
  SELECT org_id, assignee_id, NULL, 'due_soon', project_id, id, jsonb_build_object('title', title, 'due_date', due_date)
    FROM due
  RETURNING org_id, user_id`;

export default async function processDueReminders(log: Logger = logger): Promise<number> {
  const { rows } = await pool.query<{ org_id: string; user_id: string }>(DUE_REMINDER_SQL, [REMINDER_WINDOW_HOURS]);

  // Tell connected clients, per organization, in the API's event shape (notifications/notify.ts:
  // recipient ids only, never content). Best effort: the notifications are already stored.
  const byOrg = new Map<string, Set<string>>();
  for (const { org_id, user_id } of rows) {
    const users = byOrg.get(org_id) ?? new Set<string>();
    users.add(user_id);
    byOrg.set(org_id, users);
  }
  for (const [orgId, users] of byOrg) {
    await publish(`org:${orgId}:updates`, { type: 'notification', user_ids: [...users] }, log);
  }

  log.info({ reminders: rows.length, orgs: byOrg.size }, 'Due-date reminders sent');
  return rows.length;
}

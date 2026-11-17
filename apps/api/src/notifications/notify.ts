import type { PoolClient } from 'pg';
import { cache } from '../cache/redis';
import { userSeesProjectSql } from '../security/projectAccess';

export type NotificationType = 'task_assigned' | 'mentioned' | 'commented' | 'status_changed';

export interface NotificationInput {
  orgId: string;
  /** Who caused it. Never notified about their own action. */
  actorId: string;
  type: NotificationType;
  recipients: Array<string | null | undefined>;
  projectId?: string;
  taskId?: string;
  commentId?: string;
  /** Rendering hints (task title, comment excerpt, new status). Keep it small; no secrets. */
  data?: Record<string, unknown>;
}

/** Longest comment excerpt stored on a notification. */
export const EXCERPT_LENGTH = 140;

export const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
};

/**
 * Create notifications inside the caller's transaction. Recipients are de-duplicated, the actor is
 * dropped, and only active members of the organization who can see the project are kept (the
 * INSERT ... SELECT checks it, so an id from another organization, a removed member or someone outside
 * a private project is silently skipped). Returns who was notified;
 * pass that to `announce` after the transaction commits.
 */
export async function notify(client: PoolClient, input: NotificationInput): Promise<string[]> {
  const ids = [...new Set(input.recipients.filter((id): id is string => Boolean(id) && id !== input.actorId))];
  if (ids.length === 0) return [];

  const res = await client.query<{ user_id: string }>(
    `INSERT INTO notifications (org_id, user_id, actor_id, type, project_id, task_id, comment_id, data)
     SELECT $1, u.id, $2, $3, $4, $5, $6, $7
       FROM users u
       LEFT JOIN projects p ON p.id = $4::uuid AND p.org_id = u.org_id
      WHERE u.id = ANY($8::uuid[]) AND u.org_id = $1 AND u.deactivated_at IS NULL
        AND ($4::uuid IS NULL OR (p.id IS NOT NULL AND ${userSeesProjectSql('p', 'u.id', 'u.role')}))
     RETURNING user_id`,
    [
      input.orgId,
      input.actorId,
      input.type,
      input.projectId ?? null,
      input.taskId ?? null,
      input.commentId ?? null,
      JSON.stringify(input.data ?? {}),
      ids,
    ]
  );
  return res.rows.map((r) => r.user_id);
}

/**
 * Tell connected clients that these users have something new. The event carries only the recipient
 * ids, never the content: it goes out on the organization channel, and each client fetches its own
 * notifications over HTTP (which only ever returns the caller's). Best effort, like every publish.
 */
export async function announce(orgId: string, userIds: string[]): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await cache.publish(`org:${orgId}:updates`, { type: 'notification', user_ids: unique });
}

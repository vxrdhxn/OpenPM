import { api } from './api';
import { buildQuery, type Page } from './query';

export type NotificationType = 'task_assigned' | 'mentioned' | 'commented' | 'status_changed';

export interface AppNotification {
  id: string;
  type: NotificationType | string;
  project_id: string | null;
  task_id: string | null;
  comment_id: string | null;
  data: { title?: string; excerpt?: string; from?: string; to?: string };
  read_at: string | null;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  task_title: string | null;
}

export const listNotifications = (opts: { unread?: boolean; cursor?: string | null } = {}): Promise<Page<AppNotification>> =>
  api.get(`/notifications${buildQuery({ unread: opts.unread ? 'true' : undefined, cursor: opts.cursor, limit: 30 })}`);
export const unreadCount = (): Promise<{ count: number }> => api.get('/notifications/unread-count');
export const markRead = (id: string): Promise<void> => api.post(`/notifications/${id}/read`, {});
export const markAllRead = (): Promise<{ marked: number }> => api.post('/notifications/read-all', {});

const STATUS_NAMES: Record<string, string> = { todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' };

/** One line for a notification: "Ada assigned you Fix login". The title is plain text. */
export function describeNotification(n: Pick<AppNotification, 'type' | 'actor_name' | 'task_title' | 'data'>): string {
  const who = n.actor_name ?? 'Someone';
  const what = n.task_title ?? n.data.title ?? 'a task';
  switch (n.type) {
    case 'task_assigned':
      return `${who} assigned you ${what}`;
    case 'mentioned':
      return `${who} mentioned you on ${what}`;
    case 'commented':
      return `${who} commented on ${what}`;
    case 'status_changed':
      return `${who} moved ${what} to ${STATUS_NAMES[n.data.to ?? ''] ?? n.data.to ?? 'a new status'}`;
    default:
      return `${who} updated ${what}`;
  }
}

/** Whether a live `notification` event is for this user (the event carries only recipient ids). */
export const isForMe = (message: { type?: string; user_ids?: unknown } | null, userId: string | undefined) =>
  Boolean(message && message.type === 'notification' && userId && Array.isArray(message.user_ids) && message.user_ids.includes(userId));

/** Badge text: nothing at 0, and 99+ past 99. */
export const badgeText = (count: number) => (count <= 0 ? '' : count > 99 ? '99+' : String(count));

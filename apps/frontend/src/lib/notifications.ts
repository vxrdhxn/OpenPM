import { api } from './api';
import { buildQuery, type Page } from './query';
import { statusLabel } from './tasks';

import type { NotificationType } from '@openpm/wire';
export type { NotificationType };

export interface AppNotification {
  id: string;
  type: NotificationType | string;
  project_id: string | null;
  task_id: string | null;
  comment_id: string | null;
  data: { title?: string; excerpt?: string; from?: string; to?: string; due_date?: string; project_name?: string | null };
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

/** Which types the user switched off (docs/notifications.md). */
export interface NotificationPreferences {
  types: string[];
  muted: string[];
}
export const getPreferences = (): Promise<NotificationPreferences> => api.get('/notifications/preferences');
export const savePreferences = (muted: string[]): Promise<NotificationPreferences> => api.put('/notifications/preferences', { muted });

/** What each type is, as a "Notify me when…" line on the preferences page. */
export const TYPE_LABELS: Record<NotificationType, string> = {
  task_assigned: 'someone assigns me a task',
  mentioned: 'someone @mentions me in a comment',
  commented: 'someone comments on a task I created or am assigned',
  status_changed: 'a task I created or am assigned moves to another column',
  due_soon: 'a task assigned to me is due within 24 hours',
  project_added: 'someone adds me to a project',
  project_removed: 'someone removes me from a project',
};
export const typeLabel = (type: string) => TYPE_LABELS[type as NotificationType] ?? type;


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
      return `${who} moved ${what} to ${n.data.to ? statusLabel(n.data.to) : 'a new status'}`;
    case 'project_added':
      return `${who} added you to ${n.data.project_name ?? 'a project'}`;
    case 'project_removed':
      return `${who} removed you from ${n.data.project_name ?? 'a project'}`;
    case 'due_soon': {
      // A reminder from the server, not from a person.
      const due = n.data.due_date ? new Date(n.data.due_date) : null;
      const when = due && !Number.isNaN(due.getTime())
        ? due.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
        : 'soon';
      return `${what} is due ${when}`;
    }
    default:
      return `${who} updated ${what}`;
  }
}

/** Whether a live `notification` event is for this user (the event carries only recipient ids). */
export const isForMe = (message: { type?: string; user_ids?: unknown } | null, userId: string | undefined) =>
  Boolean(message && message.type === 'notification' && userId && Array.isArray(message.user_ids) && message.user_ids.includes(userId));

/** Badge text: nothing at 0, and 99+ past 99. */
export const badgeText = (count: number) => (count <= 0 ? '' : count > 99 ? '99+' : String(count));

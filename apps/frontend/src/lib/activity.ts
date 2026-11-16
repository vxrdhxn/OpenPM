export interface ActivityEntry {
  id: string;
  entity_type: 'project' | 'task' | 'comment' | string;
  entity_id: string;
  action: string;
  created_at: string;
  user_id: string;
  user_name: string;
  /** What it was done to (a task title or project name), or null if unknown. */
  entity_name: string | null;
  task_id: string | null;
  project_id: string | null;
  /** For task updates: { changes: [...], from?, to? }. */
  changes: { changes?: string[]; from?: string; to?: string } | null;
}

const STATUS_NAMES: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

/**
 * The verb phrase for an activity entry, without the actor: "created the task", "moved the task to
 * Done", "commented on". The target's name is rendered separately (as text, or a link).
 */
export function describeActivity(entry: Pick<ActivityEntry, 'entity_type' | 'action' | 'changes'>): string {
  const { entity_type: type, action, changes } = entry;

  if (type === 'comment') {
    if (action === 'created') return 'commented on';
    if (action === 'updated') return 'edited a comment on';
    if (action === 'deleted') return 'deleted a comment on';
  }

  if (type === 'task') {
    if (action === 'created') return 'created the task';
    if (action === 'deleted') return 'deleted the task';
    if (action === 'labels_changed') return 'changed the labels of';
    if (action === 'updated') {
      if (changes?.to && STATUS_NAMES[changes.to]) return `moved to ${STATUS_NAMES[changes.to]}:`;
      if (changes?.changes?.length === 1 && changes.changes[0] === 'assignee_id') return 'reassigned';
      return 'updated the task';
    }
  }

  if (type === 'project') {
    if (action === 'created') return 'created the project';
    if (action === 'updated') return 'updated the project';
    if (action === 'deleted') return 'deleted the project';
  }

  return `${action.replace(/_/g, ' ')} ${type}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a date. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** Compact counts for stat tiles: 1,284 / 12.9K / 4.2M. */
export function compactNumber(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * Task fields as the UI edits them, and how they map to the API (PATCH /projects/:id/tasks/:taskId
 * accepts title, description, status, priority, assignee_id and due_date).
 */

import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '@openpm/wire';

export type { TaskPriority, TaskStatus };

/** How the UI names each status and priority. The values themselves come from the API (@openpm/wire). */
const STATUS_LABELS: Record<TaskStatus, string> = { todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' };
const PRIORITY_LABELS: Record<TaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

export const STATUSES = TASK_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));
export const PRIORITIES = TASK_PRIORITIES.map((value) => ({ value, label: PRIORITY_LABELS[value] }));

export const isStatus = (s: string) => STATUSES.some((x) => x.value === s);
export const statusLabel = (s: string) => STATUSES.find((x) => x.value === s)?.label ?? s;
export const priorityLabel = (p: string) => PRIORITIES.find((x) => x.value === p)?.label ?? p;

/** The editable fields of a task, in form shape (strings; '' = none). */
export interface TaskDraft {
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee_id: string;
  /** yyyy-mm-dd, the value of an <input type="date">, in the user's time zone. */
  due: string;
}

export interface TaskFields {
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  assignee_id?: string | null;
  due_date?: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A stored due date as the yyyy-mm-dd the user picked (their local calendar day). */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A picked yyyy-mm-dd as the instant it ends in the user's time zone. A task due "on the 20th" is
 * overdue after the 20th, not from its first minute (the dashboard's overdue check is `due < now`).
 */
export function fromDateInput(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).toISOString();
}

export function draftOf(task: TaskFields): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    assignee_id: task.assignee_id ?? '',
    due: toDateInput(task.due_date),
  };
}

/**
 * Only the fields the user changed, in API shape. Empty means nothing to save. A cleared assignee or
 * due date is sent as null; the description is a string (the API does not accept null for it).
 */
export function changesOf(task: TaskFields, draft: TaskDraft): Record<string, string | null> {
  const before = draftOf(task);
  const out: Record<string, string | null> = {};
  if (draft.title.trim() !== before.title) out.title = draft.title.trim();
  if (draft.description !== before.description) out.description = draft.description;
  if (draft.status !== before.status) out.status = draft.status;
  if (draft.priority !== before.priority) out.priority = draft.priority;
  if (draft.assignee_id !== before.assignee_id) out.assignee_id = draft.assignee_id || null;
  if (draft.due !== before.due) out.due_date = draft.due ? fromDateInput(draft.due) : null;
  return out;
}

/**
 * Someone saved the task while the user was editing it (the API answered 409 with the current task).
 * Keep the fields the user changed from `base` (what they started from) and take everything else from
 * `current`, so saving again applies only their edits on top of the other person's.
 */
export function rebaseDraft(base: TaskFields, current: TaskFields, draft: TaskDraft): TaskDraft {
  const before = draftOf(base);
  const theirs = draftOf(current);
  const out = { ...theirs };
  for (const key of Object.keys(draft) as (keyof TaskDraft)[]) {
    if (draft[key] !== before[key]) out[key] = draft[key];
  }
  return out;
}

/** Body for POST /projects/:id/tasks from a create form (empty optional fields are left out; new tasks start in To Do). */
export function newTaskBody(draft: TaskDraft): Record<string, string> {
  const body: Record<string, string> = { title: draft.title.trim(), priority: draft.priority || 'medium' };
  if (draft.description.trim()) body.description = draft.description;
  if (draft.assignee_id) body.assignee_id = draft.assignee_id;
  const due = draft.due ? fromDateInput(draft.due) : null;
  if (due) body.due_date = due;
  return body;
}

export const EMPTY_DRAFT: TaskDraft = { title: '', description: '', status: 'todo', priority: 'medium', assignee_id: '', due: '' };

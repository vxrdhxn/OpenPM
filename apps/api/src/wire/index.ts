/**
 * The API's wire vocabulary: the values its JSON carries, declared once and used by both apps.
 *
 * The API owns these (it validates against them), and the frontend imports this file directly
 * (`@openpm/wire`, a path alias to here; its Docker build copies this folder). Keep it to plain
 * constants and types with no imports, so it compiles anywhere: no Node APIs, no database, no
 * framework.
 */

/** Workspace roles, most powerful first. */
export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** The roles that may use the admin sign-in and the admin area. */
export const ADMIN_ROLES = ['owner', 'admin'] as const satisfies readonly Role[];
export const isAdminRole = (role: string): role is (typeof ADMIN_ROLES)[number] => (ADMIN_ROLES as readonly string[]).includes(role);

/** Which sign-in door: everyone may use the member door; the admin door only owners and admins. */
export const LOGIN_DOORS = ['member', 'admin'] as const;
export type LoginDoor = (typeof LOGIN_DOORS)[number];

/** A task's column on the board, in board order. */
export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Task priorities, lowest first. */
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** The colours a label can have. */
export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink'] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

/** The kinds of in-app notification (each one can be muted in the user's preferences). */
export const NOTIFICATION_TYPES = ['task_assigned', 'mentioned', 'commented', 'status_changed', 'due_soon', 'project_added', 'project_removed'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** A page from a paginated endpoint. Pass `next_cursor` back as `cursor` for the next one. */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

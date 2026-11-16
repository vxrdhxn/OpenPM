import { Conditions, likePattern, searchQuerySchema } from './pagination';

export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/**
 * Filters shared by the board (`GET /api/projects/:projectId/tasks`) and task search
 * (`GET /api/tasks`). Repeat a parameter to match any of several values: `?priority=high&priority=urgent`.
 */
export const taskFilterQuerySchema = {
  status: { type: 'array', items: { type: 'string', enum: [...TASK_STATUSES] }, maxItems: TASK_STATUSES.length, uniqueItems: true },
  priority: { type: 'array', items: { type: 'string', enum: [...TASK_PRIORITIES] }, maxItems: TASK_PRIORITIES.length, uniqueItems: true },
  // `me` = the caller, `none` = unassigned, or a user id.
  assignee: { anyOf: [{ type: 'string', enum: ['me', 'none'] }, { type: 'string', format: 'uuid' }] },
  // Tasks with ANY of these labels.
  label: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 10, uniqueItems: true },
  due_after: { type: 'string', format: 'date-time' },
  due_before: { type: 'string', format: 'date-time' },
  q: searchQuerySchema,
} as const;

export interface TaskFilters {
  status?: string[];
  priority?: string[];
  assignee?: string;
  label?: string[];
  due_after?: string;
  due_before?: string;
  q?: string;
}

export const hasTaskFilters = (f: TaskFilters) =>
  Boolean(f.status?.length || f.priority?.length || f.assignee || f.label?.length || f.due_after || f.due_before || f.q);

/** Add the filters as conditions on the tasks table aliased `t`. Values are always bind parameters. */
export function applyTaskFilters(where: Conditions, filters: TaskFilters, callerId: string): Conditions {
  if (filters.status?.length) where.add((p) => `t.status = ANY(${p(filters.status)}::text[])`);
  if (filters.priority?.length) where.add((p) => `t.priority = ANY(${p(filters.priority)}::text[])`);

  if (filters.assignee === 'none') where.add(() => 't.assignee_id IS NULL');
  else if (filters.assignee === 'me') where.add((p) => `t.assignee_id = ${p(callerId)}`);
  else if (filters.assignee) where.add((p) => `t.assignee_id = ${p(filters.assignee)}`);

  // org_id as well: a label id from another organization can never match.
  if (filters.label?.length) {
    where.add(
      (p) => `EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.org_id = t.org_id AND tl.label_id = ANY(${p(filters.label)}::uuid[]))`
    );
  }

  // Tasks without a due date never match a due-date range.
  if (filters.due_after) where.add((p) => `t.due_date >= ${p(filters.due_after)}::timestamptz`);
  if (filters.due_before) where.add((p) => `t.due_date < ${p(filters.due_before)}::timestamptz`);

  if (filters.q) {
    where.add((p) => {
      const pattern = p(likePattern(filters.q!));
      return `(t.title ILIKE ${pattern} ESCAPE '\\' OR t.description ILIKE ${pattern} ESCAPE '\\')`;
    });
  }
  return where;
}

const PRIORITY_RANK = `CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`;

export type TaskSort = 'created_at' | 'updated_at' | 'due_date' | 'priority';
export type SortOrder = 'asc' | 'desc';

/**
 * The SQL expression each sort uses, and its type (to cast the cursor back). Tasks without a due
 * date sort last in either direction.
 */
export function taskSortExpression(sort: TaskSort, order: SortOrder): { expr: string; type: string } {
  switch (sort) {
    case 'updated_at':
      return { expr: 't.updated_at', type: 'timestamptz' };
    case 'due_date':
      return { expr: `COALESCE(t.due_date, '${order === 'asc' ? 'infinity' : '-infinity'}'::timestamptz)`, type: 'timestamptz' };
    case 'priority':
      return { expr: PRIORITY_RANK, type: 'integer' };
    case 'created_at':
    default:
      return { expr: 't.created_at', type: 'timestamptz' };
  }
}

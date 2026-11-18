import { db } from '../db/client';
import { visibleProjectSql } from '../security/projectAccess';
import { Conditions, decodeCursor, toPage, type Page } from '../query/pagination';
import { TASK_LABELS_COLUMN } from '../query/taskLabels';
import { applyTaskFilters, taskSortExpression, type SortOrder, type TaskFilters, type TaskSort } from '../query/taskFilters';
import { viewerOf, type TenantScope } from './scope';

export interface TaskSearchQuery extends TaskFilters {
  project_id?: string;
  sort: TaskSort;
  order: SortOrder;
  limit: number;
  cursor?: string;
}

/**
 * Tasks across every project of the organization the scope user can see, filtered and sorted, one
 * page at a time. A cursor is only valid with the same filters and sort it was issued for.
 */
export async function search(scope: TenantScope, query: TaskSearchQuery): Promise<Page<unknown>> {
  const { expr, type } = taskSortExpression(query.sort, query.order);
  const direction = query.order === 'asc' ? 'ASC' : 'DESC';

  const where = new Conditions().add((p) => `t.org_id = ${p(scope.orgId)}`).add((p) => visibleProjectSql('p', viewerOf(scope), p));
  if (query.project_id) where.add((p) => `t.project_id = ${p(query.project_id)}`);
  applyTaskFilters(where, query, scope.userId);

  if (query.cursor) {
    const after = decodeCursor(query.cursor);
    const op = query.order === 'asc' ? '>' : '<';
    // `type` and `expr` come from taskSortExpression's fixed list, never from the request.
    where.add((p) => `(${expr}, t.id) ${op} (${p(after.key)}::${type}, ${p(after.id)}::uuid)`);
  }

  const rows = await db.query<{ id: string; sort_key: string }>(
    `SELECT t.id, t.project_id, p.name AS project_name, t.title, t.description, t.status, t.priority,
            t.assignee_id, u.name AS assignee_name, t.due_date, t.created_at, t.updated_at, ${TASK_LABELS_COLUMN},
            (${expr})::text AS sort_key
       FROM tasks t
       JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE ${where.sql()}
      ORDER BY ${expr} ${direction}, t.id ${direction}
      LIMIT ${where.param(query.limit + 1)}`,
    where.params
  );
  return toPage(rows, query.limit);
}

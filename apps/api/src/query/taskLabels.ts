import { db } from '../db/client';

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
}

/**
 * The labels of many tasks in one query, by task id (sorted by name). Cheaper than a per-row
 * subquery for large result sets such as a board.
 */
export async function labelsForTasks(taskIds: string[], orgId: string): Promise<Map<string, TaskLabel[]>> {
  const byTask = new Map<string, TaskLabel[]>();
  if (taskIds.length === 0) return byTask;
  const rows = await db.query<TaskLabel & { task_id: string }>(
    `SELECT tl.task_id, l.id, l.name, l.color
       FROM task_labels tl JOIN labels l ON l.id = tl.label_id
      WHERE tl.task_id = ANY($1::uuid[]) AND tl.org_id = $2
      ORDER BY lower(l.name), l.id`,
    [taskIds, orgId]
  );
  for (const { task_id, ...label } of rows) {
    const list = byTask.get(task_id);
    if (list) list.push(label);
    else byTask.set(task_id, [label]);
  }
  return byTask;
}

/**
 * A task's labels as a JSON array column (`labels`), for queries over `tasks t`. Sorted by name so
 * every view shows them in the same order. One indexed lookup per task (task_labels primary key).
 */
export const TASK_LABELS_COLUMN = `COALESCE((
    SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color) ORDER BY lower(l.name), l.id)
      FROM task_labels tl
      JOIN labels l ON l.id = tl.label_id
     WHERE tl.task_id = t.id
  ), '[]'::json) AS labels`;

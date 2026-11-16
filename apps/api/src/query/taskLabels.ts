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

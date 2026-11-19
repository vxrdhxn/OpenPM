import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import LabelChip from '@/components/LabelChip';
import type { Label } from '@/lib/labels';
import { statusLabel } from '@/lib/tasks';

export interface TaskRow {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  status: string;
  priority: string;
  assignee_name: string | null;
  due_date: string | null;
  updated_at: string;
  labels?: Label[];
}


export const isOverdue = (t: Pick<TaskRow, 'due_date' | 'status'>, now = Date.now()) =>
  t.status !== 'done' && t.due_date !== null && new Date(t.due_date).getTime() < now;

/**
 * A compact task list for the dashboard. Each row links to its project's board. "Overdue" is said in
 * words, with the reserved critical color only on the icon.
 */
export default function TaskRows({ tasks, empty, showAssignee = false }: { tasks: TaskRow[]; empty: string; showAssignee?: boolean }) {
  if (tasks.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {tasks.map((t) => {
        const overdue = isOverdue(t);
        return (
          <li key={t.id} className="py-2.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/projects/${t.project_id}`} className="text-sm font-medium text-slate-900 dark:text-white hover:underline break-words">
                {t.title}
              </Link>
              <p className="text-xs text-slate-500 truncate">
                {t.project_name} · {statusLabel(t.status)} · <span className="capitalize">{t.priority}</span>
                {showAssignee && ` · ${t.assignee_name ?? 'Unassigned'}`}
              </p>
              {t.labels && t.labels.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.labels.map((l) => (
                    <LabelChip key={l.id} label={l} />
                  ))}
                </div>
              )}
            </div>
            {t.due_date && (
              <span className="shrink-0 flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                {overdue && <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--status-critical)' }} aria-hidden="true" />}
                {overdue ? 'Overdue · ' : 'Due '}
                {new Date(t.due_date).toLocaleDateString()}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

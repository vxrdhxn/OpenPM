import Link from 'next/link';
import { AlertCircle, CalendarDays } from 'lucide-react';
import LabelChip from '@/components/LabelChip';
import Avatar from '@/components/ui/Avatar';
import { PriorityDot, StatusPill } from '@/components/TaskBadges';
import type { Label } from '@/lib/labels';

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
 * A compact task list for the dashboard. Each row links to its project's board (the whole row is
 * the link's hit area). "Overdue" is said in words, with the reserved critical color only on the icon.
 */
export default function TaskRows({ tasks, empty, showAssignee = false }: { tasks: TaskRow[]; empty: string; showAssignee?: boolean }) {
  if (tasks.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500 rounded-xl bg-slate-50 dark:bg-slate-800/40">{empty}</p>;
  }

  return (
    <ul className="-mx-2 stagger">
      {tasks.map((t, i) => {
        const overdue = isOverdue(t);
        return (
          <li
            key={t.id}
            style={{ '--i': i } as React.CSSProperties}
            className="group relative flex items-start justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
          >
            <PriorityDot priority={t.priority} className="mt-1.5" />
            <div className="min-w-0 flex-1">
              <Link
                href={`/projects/${t.project_id}`}
                className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-indigo-700 dark:group-hover:text-indigo-300 break-words after:absolute after:inset-0 after:rounded-xl outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-500"
              >
                {t.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <StatusPill status={t.status} />
                <span className="truncate">{t.project_name}</span>
                <span aria-hidden="true">·</span>
                <span className="capitalize">{t.priority}</span>
                {showAssignee && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{t.assignee_name ?? 'Unassigned'}</span>
                  </>
                )}
              </div>
              {t.labels && t.labels.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.labels.map((l) => (
                    <LabelChip key={l.id} label={l} />
                  ))}
                </div>
              )}
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              {t.due_date && (
                <span
                  className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs ${
                    overdue ? 'bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {overdue ? (
                    <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--status-critical)' }} aria-hidden="true" />
                  ) : (
                    <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {overdue ? 'Overdue · ' : 'Due '}
                  {new Date(t.due_date).toLocaleDateString()}
                </span>
              )}
              {showAssignee && t.assignee_name && <Avatar name={t.assignee_name} size="xs" />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

'use client';

import { memo } from 'react';
import { CalendarDays } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import LabelChip from '@/components/LabelChip';
import { PriorityChip } from '@/components/TaskBadges';
import { isOverdue } from '@/components/dashboard/TaskRows';
import type { Label } from '@/lib/labels';
import { priorityLabel } from '@/lib/tasks';

export interface BoardCardTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  labels?: Label[];
}

/**
 * What a board card shows: title (the button that opens it), labels, priority, due date, assignee.
 * Memoized: typing in the board's search or a live event re-renders the board, but a card only
 * re-renders when its own task object changes (unchanged tasks keep their identity across moves).
 * `onOpen` must be stable (the board passes its state setter).
 */
function BoardCardContent({ task, onOpen }: { task: BoardCardTask; onOpen: (id: string) => void }) {
  const overdue = isOverdue(task);
  return (
    <div className="flex-1 min-w-0">
      <h3 className="pr-3 text-[15px] font-medium leading-snug text-slate-900 dark:text-slate-100">
        <button
          type="button"
          aria-label={`Open task: ${task.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(task.id);
          }}
          className="text-left break-words outline-none"
        >
          {task.title}
        </button>
      </h3>
      {(task.labels?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {task.labels!.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityChip priority={task.priority} label={priorityLabel(task.priority)} />
          {task.due_date && (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                overdue ? 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <CalendarDays className="w-3 h-3" aria-hidden="true" />
              {overdue && <span className="sr-only">Overdue, due</span>}
              {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        {task.assignee_name && (
          <span title={task.assignee_name} className="shrink-0">
            <Avatar name={task.assignee_name} id={task.assignee_id ?? undefined} size="xs" className="ring-0 transition-transform group-hover:scale-110" />
            <span className="sr-only">Assigned to {task.assignee_name}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(BoardCardContent);

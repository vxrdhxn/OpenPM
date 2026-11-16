'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import AttachmentsPanel from './AttachmentsPanel';
import CommentsPanel from './CommentsPanel';
import TaskLabels from './TaskLabels';
import type { Label } from '@/lib/labels';
import type { CommentEvent } from '@/lib/comments';

export interface TaskSummary {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  assignee_name?: string | null;
  due_date?: string | null;
  labels?: Label[];
}

/** Stable empty list: a fresh `[]` each render would look like new board data to TaskLabels. */
const NO_LABELS: Label[] = [];

export interface CurrentUser {
  user_id: string;
  role: string;
}

interface Props {
  task: TaskSummary;
  projectId: string;
  me: CurrentUser | null;
  /** The latest live event from the organization channel (comments update from it). */
  lastMessage?: CommentEvent | null;
  /** Every label of the organization, for the label picker. */
  orgLabels?: Label[];
  onClose: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function TaskDetailModal({ task, projectId, me, lastMessage = null, orgLabels = NO_LABELS, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Move focus into the dialog, and put it back on whatever opened it when we close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab') return;

    // Keep Tab / Shift+Tab inside the dialog.
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const role = me?.role ?? '';
  const canUpload = role !== '' && role !== 'viewer';
  const isAdmin = role === 'admin' || role === 'owner';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(); // click on the backdrop only
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="bg-white dark:bg-slate-900 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-slate-200 dark:border-slate-800">
          <div className="min-w-0">
            <h2 id="task-dialog-title" className="text-xl font-bold break-words">
              {task.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-medium">
                {STATUS_LABELS[task.status] ?? task.status}
              </span>
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-medium uppercase">
                {task.priority}
              </span>
              {task.assignee_name && <span className="text-slate-500">Assigned to {task.assignee_name}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close task details"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <TaskLabels
            projectId={projectId}
            taskId={task.id}
            labels={task.labels ?? NO_LABELS}
            orgLabels={orgLabels}
            canEdit={canUpload}
          />

          {task.description && (
            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
              {task.description}
            </p>
          )}

          <AttachmentsPanel
            projectId={projectId}
            taskId={task.id}
            canUpload={canUpload}
            currentUserId={me?.user_id ?? null}
            isAdmin={isAdmin}
          />

          <CommentsPanel projectId={projectId} taskId={task.id} me={me} lastMessage={lastMessage} />
        </div>
      </div>
    </div>
  );
}

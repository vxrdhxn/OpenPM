'use client';

import { useId, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import AttachmentsPanel from './AttachmentsPanel';
import CommentsPanel from './CommentsPanel';
import TaskLabels from './TaskLabels';
import TaskForm, { type Assignable } from './TaskForm';
import Dialog from './ui/Dialog';
import { messageOf, useConfirm, useToast } from './ui/feedback';
import { changesOf, draftOf, priorityLabel, rebaseDraft, statusLabel, toDateInput, type TaskDraft } from '@/lib/tasks';
import { api, ApiError } from '@/lib/api';
import type { Label } from '@/lib/labels';
import type { Mentionable } from '@/lib/mentions';
import type { CommentEvent } from '@/lib/comments';

export interface TaskSummary {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  assignee_id?: string | null;
  assignee_name?: string | null;
  due_date?: string | null;
  labels?: Label[];
  /** Bumped by every update; sent with a save so a concurrent edit is caught (docs/concurrency.md). */
  version?: number;
}

/** Stable empty list: a fresh `[]` each render would look like new board data to TaskLabels. */
const NO_LABELS: Label[] = [];
const NO_MEMBERS: (Assignable & Mentionable)[] = [];

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
  /** The organization's members: assignees, and @mentions in comments. */
  members?: (Assignable & Mentionable)[];
  onClose: () => void;
  /** The task was saved or deleted here (the board refreshes; live events also arrive). */
  onChanged?: () => void;
}

export default function TaskDetailModal({ task, projectId, me, lastMessage = null, orgLabels = NO_LABELS, members = NO_MEMBERS, onClose, onChanged }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const role = me?.role ?? '';
  const canEdit = role !== '' && role !== 'viewer';
  const isAdmin = role === 'admin' || role === 'owner';

  const formId = useId();
  // `base` is the version of the task the draft started from. Only the fields changed from it are
  // saved, together with its version, so a save never sends back values someone else has since changed.
  const [base, setBase] = useState<TaskSummary>(task);
  const [draft, setDraft] = useState<TaskDraft>(() => draftOf(task));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [titleError, setTitleError] = useState('');
  const changes = changesOf(base, draft);
  const dirty = Object.keys(changes).length > 0;

  // Someone else changed the task while it is open: show their version unless we have unsaved edits
  // (then the save is checked against the version we started from). A copy older than the one we just
  // saved (the board has not refetched yet) is ignored.
  // (State adjusted while rendering, React's pattern for following a prop, not in an effect.)
  const [seen, setSeen] = useState(task);
  if (seen !== task && !dirty && (task.version ?? 0) >= (base.version ?? 0)) {
    setSeen(task);
    setBase(task);
    setDraft(draftOf(task));
  }

  const requestClose = async () => {
    if (dirty && !(await confirm({ title: 'Discard your changes?', message: 'Your edits to this task have not been saved.', confirmLabel: 'Discard', destructive: true }))) return;
    onClose();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) {
      setTitleError('A task needs a title.');
      return;
    }
    setTitleError('');
    if (!dirty) return;
    setSaving(true);
    try {
      const body = base.version ? { ...changes, version: base.version } : changes;
      const saved = await api.patch(`/projects/${projectId}/tasks/${task.id}`, body);
      setBase((b) => ({ ...b, ...saved }));
      toast('Task saved');
      onChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data?.task) {
        // Someone saved first. Show their changes with ours; the next save is based on their version.
        const current: TaskSummary = { ...base, ...err.data.task };
        setDraft(rebaseDraft(base, current, draft));
        setBase(current);
        toast('Someone else changed this task while you were editing. Their changes are now shown with yours: review and save again.', 'error');
        onChanged?.();
      } else {
        toast(messageOf(err, 'Could not save the task'), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: `Delete "${task.title}"?`, message: 'Its comments and attachments are deleted too. This cannot be undone.', confirmLabel: 'Delete task', destructive: true }))) return;
    setDeleting(true);
    try {
      await api.delete(`/projects/${projectId}/tasks/${task.id}`);
      toast('Task deleted');
      onChanged?.();
      onClose();
    } catch (err) {
      toast(messageOf(err, 'Could not delete the task'), 'error');
      setDeleting(false);
    }
  };

  const due = toDateInput(task.due_date);

  return (
    <Dialog
      size="lg"
      title={task.title}
      onClose={requestClose}
      headerExtra={
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-medium">{statusLabel(task.status)}</span>
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-medium">{priorityLabel(task.priority)} priority</span>
          {task.assignee_name && <span className="text-slate-600 dark:text-slate-400">Assigned to {task.assignee_name}</span>}
          {due && <span className="text-slate-600 dark:text-slate-400">Due {new Date(task.due_date!).toLocaleDateString()}</span>}
        </div>
      }
      footer={
        canEdit ? (
          <>
            {isAdmin && (
              <button type="button" onClick={remove} disabled={deleting || saving} className="btn-secondary mr-auto text-red-700 dark:text-red-400">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
                Delete
              </button>
            )}
            {dirty && (
              <button type="button" className="btn-secondary" onClick={() => setDraft(draftOf(task))} disabled={saving}>
                Discard changes
              </button>
            )}
            <button type="submit" form={formId} className="btn-compact" disabled={!dirty || saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        ) : undefined
      }
    >
      {canEdit ? (
        // Its own form: the comment and label editors below have forms of their own.
        <form id={formId} onSubmit={save}>
          <TaskForm draft={draft} onChange={setDraft} members={members} showStatus disabled={saving || deleting} titleError={titleError} />
        </form>
      ) : (
        task.description && (
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{task.description}</p>
        )
      )}

      <TaskLabels projectId={projectId} taskId={task.id} labels={task.labels ?? NO_LABELS} orgLabels={orgLabels} canEdit={canEdit} />

      <AttachmentsPanel projectId={projectId} taskId={task.id} canUpload={canEdit} currentUserId={me?.user_id ?? null} isAdmin={isAdmin} />

      <CommentsPanel projectId={projectId} taskId={task.id} me={me} lastMessage={lastMessage} members={members} />
    </Dialog>
  );
}

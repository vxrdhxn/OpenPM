'use client';

import { Field } from './ui/states';
import { PRIORITIES, STATUSES, type TaskDraft } from '@/lib/tasks';

export interface Assignable {
  id: string;
  name: string;
}

interface Props {
  draft: TaskDraft;
  onChange: (draft: TaskDraft) => void;
  members: Assignable[];
  /** Status can be set when editing; new tasks always start in To Do. */
  showStatus?: boolean;
  disabled?: boolean;
  titleRef?: React.RefObject<HTMLInputElement | null>;
  titleError?: string;
}

/** The task fields, shared by "Add task" and the task dialog. */
export default function TaskForm({ draft, onChange, members, showStatus = false, disabled = false, titleRef, titleError }: Props) {
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <fieldset disabled={disabled} className="space-y-4 min-w-0">
      <Field label="Title" error={titleError}>
        <input
          ref={titleRef}
          type="text"
          className="input-field"
          required
          maxLength={500}
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="e.g. Design the landing page"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {showStatus && (
          <Field label="Status">
            <select className="input-field" value={draft.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Priority">
          <select className="input-field" value={draft.priority} onChange={(e) => set('priority', e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assignee">
          <select className="input-field" value={draft.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            {/* Keep a since-removed assignee visible instead of silently showing "Unassigned". */}
            {draft.assignee_id && !members.some((m) => m.id === draft.assignee_id) && (
              <option value={draft.assignee_id}>Former member</option>
            )}
          </select>
        </Field>
        <Field label="Due date">
          <input type="date" className="input-field" value={draft.due} onChange={(e) => set('due', e.target.value)} />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          className="input-field min-h-[96px] resize-y"
          rows={4}
          maxLength={50000}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Details, acceptance criteria, links…"
        />
      </Field>
    </fieldset>
  );
}

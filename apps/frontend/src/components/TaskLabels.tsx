'use client';

import { useState } from 'react';
import { Tag } from 'lucide-react';
import LabelChip from './LabelChip';
import { setTaskLabels, toggleLabel, type Label } from '@/lib/labels';

interface Props {
  projectId: string;
  taskId: string;
  /** The task's labels, from the (live) board data. */
  labels: Label[];
  /** Every label of the organization, for the picker. */
  orgLabels: Label[];
  canEdit: boolean;
}

/**
 * A task's labels in the task dialog. Members toggle labels from the organization's set; each change
 * is saved at once. The board refreshes from the task_updated event the API publishes.
 */
export default function TaskLabels({ projectId, taskId, labels, orgLabels, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Shown until the board catches up, so a toggle is visible immediately.
  const [optimistic, setOptimistic] = useState<Label[] | null>(null);
  const [seenLabels, setSeenLabels] = useState(labels);
  if (labels !== seenLabels) {
    setSeenLabels(labels);
    setOptimistic(null);
  }

  const shown = optimistic ?? labels;
  const selected = shown.map((l) => l.id);

  const toggle = async (id: string) => {
    const next = toggleLabel(selected, id);
    setSaving(true);
    setError('');
    try {
      setOptimistic(await setTaskLabels(projectId, taskId, next));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the labels');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Labels">
      <div className="flex items-center gap-2 flex-wrap">
        <Tag className="w-4 h-4 text-slate-500" aria-hidden="true" />
        {shown.length === 0 ? (
          <span className="text-sm text-slate-500">No labels</span>
        ) : (
          shown.map((l) => <LabelChip key={l.id} label={l} />)
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="text-sm text-indigo-600 hover:underline ml-1"
          >
            {open ? 'Done' : 'Edit labels'}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {open &&
        (orgLabels.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No labels yet. Create them in Organization settings.</p>
        ) : (
          <fieldset className="mt-3 flex flex-wrap gap-2" disabled={saving}>
            <legend className="sr-only">Labels for this task</legend>
            {orgLabels.map((l) => (
              <label
                key={l.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer text-sm"
              >
                <input type="checkbox" checked={selected.includes(l.id)} onChange={() => toggle(l.id)} />
                <LabelChip label={l} />
              </label>
            ))}
          </fieldset>
        ))}
    </section>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Tag, Trash2 } from 'lucide-react';
import LabelChip from './LabelChip';
import { useConfirm } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { createLabel, deleteLabel, LABEL_COLORS, listLabels, updateLabel, type LabelColor, type OrgLabel } from '@/lib/labels';

const RANK: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

/**
 * The organization's labels (organization settings). Members create, rename and recolor; admins
 * also delete, which removes the label from every task. The API enforces the same rules.
 */
export default function LabelsPanel() {
  const confirm = useConfirm();
  const [role, setRole] = useState('');
  const [labels, setLabels] = useState<OrgLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>('blue');
  const [saving, setSaving] = useState(false);

  const canEdit = (RANK[role] ?? 0) >= RANK.member!;
  const canDelete = (RANK[role] ?? 0) >= RANK.admin!;

  const load = useCallback(
    () =>
      listLabels()
        .then((list) => {
          setLabels(list);
          setError('');
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Could not load labels'))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    load();
    api.get('/auth/me').then((session) => setRole(session.user.role)).catch(() => setRole(''));
  }, [load]);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await run(async () => {
      await createLabel(name.trim(), color);
      setName('');
    }, 'Could not create the label');
    setSaving(false);
  };

  const rename = (label: OrgLabel) => {
    const next = prompt('Rename label', label.name)?.trim();
    if (!next || next === label.name) return;
    run(() => updateLabel(label.id, { name: next }), 'Could not rename the label');
  };

  const remove = async (label: OrgLabel) => {
    const usage = label.task_count ? ` It is on ${label.task_count} task${label.task_count === 1 ? '' : 's'}.` : '';
    if (!(await confirm({ title: `Delete the label "${label.name}"?`, message: `It is removed from every task.${usage}`, confirmLabel: 'Delete label', destructive: true }))) return;
    run(() => deleteLabel(label.id), 'Could not delete the label');
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-200 dark:border-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Tag className="w-5 h-5" />
          Labels
        </h2>
        <p className="text-sm text-slate-500">Shared by every project in this organization.</p>
      </div>

      {error && (
        <div role="alert" className="mx-6 mt-4 p-3 rounded-lg text-sm bg-red-50 text-red-700">
          {error}
        </div>
      )}

      {canEdit && (
        <form onSubmit={create} className="p-6 pb-2 flex flex-wrap gap-2">
          <input
            aria-label="New label name"
            placeholder="New label"
            value={name}
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
            className="input-field flex-1 min-w-[10rem]"
          />
          <select aria-label="New label color" value={color} onChange={(e) => setColor(e.target.value as LabelColor)} className="input-field w-32 capitalize">
            {LABEL_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button type="submit" disabled={saving || !name.trim()} className="btn-compact px-4">
            Add
          </button>
        </form>
      )}

      {loading ? (
        <p className="p-6 text-slate-500">Loading labels...</p>
      ) : labels.length === 0 ? (
        <p className="p-6 text-slate-500">No labels yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {labels.map((label) => (
            <li key={label.id} className="px-6 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <LabelChip label={label} />
                <span className="text-xs text-slate-500">
                  {label.task_count} task{label.task_count === 1 ? '' : 's'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canEdit && (
                  <>
                    <select
                      aria-label={`Color of ${label.name}`}
                      value={label.color}
                      onChange={(e) => run(() => updateLabel(label.id, { color: e.target.value as LabelColor }), 'Could not change the color')}
                      className="input-field w-28 py-1 text-sm capitalize"
                    >
                      {LABEL_COLORS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => rename(label)} className="text-sm text-indigo-600 hover:underline">
                      Rename
                    </button>
                  </>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => remove(label)}
                    aria-label={`Delete label ${label.name}`}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

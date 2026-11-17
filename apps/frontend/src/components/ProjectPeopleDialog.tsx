'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, UserMinus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Dialog from './ui/Dialog';
import { messageOf, useConfirm, useToast } from './ui/feedback';
import { ErrorBlock, Field, LoadingBlock } from './ui/states';
import { api } from '@/lib/api';
import type { Member } from '@/lib/members';

/** Someone who can see the project; `member` when they were added to it (not just admins/owners). */
export interface ProjectPerson extends Member {
  member: boolean;
}

interface Props {
  projectId: string;
  projectName: string;
  me: { user_id: string; role: string };
  onClose: () => void;
  /** After someone was added or removed (the board reloads its people and tasks). */
  onChanged: () => void;
}

const canManage = (role: string) => role !== 'viewer';

/**
 * Who can see a private project: the people added to it, plus the workspace's admins and owners, who
 * see every project. Members (not viewers) add and remove people; anyone can leave. The API enforces
 * the same rules.
 */
export default function ProjectPeopleDialog({ projectId, projectName, me, onClose, onChanged }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [people, setPeople] = useState<ProjectPerson[] | null>(null);
  const [workspace, setWorkspace] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([api.get(`/projects/${projectId}/members`), api.get('/members')])
        .then(([list, all]: [ProjectPerson[], Member[]]) => {
          setPeople(list);
          setWorkspace(all);
          setError('');
        })
        .catch((err) => setError(messageOf(err, 'Could not load the people of this project'))),
    [projectId]
  );

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adding) return;
    setBusy('add');
    try {
      await api.post(`/projects/${projectId}/members`, { user_id: adding });
      setAdding('');
      await load();
      onChanged();
    } catch (err) {
      toast(messageOf(err, 'Could not add them'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (person: ProjectPerson) => {
    const self = person.id === me.user_id;
    const ok = await confirm({
      title: self ? `Leave ${projectName}?` : `Remove ${person.name} from ${projectName}?`,
      message: self
        ? 'You will no longer see this project. Tasks assigned to you here are unassigned.'
        : 'They will no longer see this project, unless they are an admin or owner. Tasks assigned to them here are unassigned.',
      confirmLabel: self ? 'Leave' : 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setBusy(person.id);
    try {
      await api.delete(`/projects/${projectId}/members/${person.id}`);
      if (self && !['owner', 'admin'].includes(me.role)) {
        // We can no longer see it.
        router.push('/projects');
        return;
      }
      await load();
      onChanged();
    } catch (err) {
      toast(messageOf(err, 'Could not remove them'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const added = people?.filter((p) => p.member) ?? [];
  const byRole = people?.filter((p) => !p.member) ?? [];
  const candidates = workspace.filter((w) => !added.some((p) => p.id === w.id));

  return (
    <Dialog
      title={`People in ${projectName}`}
      description="A private project is visible only to the people added to it, and to the workspace's admins and owners."
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="btn-secondary">
          Done
        </button>
      }
    >
      {error ? (
        <ErrorBlock message={error} onRetry={load} />
      ) : !people ? (
        <LoadingBlock label="Loading people" />
      ) : (
        <div className="space-y-6">
          {canManage(me.role) && candidates.length > 0 && (
            <form onSubmit={add} className="flex flex-col sm:flex-row sm:items-end gap-3">
              <Field label="Add someone" className="flex-1">
                <select className="input-field" value={adding} onChange={(e) => setAdding(e.target.value)} disabled={busy !== null}>
                  <option value="">Choose a person…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email})
                    </option>
                  ))}
                </select>
              </Field>
              <button type="submit" className="btn-compact" disabled={!adding || busy !== null}>
                {busy === 'add' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Add
              </button>
            </form>
          )}

          <section aria-labelledby="added-heading">
            <h3 id="added-heading" className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Added ({added.length})
            </h3>
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {added.map((p) => {
                const self = p.id === me.user_id;
                return (
                  <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium truncate">
                        {p.name}
                        {self && <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">(you)</span>}
                      </span>
                      <span className="block text-sm text-slate-600 dark:text-slate-400 truncate">{p.email}</span>
                    </span>
                    {(self || canManage(me.role)) && (
                      <button
                        type="button"
                        onClick={() => remove(p)}
                        disabled={busy !== null}
                        aria-label={self ? 'Leave this project' : `Remove ${p.name} from this project`}
                        className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg disabled:opacity-50"
                      >
                        {busy === p.id ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <UserMinus className="w-5 h-5" aria-hidden="true" />}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {byRole.length > 0 && (
            <section aria-labelledby="role-heading">
              <h3 id="role-heading" className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Also see it as admins or owners
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">{byRole.map((p) => p.name).join(', ')}</p>
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
}

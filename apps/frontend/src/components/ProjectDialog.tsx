'use client';

import { useRef, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import Dialog from './ui/Dialog';
import { messageOf, useConfirm, useToast } from './ui/feedback';
import { Field } from './ui/states';
import { api } from '@/lib/api';

export interface ProjectFields {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  visibility: 'workspace' | 'private';
  created_by?: string;
}

interface Props {
  /** Edit this project; without it the dialog creates one. */
  project?: ProjectFields;
  /** Admins and owners may delete (the API enforces it too). */
  canDelete?: boolean;
  /** Changing who sees an existing project: admins, owners and its creator (the API enforces it). */
  canChangeVisibility?: boolean;
  onClose: () => void;
  onSaved: (project: ProjectFields) => void;
  onDeleted?: () => void;
}

/** Create a project, or edit/archive/delete one. */
export default function ProjectDialog({ project, canDelete = false, canChangeVisibility = true, onClose, onSaved, onDeleted }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [status, setStatus] = useState<'active' | 'archived'>(project?.status ?? 'active');
  const [visibility, setVisibility] = useState<'workspace' | 'private'>(project?.visibility ?? 'workspace');
  const [nameError, setNameError] = useState('');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (project && visibility === 'private' && project.visibility !== 'private') {
      const ok = await confirm({
        title: 'Make this project private?',
        message: 'Only people you add, and the workspace admins and owners, will see it. Tasks assigned to anyone else are unassigned. You are added automatically.',
        confirmLabel: 'Make private',
      });
      if (!ok) return;
    }
    if (!name.trim()) {
      setNameError('A project needs a name.');
      nameRef.current?.focus();
      return;
    }
    setNameError('');
    setBusy('save');
    try {
      const visibilityChange = !project || visibility !== project.visibility ? { visibility } : {};
      const saved: ProjectFields = project
        ? await api.patch(`/projects/${project.id}`, { name: name.trim(), description, status, ...visibilityChange })
        : await api.post('/projects', { name: name.trim(), description, visibility });
      toast(project ? 'Project saved' : 'Project created');
      onSaved(saved);
    } catch (err) {
      toast(messageOf(err, project ? 'Could not save the project' : 'Could not create the project'), 'error');
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!project) return;
    const ok = await confirm({
      title: `Delete "${project.name}"?`,
      message: 'All of its tasks, comments and attachments are deleted. This cannot be undone. To keep them, archive the project instead.',
      confirmLabel: 'Delete project',
      destructive: true,
    });
    if (!ok) return;
    setBusy('delete');
    try {
      await api.delete(`/projects/${project.id}`);
      toast('Project deleted');
      onDeleted?.();
    } catch (err) {
      toast(messageOf(err, 'Could not delete the project'), 'error');
      setBusy(null);
    }
  };

  return (
    <Dialog
      title={project ? 'Edit project' : 'New project'}
      onClose={onClose}
      onSubmit={submit}
      initialFocus={nameRef}
      footer={
        <>
          {project && canDelete && (
            <button type="button" onClick={remove} disabled={busy !== null} className="btn-secondary mr-auto text-red-700 dark:text-red-400">
              {busy === 'delete' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
              Delete
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-compact" disabled={busy !== null}>
            {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {project ? 'Save changes' : 'Create project'}
          </button>
        </>
      }
    >
      <fieldset disabled={busy !== null} className="space-y-4 min-w-0">
        <Field label="Name" error={nameError}>
          <input ref={nameRef} type="text" className="input-field" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website redesign" />
        </Field>
        <Field label="Description" hint="Optional. What this project is for.">
          <textarea className="input-field min-h-[96px] resize-y" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field
          label="Who can see it"
          hint={
            !canChangeVisibility
              ? 'Only admins, owners and the person who created this project can change this.'
              : visibility === 'private'
                ? 'Only people added to it, plus admins and owners. Add people from the board.'
                : 'Everyone in the workspace.'
          }
        >
          <select className="input-field" value={visibility} onChange={(e) => setVisibility(e.target.value as 'workspace' | 'private')} disabled={!canChangeVisibility}>
            <option value="workspace">Everyone in the workspace</option>
            <option value="private">Private</option>
          </select>
        </Field>
        {project && (
          <Field label="Status" hint="Archived projects are hidden from the dashboard; their tasks are kept.">
            <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'archived')}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        )}
      </fieldset>
    </Dialog>
  );
}

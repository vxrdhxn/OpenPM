'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Loader2, Trash2 } from 'lucide-react';
import Dialog from './ui/Dialog';
import { messageOf, useToast } from './ui/feedback';
import { ErrorBlock, Field, LoadingBlock } from './ui/states';
import { api } from '@/lib/api';

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

/**
 * The workspace itself: rename it (admins), and delete it (owners), which needs the slug typed out
 * and the owner's password. The API enforces both; the UI only offers what the role allows.
 */
export default function OrganizationPanel({ role }: { role: string }) {
  const toast = useToast();
  const [org, setOrg] = useState<Organization | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    () =>
      api
        .get('/organization')
        .then((o: Organization) => {
          setOrg(o);
          setName(o.name);
          setLoadError('');
        })
        .catch((err) => setLoadError(messageOf(err, 'Could not load the organization'))),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || name.trim() === org.name) return;
    setSaving(true);
    try {
      const saved: Organization = await api.patch('/organization', { name: name.trim() });
      setOrg(saved);
      setName(saved.name);
      toast('Organization renamed');
    } catch (err) {
      toast(messageOf(err, 'Could not rename the organization'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const card = 'bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm';

  if (loadError) return <div className={`${card} p-6`}><ErrorBlock message={loadError} onRetry={load} /></div>;
  if (!org) return <div className={`${card} p-6`}><LoadingBlock label="Loading organization" /></div>;

  const isOwner = role === 'owner';
  const unchanged = name.trim() === org.name || name.trim().length < 2;

  return (
    <section aria-labelledby="org-heading" className={card}>
      <div className="p-6 border-b border-slate-200 dark:border-slate-800">
        <h2 id="org-heading" className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Building2 className="w-5 h-5" aria-hidden="true" />
          Workspace
        </h2>
        <p className="text-sm text-slate-500">
          Slug <code className="px-1 rounded bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100">{org.slug}</code>, created{' '}
          {new Date(org.created_at).toLocaleDateString()}.
        </p>
      </div>

      <form onSubmit={rename} className="p-6 flex flex-col sm:flex-row sm:items-end gap-3">
        <Field label="Name" className="flex-1">
          <input type="text" className="input-field" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} disabled={saving} />
        </Field>
        <button type="submit" className="btn-compact" disabled={saving || unchanged}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          Rename
        </button>
      </form>

      {isOwner && (
        <div className="p-6 border-t border-red-200 dark:border-red-900/50">
          <h3 className="font-semibold text-red-700 dark:text-red-400">Delete workspace</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 mb-3">
            Deletes every project, task, comment, file and member account in it, and signs everyone out. This cannot be undone.
          </p>
          <button type="button" className="btn-danger" onClick={() => setDeleting(true)}>
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Delete workspace…
          </button>
        </div>
      )}

      {deleting && <DeleteWorkspaceDialog org={org} onClose={() => setDeleting(false)} />}
    </section>
  );
}

function DeleteWorkspaceDialog({ org, onClose }: { org: Organization; onClose: () => void }) {
  const slugRef = useRef<HTMLInputElement>(null);
  const [slug, setSlug] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = slug.trim() === org.slug;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches || !password) return;
    setBusy(true);
    setError('');
    try {
      await api.delete('/organization', { body: JSON.stringify({ confirm_slug: slug.trim(), password }) });
      // The session is gone with the workspace: drop all client state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/login?deleted=1';
    } catch (err) {
      setError(messageOf(err, 'Could not delete the workspace'));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Delete ${org.name}?`}
      description="Everything in this workspace is deleted for everyone. There is no undo."
      role="alertdialog"
      onClose={onClose}
      onSubmit={submit}
      initialFocus={slugRef}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-danger" disabled={busy || !matches || !password}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Delete workspace
          </button>
        </>
      }
    >
      <fieldset disabled={busy} className="space-y-4 min-w-0">
        {error && (
          <p role="alert" className="p-3 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}
        <Field label={<>Type <strong>{org.slug}</strong> to confirm</>}>
          <input ref={slugRef} type="text" className="input-field" autoComplete="off" spellCheck={false} value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Your password">
          <input type="password" className="input-field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </fieldset>
    </Dialog>
  );
}

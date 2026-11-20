'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { messageOf, useToast } from '@/components/ui/feedback';
import { ErrorBlock, LoadingBlock } from '@/components/ui/states';
import { getPreferences, savePreferences, typeLabel, type NotificationPreferences } from '@/lib/notifications';

/**
 * Which notifications the user gets (docs/notifications.md). A switched-off type is never created for
 * them, so it does not show up later either. Notifications are deleted after a retention period.
 */
export default function NotificationSettings() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [muted, setMuted] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    getPreferences()
      .then((p) => {
        setPrefs(p);
        setMuted(p.muted);
        setError('');
      })
      .catch((err) => setError(messageOf(err, 'Could not load your notification settings')));
  }, [attempt]);

  const toggle = (type: string, on: boolean) => setMuted((m) => (on ? m.filter((t) => t !== type) : [...m, type]));
  const dirty = prefs !== null && [...muted].sort().join() !== [...prefs.muted].sort().join();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await savePreferences(muted);
      setPrefs(saved);
      setMuted(saved.muted);
      toast('Notification settings saved');
    } catch (err) {
      toast(messageOf(err, 'Could not save your notification settings'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto w-full">
      <h1 className="page-title mb-2">Notifications</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
        Choose what you are notified about. Old notifications are deleted automatically.
      </p>

      {error ? (
        <ErrorBlock message={error} onRetry={() => setAttempt((a) => a + 1)} />
      ) : !prefs ? (
        <LoadingBlock label="Loading notification settings" />
      ) : (
        <form onSubmit={save} className="space-y-6 card p-6 animate-fade-up">
          <fieldset>
            <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Notify me when…</legend>
            <div className="space-y-3">
              {prefs.types.map((type) => {
                const id = `notify-${type}`;
                return (
                  <div key={type} className="flex items-start gap-3">
                    <input
                      id={id}
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={!muted.includes(type)}
                      onChange={(e) => toggle(type, e.target.checked)}
                    />
                    <label htmlFor={id} className="text-sm text-slate-800 dark:text-slate-200">
                      {typeLabel(type)}
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="flex justify-end">
            <button type="submit" disabled={saving || !dirty} className="btn-compact inline-flex items-center gap-2 disabled:opacity-50">
              {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

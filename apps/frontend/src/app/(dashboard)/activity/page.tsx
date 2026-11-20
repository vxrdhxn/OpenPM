'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { buildQuery, type Page } from '@/lib/query';
import type { ActivityEntry } from '@/lib/activity';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import PageHeader from '@/components/ui/PageHeader';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/states';

const PAGE_SIZE = 30;

/** "Today", "Yesterday", or the date: the heading for a day's group. */
function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** Everything that happened in the organization, newest first, grouped by day, a page at a time. */
export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const load = useCallback((after: string | null) => {
    const id = ++requestId.current;
    return api
      .get(`/activity${buildQuery({ limit: PAGE_SIZE, cursor: after })}`)
      .then((page: Page<ActivityEntry>) => {
        if (id !== requestId.current) return;
        setEntries((current) => (after ? [...current, ...page.items.filter((e) => !current.some((c) => c.id === e.id))] : page.items));
        setCursor(page.next_cursor);
        setError('');
      })
      .catch((err) => {
        if (id === requestId.current) setError(err instanceof Error ? err.message : 'Could not load the activity');
      })
      .finally(() => {
        if (id !== requestId.current) return;
        setLoading(false);
        setLoadingMore(false);
      });
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  // Group consecutive entries by calendar day.
  const groups: { label: string; items: ActivityEntry[] }[] = [];
  for (const e of entries) {
    const label = dayLabel(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl w-full mx-auto">
      <PageHeader icon={<Activity />} title="Activity" subtitle="Everything that happened across your organization, newest first." />

      {error && (
        <div className="mb-6">
          <ErrorBlock
            message={error}
            onRetry={() => {
              setError('');
              setLoading(true);
              load(null);
            }}
          />
        </div>
      )}

      {loading ? (
        <div className="card p-6">
          <LoadingBlock label="Loading activity" rows={6} />
        </div>
      ) : entries.length === 0 && !error ? (
        <EmptyBlock icon={<Activity />} title="Nothing has happened yet">
          Create a project or a task and it will show up here.
        </EmptyBlock>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label} className="animate-fade-up">
              <h2 className="sticky top-0 z-10 -mx-2 mb-3 px-2 py-2 eyebrow bg-slate-50/90 dark:bg-slate-950/90 backdrop-blur">{g.label}</h2>
              <div className="card p-5 sm:p-6">
                <ActivityFeed entries={g.items} compact={false} />
              </div>
            </section>
          ))}
          {cursor && (
            <div className="flex justify-center">
              <button
                type="button"
                className="btn-secondary"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  load(cursor);
                }}
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Load older activity
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

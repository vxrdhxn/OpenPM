'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { useWebsocket } from '@/hooks/useWebsocket';
import { api } from '@/lib/api';
import { NOTIFICATIONS_CHANGED } from '@/components/NotificationsLink';
import { timeAgo } from '@/lib/activity';
import Avatar from '@/components/ui/Avatar';
import PageHeader from '@/components/ui/PageHeader';
import { EmptyBlock, LoadingBlock } from '@/components/ui/states';
import {
  describeNotification,
  isForMe,
  listNotifications,
  markAllRead,
  markRead,
  type AppNotification,
} from '@/lib/notifications';

const changed = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const { lastMessage } = useWebsocket();
  const requestId = useRef(0);
  const [meId, setMeId] = useState<string | undefined>();

  useEffect(() => {
    api.get('/auth/me').then((session) => setMeId(session.user.user_id)).catch(() => undefined);
  }, []);

  // First page. State is only set in the promise callbacks.
  const load = useCallback(() => {
    const id = ++requestId.current;
    return listNotifications({ unread: unreadOnly })
      .then((page) => {
        if (id !== requestId.current) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setError('');
      })
      .catch((err) => id === requestId.current && setError(err instanceof Error ? err.message : 'Could not load notifications'))
      .finally(() => id === requestId.current && setLoading(false));
  }, [unreadOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // Something new arrived for us: reload.
  useEffect(() => {
    if (isForMe(lastMessage, meId)) load();
  }, [lastMessage, meId, load]);

  const loadMore = () => {
    if (!cursor) return;
    setLoadingMore(true);
    const id = requestId.current;
    listNotifications({ unread: unreadOnly, cursor })
      .then((page) => {
        if (id !== requestId.current) return;
        setItems((current) => [...current, ...page.items.filter((n) => !current.some((c) => c.id === n.id))]);
        setCursor(page.next_cursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load notifications'))
      .finally(() => setLoadingMore(false));
  };

  const open = async (n: AppNotification) => {
    if (!n.read_at) {
      try {
        await markRead(n.id);
        changed();
      } catch {
        // Opening the task matters more than the read mark.
      }
    }
    if (n.project_id) router.push(`/projects/${n.project_id}`);
    else setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
  };

  const readAll = async () => {
    try {
      await markAllRead();
      changed();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark notifications read');
    }
  };

  const hasUnread = items.some((n) => !n.read_at);

  return (
    <div className="p-4 sm:p-8 max-w-3xl w-full mx-auto">
      <PageHeader
        icon={<Bell />}
        title="Notifications"
        subtitle="Assignments, mentions, comments and reminders, all in one place."
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 rounded accent-indigo-600" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
              Unread only
            </label>
            <button type="button" onClick={readAll} disabled={!hasUnread} className="btn-secondary">
              <CheckCheck className="w-4 h-4" aria-hidden="true" />
              Mark all read
            </button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-4 p-3 rounded-xl text-sm bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300 animate-fade-up">
          {error}
        </div>
      )}

      {loading ? (
        <div className="card p-5">
          <LoadingBlock rows={5} />
        </div>
      ) : items.length === 0 ? (
        <EmptyBlock icon={<Bell />} title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}>
          You will hear here when someone assigns you a task, mentions you or comments on your work.
        </EmptyBlock>
      ) : (
        <>
          <ul className="card overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 stagger">
            {items.map((n, i) => (
              <li key={n.id} style={{ '--i': i } as React.CSSProperties}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={`group relative w-full text-left p-4 flex items-start gap-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/60 ${
                    n.read_at ? '' : 'bg-indigo-50/40 dark:bg-indigo-500/[0.04]'
                  }`}
                >
                  {/* Unread marker, with a text equivalent for screen readers. */}
                  <span
                    className={`absolute left-0 top-0 bottom-0 w-1 ${n.read_at ? 'bg-transparent' : 'bg-brand'}`}
                    aria-hidden="true"
                  />
                  {n.actor_name ? (
                    <Avatar name={n.actor_name} id={n.actor_id ?? undefined} size="md" className="ring-0" />
                  ) : (
                    <span aria-hidden="true" className="icon-tile w-9 h-9 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                      <Bell className="w-4 h-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read_at ? 'text-slate-600 dark:text-slate-400' : 'text-slate-900 dark:text-white font-medium'}`}>
                      {!n.read_at && <span className="sr-only">Unread: </span>}
                      {describeNotification(n)}
                    </span>
                    {n.data.excerpt && (
                      <span className="block mt-1.5 rounded-lg bg-slate-100/80 dark:bg-slate-800/60 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 break-words">
                        “{n.data.excerpt}”
                      </span>
                    )}
                    <time dateTime={n.created_at} className="block mt-1 text-xs text-slate-500">
                      {timeAgo(n.created_at)}
                    </time>
                  </span>
                  {!n.read_at && <span aria-hidden="true" className="mt-1.5 w-2 h-2 rounded-full bg-indigo-600 shrink-0 animate-pop" />}
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <div className="flex justify-center mt-6">
              <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary">
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

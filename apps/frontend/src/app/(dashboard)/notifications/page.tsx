'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { useWebsocket } from '@/hooks/useWebsocket';
import { api } from '@/lib/api';
import { NOTIFICATIONS_CHANGED } from '@/components/NotificationsLink';
import { timeAgo } from '@/lib/activity';
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
    <div className="p-8 h-full overflow-y-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Notifications</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            Unread only
          </label>
          <button
            type="button"
            onClick={readAll}
            disabled={!hasUnread}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <CheckCheck className="w-4 h-4" aria-hidden="true" />
            Mark all read
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 p-3 rounded-lg text-sm bg-red-50 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" aria-label="Loading" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl text-center">
          <Bell className="w-10 h-10 text-slate-400 mb-3" aria-hidden="true" />
          <p className="font-medium">{unreadOnly ? 'No unread notifications' : 'No notifications yet'}</p>
          <p className="text-sm text-slate-500 mt-1">You will hear here when someone assigns you a task, mentions you or comments on your work.</p>
        </div>
      ) : (
        <>
          <ul className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className="w-full text-left p-4 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  {/* Unread marker, with a text equivalent for screen readers. */}
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-indigo-600'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read_at ? 'text-slate-600 dark:text-slate-400' : 'text-slate-900 dark:text-white font-medium'}`}>
                      {!n.read_at && <span className="sr-only">Unread: </span>}
                      {describeNotification(n)}
                    </span>
                    {n.data.excerpt && <span className="block mt-1 text-sm text-slate-500 break-words">“{n.data.excerpt}”</span>}
                    <time dateTime={n.created_at} className="block mt-1 text-xs text-slate-500">
                      {timeAgo(n.created_at)}
                    </time>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <div className="flex justify-center mt-6">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="px-4 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
              >
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

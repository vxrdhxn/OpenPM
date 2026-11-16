'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useWebsocket } from '@/hooks/useWebsocket';
import { badgeText, isForMe, unreadCount } from '@/lib/notifications';

/** Fired on window after the notifications page changes read state, so the badge follows at once. */
export const NOTIFICATIONS_CHANGED = 'openpm:notifications-changed';

const FALLBACK_POLL_MS = 60_000;

/**
 * Sidebar link with the unread count. The count is refreshed on load, when a live `notification`
 * event names this user, after a reconnect (events are not replayed), when the window regains
 * focus, and every minute as a fallback.
 */
export default function NotificationsLink({ userId, active }: { userId: string; active: boolean }) {
  const [count, setCount] = useState(0);
  const { lastMessage, connectionEpoch } = useWebsocket();

  const refresh = useCallback(
    () =>
      unreadCount()
        .then((r) => setCount(r.count))
        .catch(() => undefined),
    []
  );

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, FALLBACK_POLL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (isForMe(lastMessage, userId)) refresh();
  }, [lastMessage, userId, refresh]);

  useEffect(() => {
    if (connectionEpoch > 1) refresh();
  }, [connectionEpoch, refresh]);

  const badge = badgeText(count);

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
        active
          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      <Bell className="w-5 h-5" aria-hidden="true" />
      Notifications
      {badge && (
        <span className="ml-auto min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-semibold text-center" aria-hidden="true">
          {badge}
        </span>
      )}
    </Link>
  );
}

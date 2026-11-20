'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useWebsocket } from '@/hooks/useWebsocket';
import { badgeText, isForMe, unreadCount } from '@/lib/notifications';
import { ActiveBar, navLinkClass } from '@/components/nav';

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
      aria-current={active ? 'page' : undefined}
      className={navLinkClass(active)}
    >
      <ActiveBar active={active} />
      <span className="relative">
        <Bell className={`w-[18px] h-[18px] transition-transform duration-200 group-hover:scale-110 ${badge ? 'group-hover:rotate-12' : ''} ${active ? 'text-indigo-600 dark:text-indigo-300' : ''}`} aria-hidden="true" />
        {badge && (
          <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 flex w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-fuchsia-400 opacity-75 animate-ping" />
            <span className="relative w-2 h-2 rounded-full bg-fuchsia-500" />
          </span>
        )}
      </span>
      Notifications
      {badge && (
        <span key={badge} className="ml-auto min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-semibold text-center shadow-sm animate-pop" aria-hidden="true">
          {badge}
        </span>
      )}
    </Link>
  );
}

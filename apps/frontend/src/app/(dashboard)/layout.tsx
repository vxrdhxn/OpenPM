'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CheckSquare, FolderKanban, LayoutDashboard, Loader2, LogOut, Menu, Settings, ShieldCheck, User, X } from 'lucide-react';
import { api } from '@/lib/api';
import WebsocketProvider from '@/hooks/WebsocketProvider';
import NotificationsLink from '@/components/NotificationsLink';
import { messageOf, OfflineBanner } from '@/components/ui/feedback';
import { ErrorBlock } from '@/components/ui/states';

interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
}

const linkClass = (active: boolean) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
    active
      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium'
      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
  }`;

function Nav({ me, pathname }: { me: Me; pathname: string }) {
  const isActive = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + '/');
  const item = (href: string, label: string, Icon: typeof LayoutDashboard) => (
    <Link href={href} className={linkClass(isActive(href))} aria-current={isActive(href) ? 'page' : undefined}>
      <Icon className="w-5 h-5" aria-hidden="true" />
      {label}
    </Link>
  );
  const isManager = me.role === 'admin' || me.role === 'owner';
  return (
    <nav aria-label="Main" className="flex-1 px-4 space-y-1 overflow-y-auto">
      {item('/dashboard', 'Dashboard', LayoutDashboard)}
      {item('/projects', 'Projects', FolderKanban)}
      <NotificationsLink userId={me.id} active={isActive('/notifications')} />
      <p className="pt-4 pb-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Settings</p>
      {item('/settings/profile', 'Profile', User)}
      {isManager && item('/settings/organization', 'Organization', Settings)}
      {isManager && item('/settings/security', 'Security log', ShieldCheck)}
    </nav>
  );
}

function Account({ me, onLogout, loggingOut }: { me: Me; onLogout: () => void; loggingOut: boolean }) {
  return (
    <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{me.name}</p>
        <p className="text-xs text-slate-500 truncate">
          {me.email} · <span className="capitalize">{me.role}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onLogout}
        disabled={loggingOut}
        className="shrink-0 p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
        aria-label="Sign out"
        title="Sign out"
      >
        {loggingOut ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> : <LogOut className="w-5 h-5" aria-hidden="true" />}
      </button>
    </div>
  );
}

const Brand = () => (
  <div className="flex items-center gap-3 font-bold text-xl text-indigo-600 dark:text-indigo-400">
    <CheckSquare className="w-6 h-6" aria-hidden="true" />
    OpenPM
  </div>
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  // A 401 is handled by the API client (it signs out and goes to /login); anything else is shown.
  const fetchMe = useCallback(
    () =>
      api
        .get('/profile/me')
        .then(setMe)
        .catch((err) => setLoadError(messageOf(err, 'Could not load your account'))),
    []
  );
  useEffect(() => {
    fetchMe();
  }, [fetchMe]);
  const retry = () => {
    setLoadError('');
    fetchMe();
  };

  // Close the mobile menu after navigating (adjusting state during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    drawer.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const handleLogout = async () => {
    setLoggingOut(true);
    await api.post('/auth/logout', {}).catch(() => undefined);
    router.push('/login');
  };

  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        {loadError ? (
          <div className="max-w-md w-full">
            <ErrorBlock message={loadError} onRetry={retry} />
          </div>
        ) : (
          <div role="status" className="flex items-center gap-3 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            Loading OpenPM…
          </div>
        )}
      </div>
    );
  }

  return (
    // One WebSocket for the whole signed-in app (the badge and the board share it).
    <WebsocketProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-indigo-600 focus:text-white"
      >
        Skip to content
      </a>
      <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
        {/* Sidebar on wide screens */}
        <aside className="hidden md:flex w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col">
          <div className="p-6">
            <Brand />
          </div>
          <Nav me={me} pathname={pathname} />
          <Account me={me} onLogout={handleLogout} loggingOut={loggingOut} />
        </aside>

        {/* Drawer on narrow screens */}
        {menuOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={() => setMenuOpen(false)} />
            <div
              ref={drawer}
              id="mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="relative w-72 max-w-[85vw] h-full bg-white dark:bg-slate-900 flex flex-col shadow-xl"
            >
              <div className="p-4 flex items-center justify-between">
                <Brand />
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <Nav me={me} pathname={pathname} />
              <Account me={me} onLogout={handleLogout} loggingOut={loggingOut} />
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <button
              ref={menuButton}
              type="button"
              onClick={() => setMenuOpen(true)}
              className="p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <Brand />
          </header>
          <OfflineBanner />
          <main id="main" tabIndex={-1} className="flex-1 flex flex-col overflow-y-auto outline-none">
            {children}
          </main>
        </div>
      </div>
    </WebsocketProvider>
  );
}

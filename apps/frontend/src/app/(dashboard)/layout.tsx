'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, BellRing, FolderKanban, Gauge, LayoutDashboard, Menu, Search, Settings, ShieldCheck, User, X } from 'lucide-react';
import { api } from '@/lib/api';
import { buildQuery, type Page } from '@/lib/query';
import { gradientFor } from '@/lib/palette';
import WebsocketProvider from '@/hooks/WebsocketProvider';
import NotificationsLink from '@/components/NotificationsLink';
import AccountMenu from '@/components/AccountMenu';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/motion/ThemeToggle';
import { Kbd } from '@/components/CommandPalette';
import { ActiveBar, navLinkClass, PROJECTS_CHANGED } from '@/components/nav';
import { messageOf, OfflineBanner } from '@/components/ui/feedback';
import { ErrorBlock } from '@/components/ui/states';

// Only loaded when someone opens it.
const CommandPalette = dynamic(() => import('@/components/CommandPalette'), { ssr: false });

import { MeProvider, type Me } from '@/components/me';

interface SidebarProject {
  id: string;
  name: string;
}

function Nav({ me, pathname, projects }: { me: Me; pathname: string; projects: SidebarProject[] }) {
  const isActive = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + '/');
  const item = (href: string, label: string, Icon: typeof LayoutDashboard) => {
    const active = isActive(href);
    return (
      <Link href={href} className={navLinkClass(active)} aria-current={active ? 'page' : undefined}>
        <ActiveBar active={active} />
        <Icon className={`w-[18px] h-[18px] transition-transform duration-200 group-hover:scale-110`} aria-hidden="true" />
        {label}
      </Link>
    );
  };
  const isManager = me.role === 'admin' || me.role === 'owner';
  return (
    <nav aria-label="Main" className="flex-1 px-3 space-y-0.5 overflow-y-auto">
      {item('/dashboard', 'Dashboard', LayoutDashboard)}
      {item('/projects', 'Projects', FolderKanban)}
      {item('/activity', 'Activity', Activity)}
      <NotificationsLink userId={me.id} active={isActive('/notifications')} />
      {isManager && item('/admin', 'Admin', Gauge)}

      {projects.length > 0 && (
        <>
          <p className="eyebrow pt-6 pb-2 px-3">Recent boards</p>
          <ul className="space-y-0.5">
            {projects.map((p) => {
              const active = pathname === `/projects/${p.id}`;
              return (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className={navLinkClass(active)} aria-current={active ? 'page' : undefined}>
                    <ActiveBar active={active} />
                    <span aria-hidden="true" className={`w-2.5 h-2.5 shrink-0 rounded-[4px] bg-gradient-to-br ${gradientFor(p.id)} transition-transform duration-200 group-hover:scale-125 group-hover:rotate-12`} />
                    <span className="truncate">{p.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="eyebrow pt-6 pb-2 px-3">Settings</p>
      {item('/settings/profile', 'Profile', User)}
      {item('/settings/notifications', 'Notifications', BellRing)}
      {isManager && item('/settings/organization', 'Organization', Settings)}
      {isManager && item('/settings/security', 'Security log', ShieldCheck)}
    </nav>
  );
}

function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group mx-3 mb-4 flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-sm text-slate-500 dark:text-slate-400 hover:border-indigo-300 hover:bg-white hover:text-slate-700 dark:hover:border-indigo-500/50 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-all outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <Search className="w-4 h-4 transition-transform group-hover:scale-110" aria-hidden="true" />
      <span className="flex-1 text-left">Jump to…</span>
      <span aria-hidden="true" className="hidden md:inline-flex gap-0.5">
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [projects, setProjects] = useState<SidebarProject[]>([]);
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

  // The sidebar's quick links: the most recently created active boards.
  const fetchProjects = useCallback(
    () =>
      api
        .get(`/projects${buildQuery({ status: 'active', limit: 5 })}`)
        .then((page: Page<SidebarProject>) => setProjects(page.items))
        .catch(() => undefined),
    []
  );
  useEffect(() => {
    fetchProjects();
    window.addEventListener(PROJECTS_CHANGED, fetchProjects);
    return () => window.removeEventListener(PROJECTS_CHANGED, fetchProjects);
  }, [fetchProjects]);

  // Ctrl/⌘ + K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenuOpen(false);
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          <div role="status" className="flex flex-col items-center gap-5 text-slate-500 animate-fade-in">
            <div className="animate-float">
              <Brand size="lg" />
            </div>
            <div aria-hidden="true" className="h-1 w-40 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full w-1/2 rounded-full bg-brand animate-[shimmer-bar_1.2s_ease-in-out_infinite]" />
            </div>
            <span className="text-sm">Loading OpenPM…</span>
          </div>
        )}
      </div>
    );
  }

  const isManager = me.role === 'admin' || me.role === 'owner';
  const sidebar = (
    <>
      <SearchButton onOpen={() => { setMenuOpen(false); setPaletteOpen(true); }} />
      <Nav me={me} pathname={pathname} projects={projects} />
      <AccountMenu me={me} onLogout={handleLogout} loggingOut={loggingOut} />
    </>
  );

  return (
    // One WebSocket for the whole signed-in app (the badge and the board share it).
    <MeProvider value={me}>
    <WebsocketProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-indigo-600 focus:text-white"
      >
        Skip to content
      </a>
      <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
        {/* Sidebar on wide screens */}
        <aside className="hidden md:flex w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/40 flex-col">
          <div className="px-5 pt-6 pb-5 flex items-center justify-between">
            <Link href="/dashboard" aria-label="OpenPM home" className="inline-block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <Brand />
            </Link>
            <ThemeToggle />
          </div>
          {sidebar}
        </aside>

        {/* Drawer on narrow screens */}
        {menuOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-fade-in" aria-hidden="true" onClick={() => setMenuOpen(false)} />
            <div
              ref={drawer}
              id="mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="relative w-72 max-w-[85vw] h-full bg-white dark:bg-slate-900 flex flex-col shadow-2xl animate-slide-in-left"
            >
              <div className="p-4 flex items-center justify-between">
                <Brand />
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:rotate-90 transition-all duration-300"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              {sidebar}
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Paper: a faint dot grid fading out from the top right. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-dots opacity-60 [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_60%)]" />
          </div>
          <header className="relative md:hidden flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
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
            <ThemeToggle className="ml-auto" />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Jump to a page or project"
            >
              <Search className="w-5 h-5" aria-hidden="true" />
            </button>
          </header>
          <OfflineBanner />
          <main id="main" tabIndex={-1} className="relative flex-1 flex flex-col overflow-y-auto outline-none">
            {/* Each page fades in. Keyed by path, so navigating replays it. */}
            <div key={pathname} className="flex-1 min-h-0 flex flex-col animate-fade-up">
              {children}
            </div>
          </main>
        </div>
      </div>
      {paletteOpen && <CommandPalette isManager={isManager} onClose={() => setPaletteOpen(false)} />}
    </WebsocketProvider>
    </MeProvider>
  );
}

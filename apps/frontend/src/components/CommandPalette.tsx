'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowRight, Bell, BellRing, CornerDownLeft, FolderKanban, Gauge, LayoutDashboard, Search, Settings, ShieldCheck, User } from 'lucide-react';
import { api } from '@/lib/api';
import { buildQuery, type Page } from '@/lib/query';
import { gradientFor } from '@/lib/palette';
import Dialog from '@/components/ui/Dialog';

interface Item {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: React.ReactNode;
}

interface ProjectHit {
  id: string;
  name: string;
  status: string;
}

const PAGES = (isManager: boolean): Item[] => [
  { id: 'p-dashboard', label: 'Dashboard', hint: 'Page', href: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'p-projects', label: 'All projects', hint: 'Page', href: '/projects', icon: <FolderKanban className="w-4 h-4" /> },
  { id: 'p-activity', label: 'Activity', hint: 'Page', href: '/activity', icon: <Activity className="w-4 h-4" /> },
  { id: 'p-notifications', label: 'Notifications', hint: 'Page', href: '/notifications', icon: <Bell className="w-4 h-4" /> },
  { id: 'p-new', label: 'Create a project', hint: 'Action', href: '/projects?new=1', icon: <ArrowRight className="w-4 h-4" /> },
  { id: 'p-profile', label: 'Profile', hint: 'Settings', href: '/settings/profile', icon: <User className="w-4 h-4" /> },
  { id: 'p-notif-settings', label: 'Notification settings', hint: 'Settings', href: '/settings/notifications', icon: <BellRing className="w-4 h-4" /> },
  ...(isManager
    ? [
        { id: 'p-admin', label: 'Admin', hint: 'Page', href: '/admin', icon: <Gauge className="w-4 h-4" /> },
        { id: 'p-org', label: 'Organization', hint: 'Settings', href: '/settings/organization', icon: <Settings className="w-4 h-4" /> },
        { id: 'p-security', label: 'Security log', hint: 'Settings', href: '/settings/security', icon: <ShieldCheck className="w-4 h-4" /> },
      ]
    : []),
];

/**
 * Ctrl/⌘ + K: jump to any page or project by typing. Follows the combobox pattern: the input keeps
 * focus, arrow keys move the active option (aria-activedescendant), Enter opens it.
 */
export default function CommandPalette({ isManager, onClose }: { isManager: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ProjectHit[]>([]);
  const [active, setActive] = useState(0);

  // Projects matching the text (debounced; only the newest answer counts).
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .get(`/projects${buildQuery({ q: query.trim(), limit: 6 })}`)
        .then((page: Page<ProjectHit>) => live && setProjects(page.items))
        .catch(() => live && setProjects([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = PAGES(isManager).filter((p) => !q || p.label.toLowerCase().includes(q));
    const projectItems: Item[] = projects.map((p) => ({
      id: `proj-${p.id}`,
      label: p.name,
      hint: p.status === 'archived' ? 'Archived project' : 'Project',
      href: `/projects/${p.id}`,
      icon: <span className={`block w-2.5 h-2.5 rounded-full bg-gradient-to-br ${gradientFor(p.id)}`} />,
    }));
    return [...projectItems, ...pages];
  }, [query, projects, isManager]);

  // Keep the active option in range as the list changes (adjusting state during render).
  if (active > 0 && active >= items.length) setActive(Math.max(0, items.length - 1));

  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[active]);
    }
  };

  // Keep the active option visible.
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  return (
    <Dialog title="Go to…" onClose={onClose} initialFocus={inputRef}>
      <div className="-mx-6 -mt-6 -mb-4">
        <div className="relative border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-500 absolute left-6 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search pages and projects"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder="Search pages and projects…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent pl-12 pr-6 py-4 text-base text-slate-900 dark:text-white placeholder:text-slate-500 outline-none"
          />
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Nothing matches “{query}”.</li>}
          {items.map((item, i) => (
            <li
              key={item.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => go(item)}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer text-sm transition-colors ${
                i === active ? 'bg-indigo-50 text-indigo-900 dark:bg-indigo-500/15 dark:text-white' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <span
                aria-hidden="true"
                className={`icon-tile w-8 h-8 rounded-lg ${i === active ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}
              >
                {item.icon}
              </span>
              <span className="flex-1 min-w-0 truncate font-medium">{item.label}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{item.hint}</span>
              {i === active && <CornerDownLeft className="w-3.5 h-3.5 text-indigo-500" aria-hidden="true" />}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 px-6 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> to move</span>
          <span><Kbd>Enter</Kbd> to open</span>
          <span><Kbd>Esc</Kbd> to close</span>
        </div>
      </div>
    </Dialog>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] justify-center rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-600 dark:text-slate-300 shadow-[0_1px_0_rgb(0_0_0_/_0.08)]">
      {children}
    </kbd>
  );
}

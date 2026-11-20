/** Shared look of the sidebar links (app/(dashboard)/layout.tsx and NotificationsLink). */

/** Fired on window when a project is created, renamed, archived or deleted, so the sidebar follows. */
export const PROJECTS_CHANGED = 'openpm:projects-changed';

export const navLinkClass = (active: boolean) =>
  `group relative flex items-center gap-3 px-3.5 py-2 rounded-full text-sm transition-all duration-300 outline-none focus-visible:ring-4 focus-visible:ring-accent-500/40 ${
    active
      ? 'bg-ink text-white dark:bg-paper dark:text-ink font-medium'
      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 hover:text-slate-900 hover:translate-x-0.5 dark:hover:bg-slate-800/70 dark:hover:text-white'
  }`;

/** The colored bar at the left edge of the active link. */
export const ActiveBar = ({ active }: { active: boolean }) => (
  <span
    aria-hidden="true"
    className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-accent-500 transition-all duration-300 ${active ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`}
  />
);

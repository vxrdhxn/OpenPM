/** Shared look of the sidebar links (app/(dashboard)/layout.tsx and NotificationsLink). */

/** Fired on window when a project is created, renamed, archived or deleted, so the sidebar follows. */
export const PROJECTS_CHANGED = 'openpm:projects-changed';

export const navLinkClass = (active: boolean) =>
  `group relative flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
    active
      ? 'bg-gradient-to-r from-indigo-50 to-violet-50 text-indigo-700 dark:from-indigo-500/15 dark:to-violet-500/10 dark:text-indigo-200 font-semibold shadow-sm ring-1 ring-indigo-100 dark:ring-indigo-500/20'
      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800/70 dark:hover:text-white'
  }`;

/** The colored bar at the left edge of the active link. */
export const ActiveBar = ({ active }: { active: boolean }) => (
  <span
    aria-hidden="true"
    className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-brand transition-all duration-300 ${active ? 'h-5 opacity-100' : 'h-0 opacity-0'}`}
  />
);

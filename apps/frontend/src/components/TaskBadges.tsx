import { statusLabel } from '@/lib/tasks';

/** Colors per status (text meets AA on its tint in both themes). */
const STATUS_TONE: Record<string, { pill: string; dot: string }> = {
  todo: { pill: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', dot: 'bg-slate-400' },
  in_progress: { pill: 'bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200', dot: 'bg-blue-500' },
  in_review: { pill: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200', dot: 'bg-amber-500' },
  done: { pill: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200', dot: 'bg-emerald-500' },
};

export const statusDot = (status: string) => (STATUS_TONE[status] ?? STATUS_TONE.todo!).dot;

/** A task's status as a small pill with a colored dot. */
export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.todo!;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.pill}`}>
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
      {statusLabel(status)}
    </span>
  );
}

const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-slate-300 dark:bg-slate-600',
  medium: 'bg-sky-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500 shadow-[0_0_0_3px_rgb(239_68_68_/_0.2)]',
};

/** A decorative dot for priority; the priority is always also written out. */
export function PriorityDot({ priority, className = '' }: { priority: string; className?: string }) {
  return <span aria-hidden="true" className={`w-2 h-2 shrink-0 rounded-full ${PRIORITY_DOT[priority] ?? PRIORITY_DOT.medium} ${className}`} />;
}

const PRIORITY_CHIP: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
  medium: 'bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  high: 'bg-orange-50 text-orange-800 dark:bg-orange-500/15 dark:text-orange-200',
  urgent: 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200',
};

/** Priority as a chip, for task cards. */
export function PriorityChip({ priority, label }: { priority: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${PRIORITY_CHIP[priority] ?? PRIORITY_CHIP.medium}`}
    >
      <PriorityDot priority={priority} className="w-1.5 h-1.5" />
      {label}
    </span>
  );
}

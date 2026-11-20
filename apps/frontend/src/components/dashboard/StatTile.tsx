'use client';

import { AlertCircle } from 'lucide-react';
import { compactNumber } from '@/lib/activity';
import { useCountUp } from '@/hooks/useCountUp';

const ACCENTS = {
  indigo: 'from-indigo-500/15 to-indigo-500/5 text-indigo-600 dark:text-indigo-300 ring-indigo-500/20',
  rose: 'from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-300 ring-rose-500/20',
  amber: 'from-amber-500/20 to-amber-500/5 text-amber-700 dark:text-amber-300 ring-amber-500/20',
  emerald: 'from-emerald-500/15 to-emerald-500/5 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20',
} as const;

const GLOWS = {
  indigo: 'bg-indigo-500',
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
} as const;

/**
 * One headline number (dataviz "stat tile"): a sentence-case label and a semibold value in the UI
 * sans with proportional figures. `critical` marks a value that needs attention: the reserved status
 * color is used only on the icon, always next to the word that says why, never on the number.
 * The number counts up on load; screen readers get the final value only.
 */
export default function StatTile({
  label,
  value,
  note,
  critical = false,
  icon,
  accent = 'indigo',
}: {
  label: string;
  value: number;
  note?: string;
  critical?: boolean;
  icon?: React.ReactNode;
  accent?: keyof typeof ACCENTS;
}) {
  const shown = useCountUp(value);
  return (
    <div className="card-interactive group relative overflow-hidden p-5">
      <div aria-hidden="true" className={`absolute -right-8 -top-8 w-28 h-28 rounded-full ${GLOWS[accent]} opacity-[0.07] blur-2xl transition-all duration-500 group-hover:opacity-20 group-hover:scale-125`} />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{label}</p>
        {icon && (
          <span aria-hidden="true" className={`icon-tile w-9 h-9 bg-gradient-to-br ring-1 ${ACCENTS[accent]} transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 [&>svg]:w-[18px] [&>svg]:h-[18px]`}>
            {icon}
          </span>
        )}
      </div>
      <p className="relative mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white tabular-nums">
        <span aria-hidden="true">{compactNumber(shown)}</span>
        <span className="sr-only">{compactNumber(value)}</span>
      </p>
      {(note || critical) && (
        <p className="relative mt-1 flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
          {critical && <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--status-critical)' }} aria-hidden="true" />}
          {critical ? 'Needs attention' : note}
        </p>
      )}
    </div>
  );
}

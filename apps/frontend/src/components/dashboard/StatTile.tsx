'use client';

import { AlertCircle } from 'lucide-react';
import { compactNumber } from '@/lib/activity';
import { useCountUp } from '@/hooks/useCountUp';

/**
 * One headline number (dataviz "stat tile"), in the home page's voice: a rule on top, a mono label
 * with its index, and the value in big display type. `critical` marks a value that needs attention:
 * the reserved status color is used only on the icon, always next to the word that says why, never
 * on the number. The number counts up on load; screen readers get the final value only. On hover a
 * red line draws along the rule.
 */
export default function StatTile({
  label,
  value,
  note,
  critical = false,
  icon,
  index,
}: {
  label: string;
  value: number;
  note?: string;
  critical?: boolean;
  icon?: React.ReactNode;
  index?: number;
}) {
  const shown = useCountUp(value);
  return (
    <div className="group relative h-full border-t border-slate-300 dark:border-slate-700 pt-4 pb-1">
      <span aria-hidden="true" className="absolute -top-px left-0 h-px w-full origin-left scale-x-0 bg-accent-500 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100" />
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-slate-600 dark:text-slate-400">
          {index !== undefined && <span aria-hidden="true">{String(index).padStart(2, '0')} · </span>}
          {label}
        </p>
        {icon && (
          <span aria-hidden="true" className="text-slate-500 transition-all duration-500 group-hover:text-accent-500 group-hover:rotate-12 [&>svg]:h-4 [&>svg]:w-4">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-5 font-display text-6xl sm:text-7xl font-medium leading-none tracking-[-0.05em] text-slate-900 dark:text-white tabular-nums transition-transform duration-500 group-hover:translate-x-1">
        <span aria-hidden="true">{compactNumber(shown)}</span>
        <span className="sr-only">{compactNumber(value)}</span>
      </p>
      {(note || critical) && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400">
          {critical && <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--status-critical)' }} aria-hidden="true" />}
          {critical ? 'Needs attention' : note}
        </p>
      )}
    </div>
  );
}

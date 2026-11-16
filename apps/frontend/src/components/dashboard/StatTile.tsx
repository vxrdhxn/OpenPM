import { AlertCircle } from 'lucide-react';
import { compactNumber } from '@/lib/activity';

/**
 * One headline number (dataviz "stat tile"): a sentence-case label and a semibold value in the UI
 * sans with proportional figures. `critical` marks a value that needs attention: the reserved status
 * color is used only on the icon, always next to the word that says why, never on the number.
 */
export default function StatTile({
  label,
  value,
  note,
  critical = false,
}: {
  label: string;
  value: number;
  note?: string;
  critical?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">{compactNumber(value)}</p>
      {(note || critical) && (
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
          {critical && <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--status-critical)' }} aria-hidden="true" />}
          {critical ? 'Needs attention' : note}
        </p>
      )}
    </div>
  );
}

'use client';

import { AlertTriangle } from 'lucide-react';
import { cloneElement, isValidElement, useId } from 'react';

/**
 * Shared page/section states and form fields, so loading, empty and error look and read the same
 * everywhere.
 */

/** Placeholder bars while a section loads. Announced once as "Loading" (the bars are decorative). */
export function LoadingBlock({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
      ))}
    </div>
  );
}

/** Something failed to load: say what, and offer a retry. */
export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-800 dark:text-red-300">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <p>{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn-secondary">
          Try again
        </button>
      )}
    </div>
  );
}

/** Nothing here yet: what this is, and (optionally) the one action that fills it. */
export function EmptyBlock({
  icon,
  title,
  children,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-6 py-10">
      {icon && <div className="text-slate-400" aria-hidden="true">{icon}</div>}
      <p className="font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      {children && <div className="max-w-sm text-sm text-slate-600 dark:text-slate-400">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * A labelled form control. The label is linked to the control (its `id`), and a hint or error is
 * linked with aria-describedby, so screen readers read all three. Pass exactly one control element.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactElement<Record<string, unknown>>;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && !error ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : children;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

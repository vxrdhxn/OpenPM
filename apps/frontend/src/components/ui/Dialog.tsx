'use client';

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * The one modal dialog. Every dialog in the app uses it, so all of them behave the same:
 * - focus moves into the dialog (to `initialFocus`, or the dialog itself) and returns to whatever
 *   opened it on close;
 * - Tab and Shift+Tab stay inside; Escape and a click on the backdrop close it;
 * - it is announced as a modal dialog, named by its title (and described by `description`);
 * - the page behind it does not scroll.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: React.ReactNode;
  description?: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
  /** Action buttons, shown in a footer bar. */
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Element to focus when the dialog opens (default: the dialog itself). */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Render the body and footer inside a <form> with this submit handler. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Extra content in the header, under the title (e.g. status chips). */
  headerExtra?: React.ReactNode;
  /** `alertdialog` for confirmations that need an answer. */
  role?: 'dialog' | 'alertdialog';
}

const WIDTH = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' } as const;

export default function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
  initialFocus,
  onSubmit,
  headerExtra,
  role = 'dialog',
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? ref.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
    // Only on open/close: re-focusing on every render would steal focus while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const body = (
    <>
      {children !== undefined && <div className="p-6 space-y-4">{children}</div>}
      {footer && (
        // Sticky, so Save stays reachable in a long dialog (the task dialog scrolls past its comments).
        <div className="sticky bottom-0 px-6 py-4 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur flex flex-wrap justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
          {footer}
        </div>
      )}
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-sm sm:p-4 animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`bg-white dark:bg-slate-900 w-full ${WIDTH[size]} max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 outline-none animate-slide-up sm:animate-scale-in`}
      >
        <div className="relative flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-brand opacity-80 sm:rounded-t-2xl rounded-t-3xl" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-lg font-bold break-words text-slate-900 dark:text-white">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {description}
              </p>
            )}
            {headerExtra}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white hover:rotate-90 transition-all duration-300 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
            aria-label="Close"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        {onSubmit ? (
          <form onSubmit={onSubmit} noValidate={false}>
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>
  );
}

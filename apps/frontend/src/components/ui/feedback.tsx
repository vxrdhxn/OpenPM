'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import Dialog from './Dialog';

/**
 * App-wide feedback: toasts (`useToast`) and confirmations (`useConfirm`). Both are provided once at
 * the root (`FeedbackProvider`), so any component can report an outcome or ask before a destructive
 * action without browser alert()/confirm() popups, which block the page and cannot be styled.
 */

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  /** Red confirm button, for deletes and other actions that lose something. */
  destructive?: boolean;
}

interface Feedback {
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<Feedback | null>(null);

const TOAST_MS = { success: 4000, info: 5000, error: 8000 } as const;

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = nextId.current++;
      // At most three on screen; the newest wins.
      setToasts((list) => [...list.slice(-2), { id, kind, message }]);
      setTimeout(() => dismiss(id), TOAST_MS[kind]);
    },
    [dismiss]
  );

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    []
  );

  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      {pending && <ConfirmDialog options={pending} onAnswer={answer} />}
      <div className="fixed z-[60] bottom-4 right-4 left-4 sm:left-auto flex flex-col items-stretch sm:items-end gap-2 pointer-events-none">
        {/* Errors interrupt (assertive); everything else is announced when the reader is idle. */}
        <div role="alert" className="contents">
          {toasts.filter((t) => t.kind === 'error').map((t) => (
            <ToastView key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
        <div role="status" className="contents">
          {toasts.filter((t) => t.kind !== 'error').map((t) => (
            <ToastView key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </FeedbackContext.Provider>
  );
}

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info } as const;
const TONE = {
  success: 'border-green-200 dark:border-green-900 text-green-800 dark:text-green-300',
  error: 'border-red-200 dark:border-red-900 text-red-800 dark:text-red-300',
  info: 'border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200',
} as const;

function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const Icon = ICON[toast.kind];
  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 w-full sm:w-96 rounded-xl border bg-white dark:bg-slate-900 shadow-lg px-4 py-3 text-sm ${TONE[toast.kind]}`}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="flex-1 text-slate-800 dark:text-slate-100">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (ok: boolean) => void }) {
  // Focus Cancel first: Enter on an unexpected dialog must not delete anything.
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      role="alertdialog"
      size="sm"
      title={options.title}
      description={options.message}
      onClose={() => onAnswer(false)}
      initialFocus={cancelRef}
      footer={
        <>
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={options.destructive ? 'btn-danger' : 'btn-compact'}
            onClick={() => onAnswer(true)}
          >
            {options.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    />
  );
}

function useFeedback(): Feedback {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useToast/useConfirm must be used inside <FeedbackProvider>');
  return ctx;
}

export const useToast = () => useFeedback().toast;
export const useConfirm = () => useFeedback().confirm;

/** The message of a caught error, or `fallback` when it has none. */
export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Shows a banner while the browser is offline (requests would fail with a network error). */
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 text-sm text-center px-4 py-2">
      You are offline. Changes will fail until the connection is back.
    </div>
  );
}

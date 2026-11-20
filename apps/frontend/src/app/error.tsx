'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw, TriangleAlert } from 'lucide-react';

/**
 * Shown when a page throws while rendering. The app shell (sidebar) stays; the user can retry the
 * page or leave. The error's details stay in the console, not on screen.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="min-h-[60vh] flex-1 flex items-center justify-center p-6">
      <div role="alert" className="max-w-md text-center animate-fade-up">
        <div aria-hidden="true" className="mx-auto mb-6 icon-tile w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500/15 to-orange-500/15 text-red-600 dark:text-red-300 ring-1 ring-red-500/20 animate-pop">
          <TriangleAlert className="w-8 h-8" />
        </div>
        <h1 className="page-title">Something went wrong</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          This page could not be shown. Try again; if it keeps happening, reload the app.
          {error.digest && <span className="block mt-2 text-xs">Reference: {error.digest}</span>}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={reset} className="btn-compact">
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            Try again
          </button>
          <Link href="/dashboard" className="btn-secondary">Go to the dashboard</Link>
        </div>
      </div>
    </div>
  );
}

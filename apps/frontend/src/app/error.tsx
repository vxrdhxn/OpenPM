'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Shown when a page throws while rendering. The app shell (sidebar) stays; the user can retry the
 * page or leave. The error's details stay in the console, not on screen.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="min-h-[60vh] flex items-center justify-center p-6">
      <div role="alert" className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          This page could not be shown. Try again; if it keeps happening, reload the app.
          {error.digest && <span className="block mt-2 text-xs">Reference: {error.digest}</span>}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={reset} className="btn-compact">Try again</button>
          <Link href="/dashboard" className="btn-secondary">Go to the dashboard</Link>
        </div>
      </div>
    </main>
  );
}

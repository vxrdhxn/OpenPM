'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Layers, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Opened from the sign-up email (docs/signup.md): finishes creating the workspace and signs its owner
 * in. The request is a POST sent by the page, so link scanners that only fetch the URL do not use up
 * the single-use link.
 */
function VerifySignup() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const [error, setError] = useState(token ? '' : 'This link is missing its code. Open the link from your email again.');
  const sent = useRef(false);

  useEffect(() => {
    // Once: the link works a single time (React runs effects twice in development).
    if (!token || sent.current) return;
    sent.current = true;
    api
      .post('/auth/verify-signup', { token })
      .then(() => router.replace('/dashboard'))
      .catch((err: Error) => setError(err.message || 'Could not finish creating your workspace.'));
  }, [token, router]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md glass-panel p-8 rounded-2xl text-center space-y-4">
        <div className="flex justify-center">
          <div className="p-3 bg-blue-500/10 rounded-2xl ring-1 ring-blue-500/20">
            <Layers className="w-8 h-8 text-blue-500" aria-hidden="true" />
          </div>
        </div>
        {error ? (
          <div role="alert" className="space-y-4">
            <h1 className="text-xl font-semibold">Could not finish signing up</h1>
            <p className="text-slate-600 dark:text-slate-300">{error}</p>
            <p className="text-sm">
              <Link href="/register" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">Sign up again</Link>
              {' · '}
              <Link href="/login" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">Sign in</Link>
            </p>
          </div>
        ) : (
          <div role="status" className="space-y-3">
            <h1 className="text-xl font-semibold">Creating your workspace…</h1>
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-500" aria-hidden="true" />
          </div>
        )}
      </div>
    </main>
  );
}

export default function VerifySignupPage() {
  return (
    <Suspense fallback={null}>
      <VerifySignup />
    </Suspense>
  );
}

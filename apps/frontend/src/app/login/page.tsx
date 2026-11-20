'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import AuthShell, { AuthCard } from '@/components/AuthShell';

/** After a workspace is deleted, its owner lands here: say what happened. */
function DeletedNotice() {
  if (useSearchParams().get('deleted') !== '1') return null;
  return (
    <p role="status" className="mb-6 p-3 rounded-xl text-sm bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 text-center animate-fade-in">
      The workspace was deleted, and everyone in it was signed out.
    </p>
  );
}

export default function Login() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await api.post('/auth/login', { email, password });
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="mb-8 animate-fade-up">
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Welcome back</h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2">Sign in to your account to continue</p>
      </div>

      <Suspense fallback={null}>
        <DeletedNotice />
      </Suspense>

      <AuthCard>
        <form onSubmit={handleLogin} className="space-y-5">
          {error && (
            <div role="alert" className="flex items-start gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300 text-sm animate-fade-up">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              {error}
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                className="input-field pl-10"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Password</label>
              <Link href="/forgot-password" className="text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="input-field pl-10 pr-11"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                // Not "Show password": the field's own label must stay the only match for "Password".
                aria-label={showPassword ? 'Hide characters' : 'Show characters'}
                aria-pressed={showPassword}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary group">
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" aria-label="Signing in" />
            ) : (
              <>
                Sign In
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      </AuthCard>

      <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400 animate-fade-in">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="text-indigo-700 dark:text-indigo-300 hover:underline font-semibold">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}

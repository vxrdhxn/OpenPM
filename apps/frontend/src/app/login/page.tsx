'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import AuthShell, { AuthCard } from '@/components/AuthShell';

type Door = 'member' | 'admin';

/** After a workspace is deleted, its owner lands here: say what happened. */
function DeletedNotice() {
  if (useSearchParams().get('deleted') !== '1') return null;
  return (
    <p role="status" className="mb-6 p-3 rounded-xl text-sm bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 text-center animate-fade-in">
      The workspace was deleted, and everyone in it was signed out.
    </p>
  );
}

/** The two ways in: as a member, or as a workspace admin (owners and admins only). Links, so each has its own URL. */
function DoorSwitch({ door }: { door: Door }) {
  const tab = (value: Door, href: string, label: string, Icon: typeof User) => {
    const active = door === value;
    return (
      <Link
        href={href}
        replace
        aria-current={active ? 'page' : undefined}
        className={`relative z-10 inline-flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium outline-none transition-colors duration-300 focus-visible:ring-4 focus-visible:ring-accent-500/40 ${
          active ? 'text-white dark:text-ink' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="Sign in as" className="relative mb-8 flex rounded-full border border-slate-300 dark:border-slate-700 p-1 animate-fade-up">
      {/* The ink pill slides to the active side. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-ink dark:bg-paper transition-transform duration-500 ease-[cubic-bezier(0.76,0,0.24,1)] ${
          door === 'admin' ? 'translate-x-full' : ''
        }`}
      />
      {tab('member', '/login', 'Member', User)}
      {tab('admin', '/login?as=admin', 'Admin', ShieldCheck)}
    </nav>
  );
}

function LoginForm() {
  const router = useRouter();
  const door: Door = useSearchParams().get('as') === 'admin' ? 'admin' : 'member';
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
      const res: { role?: string } = await api.post('/auth/login', { email, password, as: door });
      // Admins who came in through the admin door go to the admin area; everyone else to the dashboard.
      router.push(door === 'admin' && (res.role === 'owner' || res.role === 'admin') ? '/admin' : '/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <DoorSwitch door={door} />

      <div key={door} className="mb-8 animate-fade-up">
        {door === 'admin' && (
          <p className="eyebrow mb-3 flex items-center gap-2">
            <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-500 text-white">
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
            Owners and admins only
          </p>
        )}
        <h1 className="font-display text-4xl font-medium tracking-[-0.04em] text-slate-900 dark:text-white">
          {door === 'admin' ? 'Admin sign-in' : 'Welcome back'}
          <span aria-hidden="true" className="text-accent-500">.</span>
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2">
          {door === 'admin' ? 'Manage your workspace: people, access and security.' : 'Sign in to your account to continue'}
        </p>
      </div>

      <DeletedNotice />

      <AuthCard>
        <form onSubmit={handleLogin} className="space-y-5">
          {error && (
            <div role="alert" className="flex items-start gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300 text-sm animate-fade-up">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {error}
                {door === 'admin' && /not a workspace admin/.test(error) && (
                  <>
                    {' '}
                    <Link href="/login" replace className="font-semibold underline underline-offset-2">
                      Go to the member sign-in
                    </Link>
                  </>
                )}
              </span>
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
                placeholder={door === 'admin' ? 'admin@your-company.com' : 'you@example.com'}
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
                {door === 'admin' ? 'Sign in as admin' : 'Sign In'}
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      </AuthCard>

      <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400 animate-fade-in">
        {door === 'admin' ? (
          <>
            Not an admin?{' '}
            <Link href="/login" replace className="text-indigo-700 dark:text-indigo-300 hover:underline font-semibold">
              Sign in as a member
            </Link>
          </>
        ) : (
          <>
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-indigo-700 dark:text-indigo-300 hover:underline font-semibold">
              Create one
            </Link>
          </>
        )}
      </p>
    </>
  );
}

export default function Login() {
  return (
    <AuthShell>
      {/* useSearchParams() (which door, the deleted notice) needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}

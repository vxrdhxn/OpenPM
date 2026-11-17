'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { messageOf, useConfirm } from '@/components/ui/feedback';

interface InviteDetails {
  email: string;
  role: string;
  org_name: string;
  expires_at: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; invite: InviteDetails }
  | { kind: 'declined'; orgName: string };

const inputClass =
  'mt-1 block w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all dark:text-white disabled:opacity-60';

function AcceptInviteForm() {
  const token = useSearchParams().get('token');
  const router = useRouter();
  const confirm = useConfirm();

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .post('/invites/lookup', { token })
      .then((invite: InviteDetails) => !cancelled && setState({ kind: 'ready', invite }))
      .catch(() =>
        !cancelled &&
        setState({
          kind: 'invalid',
          message: 'This invitation is invalid or has expired. Ask an admin of the organization to invite you again.',
        })
      );
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/invites/accept', { token, name, password });
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation.');
      setSubmitting(false);
    }
  };

  const decline = async (invite: InviteDetails) => {
    const ok = await confirm({
      title: `Decline the invitation to ${invite.org_name}?`,
      message: 'The link stops working. The organization sees that you declined, and can invite you again later.',
      confirmLabel: 'Decline',
      destructive: true,
    });
    if (!ok) return;
    setSubmitting(true);
    setError('');
    try {
      await api.post('/invites/decline', { token });
      setState({ kind: 'declined', orgName: invite.org_name });
    } catch (err) {
      setError(messageOf(err, 'Could not decline the invitation.'));
      setSubmitting(false);
    }
  };

  if (state.kind === 'declined') {
    return (
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Invitation declined</h2>
        <p className="text-slate-500 dark:text-slate-400">You won&apos;t join {state.orgName}. You can close this page.</p>
      </div>
    );
  }

  const invalidMessage = !token
    ? 'This link is missing its invite token. Use the link from your invitation email.'
    : state.kind === 'invalid'
      ? state.message
      : null;

  if (invalidMessage) {
    return (
      <div className="text-center space-y-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Invitation unavailable</h2>
        <p className="text-slate-500 dark:text-slate-400">{invalidMessage}</p>
        <Link href="/login" className="inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500">
          Go to sign in
        </Link>
      </div>
    );
  }

  if (state.kind !== 'ready') {
    return <p className="text-center text-slate-500 p-4">Checking your invitation…</p>;
  }

  const { invite } = state;

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center">
        <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center mb-4">
          <CheckSquare className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 dark:text-white text-center">Join {invite.org_name}</h2>
        <p className="mt-2 text-center text-slate-500 dark:text-slate-400">
          You&apos;ve been invited as {invite.role === 'admin' ? 'an admin' : 'a member'}. Create your account to continue.
        </p>
      </div>

      <form className="space-y-6" onSubmit={handleSubmit}>
        {error && (
          <div role="alert" className="p-3 rounded-lg bg-red-50 text-red-600 text-sm text-center">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Email
          </label>
          <input id="email" type="email" value={invite.email} disabled className={inputClass} />
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Your name
          </label>
          <input
            id="name"
            type="text"
            required
            minLength={2}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-slate-500 mt-2">At least 8 characters.</p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
        >
          {submitting ? 'Creating your account…' : 'Accept invitation'}
        </button>
      </form>

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        Not for you?{' '}
        <button
          type="button"
          onClick={() => decline(invite)}
          disabled={submitting}
          className="font-medium text-slate-700 dark:text-slate-200 underline hover:text-red-600 disabled:opacity-50"
        >
          Decline the invitation
        </button>
      </p>
    </div>
  );
}

export default function AcceptInvite() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800">
        <Suspense fallback={<div className="text-center p-4">Loading…</div>}>
          <AcceptInviteForm />
        </Suspense>
      </div>
    </div>
  );
}

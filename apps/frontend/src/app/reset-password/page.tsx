'use client';

import { useState, Suspense } from 'react';
import { api } from '@/lib/api';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckSquare, ArrowRight } from 'lucide-react';
import Link from 'next/link';

function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing reset token.');
      return;
    }

    setStatus('loading');
    
    try {
      await api.post('/auth/reset-password', { token, password });
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message || 'An error occurred. The token may be expired.');
    }
  };

  if (status === 'success') {
    return (
      <div className="text-center space-y-6">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
          ✓
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Password Reset Complete</h2>
        <p className="text-slate-500 dark:text-slate-400">
          Your password has been successfully changed. You can now log in with your new password.
        </p>
        <button
          onClick={() => router.push('/login')}
          className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-all"
        >
          Go to Login <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center">
        <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center mb-4">
          <CheckSquare className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Create New Password</h2>
        <p className="mt-2 text-center text-slate-500 dark:text-slate-400">
          Please enter your new password below.
        </p>
      </div>

      <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
        {status === 'error' && (
          <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm text-center">
            {message}
          </div>
        )}
        
        {!token && status !== 'error' && (
          <div className="p-3 rounded-lg bg-amber-50 text-amber-700 text-sm text-center">
            No reset token found in the URL. Please use the link sent to your email.
          </div>
        )}

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            New Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!token}
            className="mt-1 block w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all dark:text-white disabled:opacity-50"
            placeholder="••••••••"
          />
          <p className="text-xs text-slate-500 mt-2">Must be at least 8 characters long.</p>
        </div>

        <button
          type="submit"
          disabled={status === 'loading' || !token}
          className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
        >
          {status === 'loading' ? 'Saving...' : 'Reset Password'}
        </button>
      </form>
      
      <div className="mt-6 text-center">
        <Link href="/login" className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
          Cancel and return to login
        </Link>
      </div>
    </div>
  );
}

export default function ResetPassword() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800">
        <Suspense fallback={<div className="text-center p-4">Loading...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Building2, Loader2, MailCheck, UserRound } from 'lucide-react';
import AuthShell, { AuthCard } from '@/components/AuthShell';

const labelClass = 'block text-sm font-medium mb-1.5 text-slate-700 dark:text-slate-300';

function SectionTitle({ icon, step, children }: { icon: React.ReactNode; step: number; children: React.ReactNode }) {
  return (
    <h2 className="md:col-span-2 flex items-center gap-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">
      <span aria-hidden="true" className="icon-tile w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-indigo-700 dark:text-indigo-300 ring-1 ring-indigo-500/20 [&>svg]:w-3.5 [&>svg]:h-3.5">
        {icon}
      </span>
      <span>
        <span className="sr-only">Step {step}: </span>
        {children}
      </span>
    </h2>
  );
}

export default function Register() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // With verify-by-email on, the API answers 202 and emails a link instead of signing in.
  const [sentTo, setSentTo] = useState('');

  const [formData, setFormData] = useState({
    org_name: '',
    org_slug: '',
    name: '',
    email: '',
    password: '',
  });
  // Until the slug is edited by hand, it follows the company name.
  const [slugTouched, setSlugTouched] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'org_name' && !slugTouched) {
        next.org_slug = value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 50);
      }
      return next;
    });
    if (name === 'org_slug') setSlugTouched(true);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await api.post('/auth/register', formData);
      if (res?.verification === 'email') {
        setSentTo(formData.email);
        return;
      }
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // Password strength, as a hint only (the API enforces the real rule: 8+ characters).
  const pw = formData.password;
  const strength = pw.length === 0 ? 0 : Math.min(4, (pw.length >= 8 ? 1 : 0) + (pw.length >= 12 ? 1 : 0) + (/[A-Z]/.test(pw) && /[a-z]/.test(pw) ? 1 : 0) + (/[^A-Za-z]/.test(pw) ? 1 : 0));
  const strengthText = ['', 'Fair', 'Good', 'Strong', 'Excellent'][strength];
  const strengthTone = ['bg-slate-200', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500', 'bg-emerald-600'][strength];

  return (
    <AuthShell wide>
      <div className="mb-8 animate-fade-up">
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Create your workspace</h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2">Set up your organization and admin account</p>
      </div>

      {sentTo ? (
        <AuthCard className="space-y-4 text-center">
          <div role="status" className="space-y-4">
            <div aria-hidden="true" className="mx-auto icon-tile w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30 animate-pop">
              <MailCheck className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Check your email</h2>
            <p className="text-slate-600 dark:text-slate-300">
              We sent a link to <strong>{sentTo}</strong>. Open it within 24 hours to finish creating your workspace.
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Nothing arrived? Check your spam folder, or{' '}
              <button type="button" className="text-indigo-700 dark:text-indigo-300 hover:underline font-medium" onClick={() => setSentTo('')}>
                sign up again
              </button>
              . If you already have an account,{' '}
              <Link href="/login" className="text-indigo-700 dark:text-indigo-300 hover:underline font-medium">
                sign in
              </Link>
              .
            </p>
          </div>
        </AuthCard>
      ) : (
        <AuthCard>
          <form onSubmit={handleRegister} className="space-y-6">
            {error && (
              <div role="alert" className="flex items-start gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300 text-sm animate-fade-up">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SectionTitle icon={<Building2 />} step={1}>Organization details</SectionTitle>

              <div>
                <label htmlFor="reg-org-name" className={labelClass}>Company Name</label>
                <input id="reg-org-name" type="text" name="org_name" autoComplete="organization" className="input-field" placeholder="Acme Corp" value={formData.org_name} onChange={handleChange} required />
              </div>

              <div>
                <label htmlFor="reg-org-slug" className={labelClass}>Workspace Slug</label>
                <input id="reg-org-slug" type="text" name="org_slug" autoComplete="off" className="input-field" placeholder="acme-corp" pattern="[a-z0-9\-]+" title="Lowercase letters, numbers, and hyphens only" value={formData.org_slug} onChange={handleChange} required />
              </div>

              <div className="md:col-span-2 h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-slate-700 to-transparent my-2" aria-hidden="true" />

              <SectionTitle icon={<UserRound />} step={2}>Admin details</SectionTitle>

              <div className="md:col-span-2">
                <label htmlFor="reg-name" className={labelClass}>Full Name</label>
                <input id="reg-name" type="text" name="name" autoComplete="name" className="input-field" placeholder="John Doe" value={formData.name} onChange={handleChange} required />
              </div>

              <div>
                <label htmlFor="reg-email" className={labelClass}>Email Address</label>
                <input id="reg-email" type="email" name="email" autoComplete="email" className="input-field" placeholder="john@acme.com" value={formData.email} onChange={handleChange} required />
              </div>

              <div>
                <label htmlFor="reg-password" className={labelClass}>Password</label>
                <input
                  id="reg-password"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  className="input-field"
                  placeholder="••••••••"
                  minLength={8}
                  value={formData.password}
                  onChange={handleChange}
                  aria-describedby="reg-password-hint"
                  required
                />
                <div aria-hidden="true" className="mt-2 flex gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <span key={i} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= strength ? strengthTone : 'bg-slate-200 dark:bg-slate-700'}`} />
                  ))}
                </div>
                <p id="reg-password-hint" className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {pw.length > 0 && pw.length < 8 ? `${8 - pw.length} more characters needed` : strengthText ? `Strength: ${strengthText}` : 'At least 8 characters'}
                </p>
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary group">
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" aria-label="Creating your workspace" />
              ) : (
                <>
                  Create Workspace
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </>
              )}
            </button>
          </form>
        </AuthCard>
      )}

      <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400 animate-fade-in">
        Already have an account?{' '}
        <Link href="/login" className="text-indigo-700 dark:text-indigo-300 hover:underline font-semibold">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Loader2, Layers } from 'lucide-react';

export default function Register() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    org_name: '',
    org_slug: '',
    name: '',
    email: '',
    password: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await api.post('/auth/register', formData);
      router.push('/projects');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="absolute inset-0 z-[-1] overflow-hidden">
        <div className="absolute top-[20%] right-[10%] w-[60%] h-[60%] rounded-full bg-blue-500/20 blur-[120px]" />
        <div className="absolute bottom-[10%] left-[5%] w-[50%] h-[50%] rounded-full bg-indigo-500/20 blur-[120px]" />
      </div>

      <div className="w-full max-w-lg my-8">
        <div className="text-center mb-8 animate-fade-in">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-blue-500/10 rounded-2xl ring-1 ring-blue-500/20">
              <Layers className="w-10 h-10 text-blue-500" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Create your workspace</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">Set up your organization and admin account</p>
        </div>

        <form onSubmit={handleRegister} className="glass-panel p-8 rounded-2xl space-y-6">
          {error && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-4 uppercase tracking-wider">Organization Details</h3>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Company Name</label>
              <input type="text" name="org_name" className="input-field" placeholder="Acme Corp" value={formData.org_name} onChange={handleChange} required />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Workspace Slug</label>
              <input type="text" name="org_slug" className="input-field" placeholder="acme-corp" pattern="^[a-z0-9-]+$" title="Lowercase letters, numbers, and hyphens only" value={formData.org_slug} onChange={handleChange} required />
            </div>

            <div className="md:col-span-2 mt-4">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-4 uppercase tracking-wider">Admin Details</h3>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Full Name</label>
              <input type="text" name="name" className="input-field" placeholder="John Doe" value={formData.name} onChange={handleChange} required />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Email Address</label>
              <input type="email" name="email" className="input-field" placeholder="john@acme.com" value={formData.email} onChange={handleChange} required />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">Password</label>
              <input type="password" name="password" className="input-field" placeholder="••••••••" minLength={8} value={formData.password} onChange={handleChange} required />
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary mt-6 flex justify-center items-center">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Workspace'}
          </button>

          <p className="text-center text-sm text-slate-500 dark:text-slate-400">
            Already have an account?{' '}
            <Link href="/login" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Trash2, UserPlus, Mail, Shield } from 'lucide-react';

export default function OrganizationSettings() {
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    fetchInvites();
  }, []);

  const fetchInvites = async () => {
    try {
      const data = await api.get('/invites');
      setInvites(data);
    } catch (err) {
      console.error('Failed to fetch invites:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setMessage({ type: '', text: '' });

    try {
      const newInvite = await api.post('/invites', { email, role });
      setMessage({ type: 'success', text: `Invite sent to ${email}!` });
      setEmail('');
      setInvites([newInvite, ...invites.filter(i => i.email !== email)]);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to send invite' });
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this invite?')) return;
    
    try {
      await api.delete(`/invites/${id}`);
      setInvites(invites.filter(i => i.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to revoke invite');
    }
  };

  if (loading) {
    return <div className="p-8">Loading organization settings...</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto w-full">
      <h1 className="text-2xl font-bold mb-6 text-slate-900 dark:text-white">Organization Settings</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Col: Invite Form */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 text-slate-900 dark:text-white flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Invite Member
            </h2>
            
            {message.text && (
              <div className={`p-3 mb-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {message.text}
              </div>
            )}

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                    placeholder="colleague@company.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Role
                </label>
                <div className="relative">
                  <Shield className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white appearance-none"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={sending}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {sending ? 'Sending...' : 'Send Invite'}
              </button>
            </form>
          </div>
        </div>

        {/* Right Col: Pending Invites List */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Pending Invites</h2>
              <p className="text-sm text-slate-500">Users who haven't accepted their invitation yet.</p>
            </div>
            
            {invites.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No pending invites found.
              </div>
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {invites.map((invite) => (
                  <li key={invite.id} className="p-4 sm:px-6 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900 dark:text-white">{invite.email}</span>
                      <span className="text-sm text-slate-500 capitalize flex items-center gap-2">
                        {invite.role} • Expires {new Date(invite.expires_at).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRevoke(invite.id)}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Revoke Invite"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        
      </div>
    </div>
  );
}

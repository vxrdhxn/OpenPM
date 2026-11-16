'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { LayoutDashboard, LogOut, CheckSquare, FolderKanban } from 'lucide-react';
import WebsocketProvider from '@/hooks/WebsocketProvider';
import NotificationsLink from '@/components/NotificationsLink';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    api.get('/auth/me').then(data => setUser(data.user)).catch(() => router.push('/login'));
  }, [router]);

  const handleLogout = async () => {
    await api.post('/auth/logout', {});
    router.push('/login');
  };

  if (!user) return null; // Or a loading spinner

  return (
    // One WebSocket for the whole signed-in app (the badge and the board share it).
    <WebsocketProvider>
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-3 font-bold text-xl text-indigo-600 dark:text-indigo-400">
            <CheckSquare className="w-6 h-6" />
            OpenPM
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <Link
            href="/dashboard"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              pathname.startsWith('/dashboard') || pathname === '/'
              ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </Link>
          <Link 
            href="/projects" 
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              pathname.includes('/projects')
              ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium' 
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <FolderKanban className="w-5 h-5" />
            Projects
          </Link>
          <NotificationsLink userId={user.user_id} active={pathname.startsWith('/notifications')} />
          <div className="pt-4 pb-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Settings
          </div>
          <Link 
            href="/settings/profile" 
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              pathname.includes('/settings/profile') 
              ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium' 
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Profile
          </Link>
          {(user?.role === 'admin' || user?.role === 'owner') && (
            <Link 
              href="/settings/organization" 
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                pathname.includes('/settings/organization') 
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium' 
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              Organization
            </Link>
          )}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate w-32 capitalize">
                {user.role}
              </span>
              <span className="text-xs text-slate-500">Your role</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
    </WebsocketProvider>
  );
}

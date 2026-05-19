'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { LayoutDashboard, LogOut, CheckSquare, Plus } from 'lucide-react';

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
            href="/projects" 
            className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              pathname.includes('/projects') 
              ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium' 
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            Projects
          </Link>
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate w-32">
                {user.role}
              </span>
              <span className="text-xs text-slate-500">Workspace Admin</span>
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
  );
}

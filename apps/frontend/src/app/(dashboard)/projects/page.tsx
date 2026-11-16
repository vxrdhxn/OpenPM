'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { buildQuery, type Page } from '@/lib/query';
import Link from 'next/link';
import { Plus, FolderKanban, Clock, Loader2, Search } from 'lucide-react';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  created_at: string;
}

const PAGE_SIZE = 24;

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // `search`, debounced
  const [status, setStatus] = useState<'' | 'active' | 'archived'>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');

  // Only the newest request may update the list: a slow response for an old search must not
  // overwrite the results of the current one.
  const requestId = useRef(0);

  // Search as you type, but not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadPage = useCallback(
    (cursor: string | null) => {
      const id = ++requestId.current;
      return api
        .get(`/projects${buildQuery({ q: query, status, limit: PAGE_SIZE, cursor })}`)
        .then((page: Page<Project>) => {
          if (id !== requestId.current) return;
          setProjects((current) => (cursor ? [...current, ...page.items] : page.items));
          setNextCursor(page.next_cursor);
          setError('');
        })
        .catch((err) => {
          if (id === requestId.current) setError(err instanceof Error ? err.message : 'Could not load projects');
        })
        .finally(() => {
          if (id !== requestId.current) return;
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [query, status]
  );

  const loadProjects = useCallback(() => loadPage(null), [loadPage]);

  const loadMore = () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    loadPage(nextCursor);
  };

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const filtered = query !== '' || status !== '';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/projects', { name: newProjectName, description: newProjectDesc });
      setIsModalOpen(false);
      setNewProjectName('');
      setNewProjectDesc('');
      loadProjects();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Projects</h1>
          <p className="text-slate-500 mt-1">Manage your team&apos;s workflows and tasks.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-colors"
        >
          <Plus className="w-5 h-5" />
          New Project
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
            className="input-field pl-9"
          />
        </div>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="input-field sm:w-44"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {error && (
        <div role="alert" className="mb-6 p-3 rounded-lg text-sm bg-red-50 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : projects.length === 0 && filtered ? (
        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl">
          <Search className="w-12 h-12 text-slate-400 mb-4" />
          <h3 className="text-lg font-medium">No matching projects</h3>
          <p className="text-slate-500 mt-1 text-center max-w-sm">Try a different search or status.</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl">
          <FolderKanban className="w-16 h-16 text-slate-400 mb-4" />
          <h3 className="text-lg font-medium">No projects yet</h3>
          <p className="text-slate-500 mt-1 text-center max-w-sm">Create your first project to start organizing tasks and collaborating with your team.</p>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="block group">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm hover:shadow-md transition-all hover:border-indigo-500/50">
                <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg text-indigo-600 dark:text-indigo-400">
                    <FolderKanban className="w-6 h-6" />
                  </div>
                  <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${p.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {p.status}
                  </span>
                </div>
                <h3 className="text-xl font-semibold mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {p.name}
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm line-clamp-2 mb-4">
                  {p.description || 'No description provided.'}
                </p>
                <div className="flex items-center text-xs text-slate-400 gap-1 mt-auto">
                  <Clock className="w-4 h-4" />
                  Created {new Date(p.created_at).toLocaleDateString()}
                </div>
              </div>
            </Link>
          ))}
        </div>
        {nextCursor && (
          <div className="flex justify-center mt-8">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 flex items-center gap-2"
            >
              {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
              Load more
            </button>
          </div>
        )}
        </>
      )}

      {/* Modal for creating project */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <form onSubmit={handleCreate} className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
            <div className="p-6 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-xl font-bold">Create New Project</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Project Name</label>
                <input 
                  type="text" 
                  className="input-field" 
                  autoFocus
                  required
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  placeholder="e.g. Website Redesign"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Description (Optional)</label>
                <textarea 
                  className="input-field min-h-[100px]" 
                  value={newProjectDesc}
                  onChange={e => setNewProjectDesc(e.target.value)}
                  placeholder="Briefly describe the project goals..."
                />
              </div>
            </div>
            <div className="p-6 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
              <button 
                type="button" 
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium shadow-sm transition-colors"
              >
                Create Project
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

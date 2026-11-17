'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { buildQuery, type Page } from '@/lib/query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, FolderKanban, Clock, Loader2, Search } from 'lucide-react';
import ProjectDialog from '@/components/ProjectDialog';
import { EmptyBlock, ErrorBlock } from '@/components/ui/states';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  created_at: string;
}

const PAGE_SIZE = 24;

function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // `search`, debounced
  const [status, setStatus] = useState<'' | 'active' | 'archived'>('');
  const router = useRouter();
  // "Create your first project" on the dashboard links here with ?new=1.
  const searchParams = useSearchParams();
  const [isModalOpen, setIsModalOpen] = useState(searchParams.get('new') === '1');
  const closeCreate = () => {
    setIsModalOpen(false);
    if (searchParams.get('new')) router.replace('/projects');
  };
  const [role, setRole] = useState('');
  useEffect(() => {
    api.get('/auth/me').then((d) => setRole(d.user.role)).catch(() => setRole(''));
  }, []);
  const canCreate = role !== '' && role !== 'viewer';

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


  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-wrap gap-4 items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Projects</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">Manage your team&apos;s workflows and tasks.</p>
        </div>
        {canCreate && (
          <button onClick={() => setIsModalOpen(true)} className="btn-compact">
            <Plus className="w-4 h-4" aria-hidden="true" />
            New project
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
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
        <div className="mb-6">
          <ErrorBlock message={error} onRetry={loadProjects} />
        </div>
      )}

      {loading ? (
        <div role="status" className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" aria-hidden="true" />
          <span className="sr-only">Loading projects</span>
        </div>
      ) : projects.length === 0 && filtered ? (
        <EmptyBlock icon={<Search className="w-10 h-10" />} title="No matching projects">
          Try a different search or status.
        </EmptyBlock>
      ) : projects.length === 0 ? (
        <EmptyBlock
          icon={<FolderKanban className="w-12 h-12" />}
          title="No projects yet"
          action={canCreate && <button onClick={() => setIsModalOpen(true)} className="btn-compact"><Plus className="w-4 h-4" aria-hidden="true" />Create a project</button>}
        >
          {canCreate ? 'A project holds a board of tasks for one piece of work.' : 'An admin or member of your organization can create one.'}
        </EmptyBlock>
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

      {isModalOpen && (
        <ProjectDialog
          onClose={closeCreate}
          onSaved={(created) => router.push(`/projects/${created.id}`)}
        />
      )}
    </div>
  );
}

// useSearchParams() needs a Suspense boundary when the page is prerendered.
export default function Projects() {
  return (
    <Suspense>
      <ProjectsPage />
    </Suspense>
  );
}

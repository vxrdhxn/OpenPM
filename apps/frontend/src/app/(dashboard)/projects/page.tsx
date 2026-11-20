'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { buildQuery, type Page } from '@/lib/query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, FolderKanban, Clock, Loader2, Search, Lock, ArrowRight } from 'lucide-react';
import { gradientFor, gradientHexFor } from '@/lib/palette';
import { tilt } from '@/lib/tilt';
import ThreeScene from '@/components/three/ThreeScene';
import PageHeader from '@/components/ui/PageHeader';
import ProjectDialog from '@/components/ProjectDialog';
import { EmptyBlock, ErrorBlock } from '@/components/ui/states';

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  visibility: 'workspace' | 'private';
  created_at: string;
}

const PAGE_SIZE = 24;

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
] as const;

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
  // The banner's 3D carousel shows the boards in view, in their own colors.
  const carousel = projects.slice(0, 7).map((p) => {
    const [from, to] = gradientHexFor(p.id);
    const name = p.name.trim();
    return { initial: [...name][0]?.toUpperCase() ?? '?', name: name.length > 18 ? `${name.slice(0, 17)}…` : name, from, to };
  });


  return (
    <div className="p-4 sm:p-8 max-w-[1400px] w-full mx-auto">
      <section className="relative mb-8 overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60">
        <div aria-hidden="true" className="absolute inset-0 bg-dots opacity-40 [mask-image:linear-gradient(to_right,black,transparent_55%)]" />
        <ThreeScene
          scene="projects"
          data={loading ? undefined : { items: carousel }}
          className="!absolute inset-y-0 right-0 hidden md:block w-[55%] pointer-events-none"
        />
        <div className="relative p-6 sm:p-8 md:min-h-[14rem] md:max-w-[52%] flex flex-col justify-center">
          <PageHeader
            className=""
            icon={<FolderKanban />}
            eyebrow="Your workspace"
            title="Projects"
            subtitle="Manage your team's workflows and tasks."
          >
            {canCreate && (
              <div className="mt-5">
                <button onClick={() => setIsModalOpen(true)} className="btn-compact">
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  New project
                </button>
              </div>
            )}
          </PageHeader>
        </div>
      </section>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-8">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
            className="input-field pl-10"
          />
        </div>
        <div role="group" aria-label="Filter by status" className="inline-flex self-start rounded-xl bg-slate-100 dark:bg-slate-800/70 p-1 ring-1 ring-slate-200 dark:ring-slate-700/60">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
              className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                status === f.value
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorBlock message={error} onRetry={loadProjects} />
        </div>
      )}

      {loading ? (
        <div role="status" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <span className="sr-only">Loading projects</span>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} aria-hidden="true" className="skeleton h-52 rounded-2xl" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
      ) : projects.length === 0 && filtered ? (
        <EmptyBlock icon={<Search />} title="No matching projects">
          Try a different search or status.
        </EmptyBlock>
      ) : projects.length === 0 ? (
        <EmptyBlock
          icon={<FolderKanban />}
          title="No projects yet"
          action={canCreate && <button onClick={() => setIsModalOpen(true)} className="btn-compact"><Plus className="w-4 h-4" aria-hidden="true" />Create a project</button>}
        >
          {canCreate ? 'A project holds a board of tasks for one piece of work.' : 'An admin or member of your organization can create one.'}
        </EmptyBlock>
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 stagger">
          {projects.map((p, i) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              style={{ '--i': i } as React.CSSProperties}
              {...tilt}
              className="card-interactive group relative flex flex-col overflow-hidden outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/40 [transform-style:preserve-3d]"
            >
              {/* Glare that follows the mouse (lib/tilt.ts sets --gx/--gy). */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_at_var(--gx,50%)_var(--gy,0%),rgba(255,255,255,0.35),transparent_45%)] dark:bg-[radial-gradient(circle_at_var(--gx,50%)_var(--gy,0%),rgba(165,180,252,0.14),transparent_45%)]"
              />
              <div aria-hidden="true" className={`relative h-20 bg-gradient-to-br ${gradientFor(p.id)} ${p.status === 'archived' ? 'grayscale opacity-70' : ''}`}>
                <div className="absolute inset-0 bg-dots opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
                <div className="absolute -right-6 -top-10 w-32 h-32 rounded-full bg-white/15 blur-xl transition-transform duration-700 group-hover:scale-150" />
              </div>
              <div className="relative flex-1 flex flex-col px-6 pb-5">
                <div className="-mt-7 mb-3 flex items-end justify-between gap-3">
                  <span
                    aria-hidden="true"
                    className={`icon-tile w-14 h-14 rounded-2xl bg-gradient-to-br ${gradientFor(p.id)} text-white font-display text-xl font-bold shadow-lg ring-4 ring-white dark:ring-slate-900 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105`}
                  >
                    {[...p.name.trim()][0]?.toUpperCase() ?? '?'}
                  </span>
                  <div className="flex items-center gap-2 pb-1">
                    {p.visibility === 'private' && (
                      <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        <Lock className="w-3 h-3" aria-hidden="true" /> Private
                      </span>
                    )}
                    <span
                      className={`chip capitalize ${
                        p.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {p.status === 'active' && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                      {p.status}
                    </span>
                  </div>
                </div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1.5 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors break-words">
                  {p.name}
                </h2>
                <p className="text-slate-600 dark:text-slate-400 text-sm line-clamp-2 mb-5">
                  {p.description || 'No description provided.'}
                </p>
                <div className="mt-auto flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    Created {new Date(p.created_at).toLocaleDateString()}
                  </span>
                  <span aria-hidden="true" className="flex items-center gap-1 font-medium text-indigo-700 dark:text-indigo-300 opacity-0 -translate-x-2 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0">
                    Open board <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        {nextCursor && (
          <div className="flex justify-center mt-10">
            <button onClick={loadMore} disabled={loadingMore} className="btn-secondary">
              {loadingMore && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
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

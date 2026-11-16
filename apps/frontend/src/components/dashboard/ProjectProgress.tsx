import Link from 'next/link';

export interface ProjectSummary {
  id: string;
  name: string;
  total: number;
  todo: number;
  in_progress: number;
  in_review: number;
  done: number;
}

/** Share done, as a whole percent. Undefined for a project without tasks (there is no ratio). */
export const percentDone = (p: Pick<ProjectSummary, 'done' | 'total'>) =>
  p.total > 0 ? Math.round((p.done / p.total) * 100) : undefined;

/**
 * Progress per project (dataviz "meter list"): name, a thin meter, and its figure per row, bars
 * aligned. The fill and its lighter same-ramp track come from --meter-fill / --meter-track, which
 * have their own dark-mode steps. The breakdown is printed as text, so nothing depends on hover.
 */
export default function ProjectProgress({ projects, activeCount }: { projects: ProjectSummary[]; activeCount: number }) {
  if (projects.length === 0) {
    return <p className="text-sm text-slate-500">No active projects yet.</p>;
  }

  return (
    <div>
      <ul className="space-y-4">
        {projects.map((p) => {
          const pct = percentDone(p);
          const breakdown = [
            p.todo && `${p.todo} to do`,
            p.in_progress && `${p.in_progress} in progress`,
            p.in_review && `${p.in_review} in review`,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={p.id}>
              <div className="flex items-baseline justify-between gap-3">
                <Link href={`/projects/${p.id}`} className="text-sm font-medium text-slate-900 dark:text-white hover:underline truncate">
                  {p.name}
                </Link>
                <span className="text-xs text-slate-600 dark:text-slate-400 shrink-0 tabular-nums">
                  {pct === undefined ? 'No tasks' : `${p.done}/${p.total} · ${pct}%`}
                </span>
              </div>
              {pct !== undefined && (
                <div
                  role="progressbar"
                  aria-label={`${p.name}: ${p.done} of ${p.total} tasks done`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  title={`${p.done} done${breakdown ? ` · ${breakdown}` : ''}`}
                  className="mt-1.5 h-2 w-full rounded-full overflow-hidden"
                  style={{ background: 'var(--meter-track)' }}
                >
                  {/* A share of 0 draws no fill at all. */}
                  {p.done > 0 && <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--meter-fill)' }} />}
                </div>
              )}
              {breakdown && <p className="mt-1 text-xs text-slate-500">{breakdown}</p>}
            </li>
          );
        })}
      </ul>
      {activeCount > projects.length && (
        <Link href="/projects" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          All {activeCount} active projects
        </Link>
      )}
    </div>
  );
}

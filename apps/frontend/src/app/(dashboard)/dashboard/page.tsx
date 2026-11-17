'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { buildQuery, type Page } from '@/lib/query';
import type { ActivityEntry } from '@/lib/activity';
import StatTile from '@/components/dashboard/StatTile';
import ProjectProgress, { type ProjectSummary } from '@/components/dashboard/ProjectProgress';
import TaskRows, { type TaskRow } from '@/components/dashboard/TaskRows';
import ActivityFeed from '@/components/dashboard/ActivityFeed';

interface Summary {
  my: { open: number; overdue: number; due_soon: number };
  projects: { active: number; recent: ProjectSummary[] };
}

const OPEN_STATUSES = ['todo', 'in_progress', 'in_review'];
const DAY = 24 * 60 * 60 * 1000;

/** Loading, loaded, or failed: each section loads on its own, so one failure doesn't blank the page. */
type Section<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; message: string };

function useSection<T>(load: () => Promise<T>): Section<T> {
  const [section, setSection] = useState<Section<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    load()
      .then((data) => live && setSection({ state: 'ready', data }))
      .catch((err) => live && setSection({ state: 'error', message: err instanceof Error ? err.message : 'Could not load' }));
    return () => {
      live = false;
    };
    // Loaded once per visit; `load` is a fresh closure each render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return section;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Body<T>({ section, children }: { section: Section<T>; children: (data: T) => React.ReactNode }) {
  if (section.state === 'loading') return <div className="h-16 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" aria-label="Loading" />;
  if (section.state === 'error') {
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {section.message}
      </p>
    );
  }
  return <>{children(section.data)}</>;
}

export default function Dashboard() {
  // "Now" for the deadline window, fixed for this visit.
  const [now] = useState(() => Date.now());

  const summary = useSection<Summary>(() => api.get('/dashboard'));
  const mine = useSection<Page<TaskRow>>(() =>
    api.get(`/tasks${buildQuery({ assignee: 'me', status: OPEN_STATUSES, sort: 'due_date', order: 'asc', limit: 8 })}`)
  );
  const upcoming = useSection<Page<TaskRow>>(() =>
    api.get(
      `/tasks${buildQuery({
        status: OPEN_STATUSES,
        due_after: new Date(now).toISOString(),
        due_before: new Date(now + 14 * DAY).toISOString(),
        sort: 'due_date',
        order: 'asc',
        limit: 8,
      })}`
    )
  );
  const recent = useSection<Page<TaskRow>>(() => api.get(`/tasks${buildQuery({ sort: 'updated_at', order: 'desc', limit: 8 })}`));
  const activity = useSection<Page<ActivityEntry>>(() => api.get('/activity?limit=15'));

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
      <p className="text-slate-600 dark:text-slate-400 mt-1 mb-6">Your work and what is happening across the organization.</p>

      {/* First run: an empty organization gets the three steps that make OpenPM useful. */}
      {summary.state === 'ready' && summary.data.projects.active === 0 && (
        <section aria-labelledby="welcome-title" className="mb-8 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 p-6">
          <h2 id="welcome-title" className="text-lg font-semibold text-slate-900 dark:text-white">Welcome to OpenPM</h2>
          <ol className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-300 list-decimal list-inside">
            <li>Create a project for a piece of work your team is doing.</li>
            <li>Add tasks to its board, then drag them across columns as work moves.</li>
            <li>Invite your teammates from Settings → Organization, and assign them tasks.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/projects?new=1" className="btn-compact">Create your first project</Link>
            <Link href="/settings/organization" className="btn-secondary">Invite teammates</Link>
          </div>
        </section>
      )}

      {/* Headline numbers (KPI row). */}
      {summary.state === 'error' ? (
        <p role="alert" className="mb-6 text-sm text-red-700 dark:text-red-400">
          {summary.message}
        </p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {summary.state === 'loading' ? (
            [0, 1, 2, 3].map((i) => <div key={i} className="h-[104px] rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)
          ) : (
            <>
              <StatTile label="My open tasks" value={summary.data.my.open} note="Assigned to you, not done" />
              <StatTile label="Overdue" value={summary.data.my.overdue} critical={summary.data.my.overdue > 0} note="Nothing overdue" />
              <StatTile label="Due in 7 days" value={summary.data.my.due_soon} note="Your tasks" />
              <StatTile label="Active projects" value={summary.data.projects.active} note="In this organization" />
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Card title="Assigned to me">
            <Body section={mine}>{(page) => <TaskRows tasks={page.items} empty="Nothing assigned to you. Enjoy the quiet." />}</Body>
          </Card>
          <Card title="Upcoming deadlines (next 14 days)">
            <Body section={upcoming}>
              {(page) => <TaskRows tasks={page.items} empty="No deadlines in the next two weeks." showAssignee />}
            </Body>
          </Card>
          <Card title="Recently updated">
            <Body section={recent}>{(page) => <TaskRows tasks={page.items} empty="No tasks yet. Create a project to get started." showAssignee />}</Body>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Project progress">
            <Body section={summary}>{(s) => <ProjectProgress projects={s.projects.recent} activeCount={s.projects.active} />}</Body>
          </Card>
          <Card title="Activity">
            <Body section={activity}>{(page) => <ActivityFeed entries={page.items} />}</Body>
          </Card>
        </div>
      </div>
    </div>
  );
}

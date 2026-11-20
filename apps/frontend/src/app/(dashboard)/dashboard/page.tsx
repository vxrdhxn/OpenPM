'use client';

import Link from 'next/link';
import ThreeScene from '@/components/three/ThreeScene';
import { useEffect, useState } from 'react';
import { Activity, AlarmClock, ArrowRight, CalendarClock, CheckCircle2, Clock3, FolderKanban, ListTodo, Sparkles, TrendingUp, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { buildQuery, type Page } from '@/lib/query';
import type { ActivityEntry } from '@/lib/activity';
import { greeting } from '@/lib/palette';
import StatTile from '@/components/dashboard/StatTile';
import ProjectProgress, { type ProjectSummary } from '@/components/dashboard/ProjectProgress';
import TaskRows, { type TaskRow } from '@/components/dashboard/TaskRows';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import PageHeader from '@/components/ui/PageHeader';
import { LoadingBlock } from '@/components/ui/states';

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

function Card({
  title,
  icon,
  action,
  children,
  index = 0,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  index?: number;
}) {
  return (
    <section className="card p-5 animate-fade-up" style={{ animationDelay: `${120 + index * 70}ms` }}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-slate-900 dark:text-white">
          <span aria-hidden="true" className="icon-tile w-8 h-8 rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 [&>svg]:w-4 [&>svg]:h-4">
            {icon}
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Body<T>({ section, children }: { section: Section<T>; children: (data: T) => React.ReactNode }) {
  if (section.state === 'loading') return <LoadingBlock rows={3} />;
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
  // "Now" for the deadline window and the greeting, fixed for this visit.
  const [now] = useState(() => Date.now());
  const [firstName, setFirstName] = useState('');
  useEffect(() => {
    api
      .get('/profile/me')
      .then((me: { name?: string }) => setFirstName(me.name?.trim().split(/\s+/)[0] ?? ''))
      .catch(() => undefined);
  }, []);

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
  const activity = useSection<Page<ActivityEntry>>(() => api.get('/activity?limit=12'));

  const today = new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const hello = `${greeting(new Date(now).getHours())}${firstName ? `, ${firstName}` : ''}`;

  return (
    <div className="p-4 sm:p-8 max-w-[1400px] w-full mx-auto">
      <PageHeader
        eyebrow={today}
        title="Dashboard"
        subtitle={
          <>
            {hello} <span aria-hidden="true">👋</span> Here is your work and what is happening across the organization.
          </>
        }
        actions={
          <Link href="/projects" className="btn-secondary">
            <FolderKanban className="w-4 h-4" aria-hidden="true" />
            Browse boards
          </Link>
        }
      />

      {/* First run: an empty organization gets the three steps that make OpenPM useful. */}
      {summary.state === 'ready' && summary.data.projects.active === 0 && (
        <section
          aria-labelledby="welcome-title"
          className="relative mb-8 overflow-hidden rounded-3xl bg-brand bg-[length:200%_200%] animate-gradient-pan p-6 sm:p-8 text-white shadow-glow"
        >
          <div aria-hidden="true" className="absolute inset-0 bg-dots opacity-20 [mask-image:linear-gradient(to_left,black,transparent)]" />
          <div aria-hidden="true" className="absolute -right-10 -bottom-16 w-64 h-64 rounded-full bg-white/10 blur-2xl animate-drift" />
          <ThreeScene scene="gem" tone="brand" className="!absolute -right-16 -top-10 hidden lg:block w-[26rem] h-[26rem]" />
          <div className="relative max-w-2xl">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/25">
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Getting started
            </p>
            <h2 id="welcome-title" className="mt-3 text-2xl sm:text-3xl font-bold">Welcome to OpenPM</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
              {[
                'Create a project for a piece of work your team is doing.',
                'Add tasks to its board, then drag them across columns as work moves.',
                'Invite your teammates from Settings → Organization, and assign them tasks.',
              ].map((step, i) => (
                <li key={i} className="flex gap-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/20 backdrop-blur">
                  <span aria-hidden="true" className="flex w-6 h-6 shrink-0 items-center justify-center rounded-full bg-white text-indigo-700 text-xs font-bold">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/projects?new=1"
                className="btn-base px-4 py-2.5 text-sm bg-white text-indigo-700 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
              >
                Create your first project
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <Link href="/settings/organization" className="btn-base px-4 py-2.5 text-sm bg-white/10 text-white ring-1 ring-white/40 hover:bg-white/20">
                <UserPlus className="w-4 h-4" aria-hidden="true" />
                Invite teammates
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Headline numbers (KPI row). */}
      {summary.state === 'error' ? (
        <p role="alert" className="mb-6 text-sm text-red-700 dark:text-red-400">
          {summary.message}
        </p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 stagger">
          {summary.state === 'loading' ? (
            [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[118px] rounded-2xl" style={{ '--i': i } as React.CSSProperties} />)
          ) : (
            <>
              <div style={{ '--i': 0 } as React.CSSProperties}>
                <StatTile label="My open tasks" value={summary.data.my.open} note="Assigned to you, not done" icon={<ListTodo />} accent="indigo" />
              </div>
              <div style={{ '--i': 1 } as React.CSSProperties}>
                <StatTile
                  label="Overdue"
                  value={summary.data.my.overdue}
                  critical={summary.data.my.overdue > 0}
                  note="Nothing overdue"
                  icon={<AlarmClock />}
                  accent="rose"
                />
              </div>
              <div style={{ '--i': 2 } as React.CSSProperties}>
                <StatTile label="Due in 7 days" value={summary.data.my.due_soon} note="Your tasks" icon={<CalendarClock />} accent="amber" />
              </div>
              <div style={{ '--i': 3 } as React.CSSProperties}>
                <StatTile label="Active projects" value={summary.data.projects.active} note="In this organization" icon={<TrendingUp />} accent="emerald" />
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <Card title="Assigned to me" icon={<CheckCircle2 />} index={0}>
            <Body section={mine}>{(page) => <TaskRows tasks={page.items} empty="Nothing assigned to you. Enjoy the quiet." />}</Body>
          </Card>
          <Card title="Upcoming deadlines (next 14 days)" icon={<CalendarClock />} index={1}>
            <Body section={upcoming}>
              {(page) => <TaskRows tasks={page.items} empty="No deadlines in the next two weeks." showAssignee />}
            </Body>
          </Card>
          <Card title="Recently updated" icon={<Clock3 />} index={2}>
            <Body section={recent}>
              {(page) => <TaskRows tasks={page.items} empty="No tasks yet. Create a project to get started." showAssignee />}
            </Body>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Project progress" icon={<TrendingUp />} index={1}>
            <Body section={summary}>{(s) => <ProjectProgress projects={s.projects.recent} activeCount={s.projects.active} />}</Body>
          </Card>
          <Card
            title="Activity"
            icon={<Activity />}
            index={2}
            action={
              <Link href="/activity" className="text-sm font-medium text-indigo-700 dark:text-indigo-300 hover:underline underline-offset-2">
                View all
              </Link>
            }
          >
            <Body section={activity}>{(page) => <ActivityFeed entries={page.items} />}</Body>
          </Card>
        </div>
      </div>
    </div>
  );
}

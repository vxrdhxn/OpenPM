'use client';

import Link from 'next/link';
import { useMe } from '@/components/me';
import ThreeScene from '@/components/three/ThreeScene';
import { useEffect, useState } from 'react';
import { Activity, AlarmClock, ArrowUpRight, CalendarClock, CheckCircle2, Clock3, ListTodo, TrendingUp, UserPlus } from 'lucide-react';
import ArrowLink from '@/components/motion/ArrowLink';
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
    <section className="group/card border-t border-slate-300 dark:border-slate-700 pt-5 animate-fade-up" style={{ animationDelay: `${150 + index * 80}ms` }}>
      <div className="flex items-baseline justify-between gap-3 mb-5">
        <h2 className="flex items-baseline gap-3 font-display text-2xl sm:text-[28px] font-medium tracking-[-0.03em] text-slate-900 dark:text-white">
          <span aria-hidden="true" className="font-mono text-xs tracking-normal text-slate-500 transition-colors group-hover/card:text-accent-600 dark:group-hover/card:text-accent-400 [&>svg]:hidden">
            {String(index + 1).padStart(2, '0')}
            {icon}
          </span>
          <span>
            {title}
            <span aria-hidden="true" className="text-accent-500">.</span>
          </span>
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
  const firstName = useMe()?.name?.trim().split(/\s+/)[0] ?? '';

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
    <div className="px-4 py-8 sm:px-10 sm:py-12 max-w-[1400px] w-full mx-auto">
      <PageHeader
        eyebrow={today}
        title="Dashboard"
        subtitle={
          <>
            {hello}. Here is your work, and what is moving across the organization.
          </>
        }
        actions={
          <ArrowLink href="/projects" variant="outline" size="sm">
            Browse boards
          </ArrowLink>
        }
      />

      {/* First run: an empty organization gets the three steps that make OpenPM useful. */}
      {summary.state === 'ready' && summary.data.projects.active === 0 && (
        <section
          aria-labelledby="welcome-title"
          className="relative mb-12 overflow-hidden rounded-[2rem] bg-ink dark:bg-slate-900 dark:ring-1 dark:ring-slate-800 px-7 py-10 sm:px-12 sm:py-14 text-white animate-fade-up"
        >
          <span aria-hidden="true" className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-accent-500 hidden lg:block" />
          <ThreeScene scene="gem" tone="brand" className="!absolute -right-10 -top-6 hidden lg:block w-[24rem] h-[24rem]" />
          <div className="relative max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-white/70">Getting started</p>
            <h2 id="welcome-title" className="mt-4 font-display text-4xl sm:text-6xl font-medium leading-[0.95] tracking-[-0.045em]">
              Welcome to OpenPM<span aria-hidden="true" className="text-accent-500">.</span>
            </h2>
            <ol className="mt-10 grid gap-6 sm:grid-cols-3">
              {[
                'Create a project for a piece of work your team is doing.',
                'Add tasks to its board, then drag them across columns as work moves.',
                'Invite your teammates from Settings → Organization, and assign them tasks.',
              ].map((step, i) => (
                <li key={i} className="border-t border-white/25 pt-4 text-white/85">
                  <span aria-hidden="true" className="block font-mono text-xs text-accent-400">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="mt-2 block">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-10 flex flex-wrap gap-3">
              <ArrowLink href="/projects?new=1" variant="light">Create your first project</ArrowLink>
              <Link href="/settings/organization" className="btn-base px-5 py-2.5 text-sm text-white border border-white/25 hover:border-white">
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10 mb-16 stagger">
          {summary.state === 'loading' ? (
            [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[150px] rounded-2xl" style={{ '--i': i } as React.CSSProperties} />)
          ) : (
            <>
              <div style={{ '--i': 0 } as React.CSSProperties}>
                <StatTile index={1} label="My open tasks" value={summary.data.my.open} note="Assigned to you, not done" icon={<ListTodo />} />
              </div>
              <div style={{ '--i': 1 } as React.CSSProperties}>
                <StatTile
                  index={2} label="Overdue"
                  value={summary.data.my.overdue}
                  critical={summary.data.my.overdue > 0}
                  note="Nothing overdue"
                  icon={<AlarmClock />}
                 
                />
              </div>
              <div style={{ '--i': 2 } as React.CSSProperties}>
                <StatTile index={3} label="Due in 7 days" value={summary.data.my.due_soon} note="Your tasks" icon={<CalendarClock />} />
              </div>
              <div style={{ '--i': 3 } as React.CSSProperties}>
                <StatTile index={4} label="Active projects" value={summary.data.projects.active} note="In this organization" icon={<TrendingUp />} />
              </div>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-x-12 gap-y-14">
        <div className="xl:col-span-2 space-y-14">
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

        <div className="space-y-14">
          <Card title="Project progress" icon={<TrendingUp />} index={3}>
            <Body section={summary}>{(s) => <ProjectProgress projects={s.projects.recent} activeCount={s.projects.active} />}</Body>
          </Card>
          <Card
            title="Activity"
            icon={<Activity />}
            index={4}
            action={
              <Link href="/activity" className="link-draw inline-flex items-center gap-1 text-sm font-medium text-slate-900 dark:text-white">
                View all <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
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

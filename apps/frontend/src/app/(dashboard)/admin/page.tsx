'use client';

import Link from 'next/link';
import { isManagerRole, useMe } from '@/components/me';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Gauge, KeyRound, Mail, Settings, ShieldAlert, ShieldCheck, Tags, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { Page } from '@/lib/query';
import { timeAgo } from '@/lib/activity';
import { describeAudit, deviceOf, isWarning, type AuditEntry } from '@/lib/audit';
import type { Member } from '@/lib/members';
import PageHeader from '@/components/ui/PageHeader';
import StatTile from '@/components/dashboard/StatTile';
import Avatar from '@/components/ui/Avatar';
import ArrowLink from '@/components/motion/ArrowLink';
import { EmptyBlock, LoadingBlock } from '@/components/ui/states';

interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at?: string;
  created_at?: string;
}

interface Overview {
  org: { name: string };
  members: Member[];
  invites: Invite[];
  security: AuditEntry[];
  failedLastWeek: number;
}

const WEEK = 7 * 24 * 60 * 60 * 1000;
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

/** A numbered chapter on a rule, like the dashboard's sections. */
function Chapter({ n, title, action, children }: { n: number; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="group/card border-t border-slate-300 dark:border-slate-700 pt-5 animate-fade-up" style={{ animationDelay: `${150 + n * 80}ms` }}>
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="flex items-baseline gap-3 font-display text-2xl sm:text-[28px] font-medium tracking-[-0.03em] text-slate-900 dark:text-white">
          <span aria-hidden="true" className="font-mono text-xs tracking-normal text-slate-500 transition-colors group-hover/card:text-accent-600 dark:group-hover/card:text-accent-400">
            {String(n).padStart(2, '0')}
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

const More = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="link-draw inline-flex items-center gap-1 text-sm font-medium text-slate-900 dark:text-white">
    {children} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
  </Link>
);

/**
 * The admin area: where owners and admins run the workspace. Headline numbers, the people in it,
 * invites waiting for an answer, the latest security events and shortcuts to every admin setting.
 * The API enforces who may read this; the page also says so plainly to anyone else.
 */
export default function AdminHome() {
  const role = useMe()?.role ?? null;
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    if (!isManagerRole(role ?? undefined)) return;
    Promise.resolve()
      .then(async () => {
        const [org, members, invites, security, failed] = await Promise.all([
          api.get('/organization'),
          api.get('/members'),
          api.get('/invites'),
          api.get('/audit?limit=8') as Promise<Page<AuditEntry>>,
          api.get('/audit?limit=100&action=auth.login_failed') as Promise<Page<AuditEntry>>,
        ]);
        const since = Date.now() - WEEK;
        if (live) {
          setData({
            org,
            members,
            invites,
            security: security.items,
            failedLastWeek: failed.items.filter((e) => new Date(e.created_at).getTime() >= since).length,
          });
        }
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Could not load the admin area'));
    return () => {
      live = false;
    };
  }, [role]);

  if (role && role !== 'owner' && role !== 'admin') {
    return (
      <div className="px-4 py-8 sm:px-10 sm:py-12 max-w-[1400px] w-full mx-auto">
        <PageHeader eyebrow="Admin" icon={<Gauge />} title="Admins only" subtitle="This area is for workspace owners and admins." />
        <EmptyBlock icon={<ShieldAlert />} title="You are signed in as a member">
          Ask an owner or admin of your workspace if you need to change something here.{' '}
          <Link href="/dashboard" className="font-medium underline underline-offset-2">Back to your dashboard</Link>
        </EmptyBlock>
      </div>
    );
  }

  const admins = data?.members.filter((m) => m.role === 'owner' || m.role === 'admin').length ?? 0;

  return (
    <div className="px-4 py-8 sm:px-10 sm:py-12 max-w-[1400px] w-full mx-auto">
      <PageHeader
        eyebrow={data ? `Admin · ${data.org.name}` : 'Admin'}
        icon={<Gauge />}
        title="Admin"
        subtitle="Run your workspace: the people in it, what they can do, and what happened."
        actions={
          <ArrowLink href="/settings/organization" size="sm">
            Invite people
          </ArrowLink>
        }
      />

      {error && (
        <p role="alert" className="mb-8 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Headline numbers. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10 mb-16 stagger">
        {!data ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[150px] rounded-2xl" style={{ '--i': i } as React.CSSProperties} />)
        ) : (
          <>
            <div style={{ '--i': 0 } as React.CSSProperties}>
              <StatTile index={1} label="Members" value={data.members.length} note="In this workspace" icon={<Users />} />
            </div>
            <div style={{ '--i': 1 } as React.CSSProperties}>
              <StatTile index={2} label="Owners & admins" value={admins} note="Can use the admin sign-in" icon={<ShieldCheck />} />
            </div>
            <div style={{ '--i': 2 } as React.CSSProperties}>
              <StatTile index={3} label="Pending invites" value={data.invites.length} note="Waiting for an answer" icon={<Mail />} />
            </div>
            <div style={{ '--i': 3 } as React.CSSProperties}>
              <StatTile
                index={4}
                label="Failed sign-ins"
                value={data.failedLastWeek}
                critical={data.failedLastWeek >= 5}
                note="Wrong passwords, last 7 days"
                icon={<KeyRound />}
              />
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-x-12 gap-y-14">
        <div className="xl:col-span-2 space-y-14">
          <Chapter n={1} title="People" action={<More href="/settings/organization">Manage people</More>}>
            {!data ? (
              <LoadingBlock rows={4} />
            ) : (
              <ul className="-mx-2 divide-y divide-slate-200 dark:divide-slate-800 stagger">
                {data.members.slice(0, 8).map((m, i) => (
                  <li key={m.id} style={{ '--i': i } as React.CSSProperties} className="flex items-center gap-3 px-2 py-3 transition-all duration-300 hover:pl-4 hover:bg-white/70 dark:hover:bg-slate-900/70">
                    <Avatar name={m.name} id={m.id} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{m.name}</p>
                      <p className="truncate text-xs text-slate-600 dark:text-slate-400">{m.email}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] ${
                        m.role === 'owner' || m.role === 'admin'
                          ? 'bg-ink text-white dark:bg-paper dark:text-ink'
                          : 'border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {ROLE_LABEL[m.role] ?? m.role}
                    </span>
                  </li>
                ))}
                {data.members.length > 8 && (
                  <li className="px-2 py-3 font-mono text-xs text-slate-600 dark:text-slate-400">+ {data.members.length - 8} more</li>
                )}
              </ul>
            )}
          </Chapter>

          <Chapter n={2} title="Recent security events" action={<More href="/settings/security">Open the security log</More>}>
            {!data ? (
              <LoadingBlock rows={4} />
            ) : data.security.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-600 dark:text-slate-400 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">Nothing recorded yet.</p>
            ) : (
              <ul className="-mx-2 divide-y divide-slate-200 dark:divide-slate-800 stagger">
                {data.security.map((e, i) => (
                  <li key={e.id} style={{ '--i': i } as React.CSSProperties} className="flex items-start gap-3 px-2 py-3">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isWarning(e.action) ? 'bg-accent-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-900 dark:text-white">
                        {isWarning(e.action) && <span className="sr-only">Warning: </span>}
                        {describeAudit(e)}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        {timeAgo(e.created_at)} · {deviceOf(e.user_agent)}
                        {e.ip ? ` · ${e.ip}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Chapter>
        </div>

        <div className="space-y-14">
          <Chapter n={3} title="Pending invites" action={<More href="/settings/organization">All invites</More>}>
            {!data ? (
              <LoadingBlock rows={2} />
            ) : data.invites.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-600 dark:text-slate-400 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">No invites waiting.</p>
            ) : (
              <ul className="-mx-2 divide-y divide-slate-200 dark:divide-slate-800">
                {data.invites.slice(0, 6).map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 px-2 py-3">
                    <span className="truncate text-sm text-slate-900 dark:text-white">{inv.email}</span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-600 dark:text-slate-400">{ROLE_LABEL[inv.role] ?? inv.role}</span>
                  </li>
                ))}
              </ul>
            )}
          </Chapter>

          <Chapter n={4} title="Shortcuts">
            <ul className="grid gap-2">
              {[
                { href: '/settings/organization', label: 'Invite people', Icon: UserPlus },
                { href: '/settings/organization', label: 'Roles and members', Icon: Users },
                { href: '/settings/organization', label: 'Labels', Icon: Tags },
                { href: '/settings/organization', label: 'Workspace settings', Icon: Settings },
                { href: '/settings/security', label: 'Security log', Icon: ShieldCheck },
              ].map(({ href, label, Icon }) => (
                <li key={label}>
                  <Link
                    href={href}
                    className="group flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 px-4 py-3 text-sm font-medium text-slate-900 dark:text-white outline-none transition-all duration-300 hover:border-slate-900 dark:hover:border-slate-300 hover:pl-5 focus-visible:ring-4 focus-visible:ring-accent-500/40"
                  >
                    <Icon className="h-4 w-4 text-slate-500 transition-colors group-hover:text-accent-500" aria-hidden="true" />
                    {label}
                    <ArrowUpRight className="ml-auto h-4 w-4 text-slate-400 transition-transform duration-500 group-hover:rotate-45" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </Chapter>
        </div>
      </div>
    </div>
  );
}

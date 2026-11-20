import Link from 'next/link';
import { ArrowUpRight, Check, CircleDot, KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import Brand from '@/components/Brand';
import ThreeScene from '@/components/three/ThreeScene';
import ArrowLink from '@/components/motion/ArrowLink';
import ThemeToggle from '@/components/motion/ThemeToggle';
import { Reveal, SplitReveal } from '@/components/motion/Reveal';
import SiteHeader from '@/components/home/SiteHeader';
import { CHAPTERS } from '@/components/home/chapters';
import Rulers from '@/components/home/Rulers';
import ScrollText from '@/components/home/ScrollText';
import BuildProgress from '@/components/home/BuildProgress';
import FeatureFan from '@/components/home/FeatureFan';
import CtaBlock from '@/components/home/CtaBlock';

export const metadata = { title: 'OpenPM · Plan closer. Ship together.' };

const PRINCIPLES = [
  { title: 'No lock-in.', text: 'Open source under AGPL-3.0. Your data lives in your own Postgres, and it leaves whenever you want.' },
  { title: 'Live by default.', text: 'Boards, comments and notifications update for everyone at once, across every server you run.' },
  { title: 'For everyone.', text: 'Keyboard first, screen-reader friendly, and checked against WCAG 2.1 AA on every build.' },
  { title: 'Built to be run.', text: 'A Helm chart, GitOps, backups, metrics and runbooks: production is part of the product.' },
];

const STEPS = [
  { title: 'A workspace.', text: 'Sign up and your organization gets its own isolated space, with you as the owner.' },
  { title: 'A board.', text: 'One project per piece of work: To Do, In Progress, In Review and Done.' },
  { title: 'A task.', text: 'A title, a priority, a due date, labels and an owner. Enough to act on, nothing more.' },
  { title: 'A teammate.', text: 'Invite people by email and pick their role, from viewer to admin.' },
  { title: 'A conversation.', text: 'Comments on the task itself, with mentions that reach the right person.' },
  { title: 'A move.', text: 'Drag the card to the next column. Everyone sees it move, live.' },
  { title: 'A nudge.', text: 'Due-date reminders and a dashboard that shows what needs you today.' },
  { title: 'Done.', text: 'The card lands in Done and the activity log remembers who did what, and when.' },
];

const STACK = ['Next.js', 'Node.js', 'PostgreSQL', 'Redis', 'WebSockets', 'S3', 'Docker', 'Kubernetes', 'Helm', 'Argo CD', 'Prometheus', 'Grafana', 'OpenAPI', 'Playwright'];

const CHANGELOG = [
  { kind: 'Release', date: 'Nov 2026', title: 'OpenPM 0.1.0, the first release.', text: 'Boards, comments, notifications, search, attachments and roles, all in one tested build.' },
  { kind: 'Platform', date: 'Nov 2026', title: 'From a laptop to Kubernetes.', text: 'Docker Compose for a quick start, a Helm chart and Argo CD for the long run.' },
  { kind: 'Access', date: 'Nov 2026', title: 'WCAG 2.1 AA, on every build.', text: 'Every page is scanned for accessibility on desktop and phone before it ships.' },
];

/** A product team's board, in miniature (decoration). */
function BoardMock() {
  const cols = [
    { t: 'To Do', c: 'bg-slate-400', cards: [['Launch post', 'High'], ['Pricing research', 'Low']] },
    { t: 'In Progress', c: 'bg-blue-500', cards: [['Onboarding flow', 'Urgent']] },
    { t: 'Done', c: 'bg-emerald-500', cards: [['Ship 0.1.0', 'High']] },
  ];
  return (
    <div className="grid h-full grid-cols-3 gap-3 p-6">
      {cols.map((col) => (
        <div key={col.t} className="rounded-xl bg-slate-100/80 dark:bg-slate-950/50 p-2.5">
          <p className="mb-2.5 flex items-center gap-1.5 px-1 text-xs font-semibold text-slate-900 dark:text-white">
            <span className={`h-1.5 w-1.5 rounded-full ${col.c}`} />
            {col.t}
          </p>
          <div className="space-y-2">
            {col.cards.map(([title, p]) => (
              <div key={title} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 shadow-soft transition-transform duration-500 group-hover:-translate-y-0.5">
                <p className="text-xs font-medium text-slate-900 dark:text-white">{title}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="rounded bg-slate-100 dark:bg-slate-700 px-1 font-mono text-[9px] uppercase text-slate-700 dark:text-slate-200">{p}</span>
                  <span className="h-4 w-4 rounded-full bg-ink dark:bg-slate-300" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** An agency's dashboard, in miniature (decoration). */
function DashboardMock() {
  const bars = [62, 80, 45, 92, 70, 54, 88];
  return (
    <div className="flex h-full flex-col gap-3 p-6">
      <div className="grid grid-cols-3 gap-3">
        {[['Open tasks', '24'], ['Overdue', '3'], ['Done this week', '41']].map(([k, v], i) => (
          <div key={k} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
            <p className="font-mono text-[9px] uppercase text-slate-600 dark:text-slate-300">{k}</p>
            <p className={`mt-1 font-display text-2xl font-medium ${i === 1 ? 'text-accent-700 dark:text-accent-400' : 'text-slate-900 dark:text-white'}`}>{v}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-1 items-end gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        {bars.map((h, i) => (
          <span
            key={i}
            className={`flex-1 origin-bottom rounded-t-md transition-transform duration-700 group-hover:scale-y-105 ${i === 3 ? 'bg-accent-500' : 'bg-slate-300 dark:bg-slate-600'}`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** An IT team's security log, in miniature (decoration). */
function AuditMock() {
  const rows: [typeof LogIn, string, string][] = [
    [LogIn, 'Signed in from a new device', '09:12'],
    [KeyRound, 'Password changed', '09:14'],
    [ShieldCheck, 'Member promoted to admin', '10:02'],
    [CircleDot, 'Session revoked', '10:05'],
  ];
  return (
    <div className="flex h-full flex-col gap-2 p-6">
      {rows.map(([Icon, text, time], i) => (
        <div
          key={text}
          className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 transition-transform duration-500 group-hover:translate-x-1"
          style={{ transitionDelay: `${i * 50}ms` }}
        >
          <span className={`flex h-7 w-7 items-center justify-center rounded-full ${i === 3 ? 'bg-accent-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white'}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 text-xs text-slate-900 dark:text-white">{text}</span>
          <span className="font-mono text-[10px] text-slate-600 dark:text-slate-300">{time}</span>
        </div>
      ))}
    </div>
  );
}

const TEAMS = [
  {
    kind: 'Product teams',
    title: 'From roadmap to release.',
    text: 'Plan the launch on one board, see who is on what, and watch the work move as it happens.',
    tags: ['Boards', 'Real-time', 'Mentions'],
    Mock: BoardMock,
  },
  {
    kind: 'Agencies',
    title: 'Every client, one calm view.',
    text: 'A board per client, private when it needs to be, and a dashboard that shows what is due this week.',
    tags: ['Private boards', 'Dashboard', 'Due dates'],
    Mock: DashboardMock,
  },
  {
    kind: 'IT & operations',
    title: 'Run it on your own servers.',
    text: 'Self-hosted, tenant-isolated and audited, with revocable sessions and a security log for every account.',
    tags: ['Self-hosted', 'Audit log', 'Kubernetes'],
    Mock: AuditMock,
  },
];

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-paper dark:bg-slate-950">
      <SiteHeader />
      <Rulers />

      <main id="main" className="relative">
        {/* Hero */}
        <section className="relative mx-auto grid min-h-[100svh] max-w-[1400px] grid-rows-[1fr_auto] px-5 sm:px-10 xl:px-[72px] pt-24 pb-10">
          <ThreeScene scene="sculpture" className="!absolute right-0 top-10 h-[46svh] w-full sm:h-[60svh] lg:w-[58%] xl:right-4" />
          <div className="relative flex items-start justify-between pt-6">
            <p className="font-mono text-xs text-slate-600 dark:text-slate-400 animate-fade-in">
              v0.1.0 · AGPL-3.0
              <br />
              Paper, ink, one red.
              <br />
              Scroll down to see how it works.
            </p>
          </div>
          <div className="relative grid items-end gap-10 lg:grid-cols-[1.7fr_1fr]">
            <SplitReveal
              as="h1"
              text="Plan closer. Ship together."
              className="font-display text-[clamp(3.2rem,7.4vw,7.25rem)] font-medium leading-[0.92] tracking-[-0.05em] text-slate-900 dark:text-white"
            />
            <Reveal delay={350} className="pb-2">
              <p className="max-w-md text-xl leading-relaxed text-slate-600 dark:text-slate-300">
                Project management you run yourself. Live boards, comments, notifications and a dashboard, in one calm place.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ArrowLink href="/register">Create a workspace</ArrowLink>
                <ArrowLink href="/#how" variant="outline">See how it works</ArrowLink>
              </div>
              <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-300 dark:border-slate-700 px-3 py-1 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inset-0 rounded-full bg-accent-500 opacity-75 animate-ping" />
                  <span className="relative h-2 w-2 rounded-full bg-accent-500" />
                </span>
                real-time · self-hosted · open source
              </p>
            </Reveal>
          </div>
        </section>

        {/* Statement and principles */}
        <section aria-labelledby="why-title" className="mx-auto max-w-[1400px] px-5 sm:px-10 xl:px-[72px] py-28 sm:py-40">
          <h2 id="why-title" className="sr-only">Why OpenPM</h2>
          <Reveal>
            <ArrowLink href="/register" size="sm">Start free</ArrowLink>
          </Reveal>
          <ScrollText
            className="mt-14 max-w-5xl font-display text-[clamp(2rem,4.6vw,4rem)] font-medium leading-[1.05] tracking-[-0.04em]"
            text="We build the tool your team opens first in the morning and closes last at night. *Fast* on the surface, *sound* underneath: live boards, tested permissions and an audit trail you can trust."
          />
          <ul className="mt-24 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {PRINCIPLES.map((p, i) => (
              <Reveal as="li" key={p.title} delay={i * 90} className="border-t border-slate-300 dark:border-slate-700 pt-5">
                <h3 className="font-display text-2xl font-medium tracking-[-0.03em] text-slate-900 dark:text-white">{p.title}</h3>
                <p className="mt-3 leading-relaxed text-slate-600 dark:text-slate-400">{p.text}</p>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* Process */}
        <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1400px] scroll-mt-24 px-5 sm:px-10 xl:px-[72px] py-24">
          <SplitReveal
            id="how-title"
            text="From an idea to done."
            className="mb-14 font-display text-[clamp(2.6rem,6vw,4.5rem)] font-medium leading-none tracking-[-0.045em] text-slate-900 dark:text-white"
          />
          <BuildProgress steps={STEPS} />
        </section>

        {/* Features */}
        <section id="features" aria-labelledby="features-title" className="mx-auto max-w-[1400px] scroll-mt-24 px-5 sm:px-10 xl:px-[72px] py-24 sm:py-36">
          <div className="mb-14 grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
            <SplitReveal
              id="features-title"
              text="Everything a team needs to ship. In one place."
              className="font-display text-[clamp(2.6rem,6vw,4.5rem)] font-medium leading-[0.98] tracking-[-0.045em] text-slate-900 dark:text-white"
            />
            <Reveal delay={200}>
              <p className="max-w-sm text-lg text-slate-600 dark:text-slate-400">Seven parts, one product. Point at a card and the fan opens to it.</p>
            </Reveal>
          </div>
          <Reveal>
            <FeatureFan />
          </Reveal>
        </section>

        {/* Stack marquee */}
        <section aria-label="Built with" className="border-y border-slate-300 dark:border-slate-800 py-6 overflow-hidden">
          <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1} className="flex shrink-0 items-center">
                {STACK.map((s) => (
                  <li key={s} className="flex items-center gap-8 pr-8 font-display text-3xl sm:text-4xl font-medium tracking-[-0.03em] text-slate-900 dark:text-white">
                    {s}
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent-500" />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </section>

        {/* For teams */}
        <section id="teams" aria-labelledby="teams-title" className="mx-auto max-w-[1400px] scroll-mt-24 px-5 sm:px-10 xl:px-[72px] py-24 sm:py-36">
          <div className="mb-14 flex flex-wrap items-end justify-between gap-6">
            <SplitReveal
              id="teams-title"
              text="Built for teams."
              className="font-display text-[clamp(2.6rem,6vw,4.5rem)] font-medium leading-none tracking-[-0.045em] text-slate-900 dark:text-white"
            />
            <Link href="/register" className="link-draw inline-flex items-center gap-1 text-lg text-slate-900 dark:text-white">
              Start yours <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="space-y-6">
            {TEAMS.map(({ kind, title, text, tags, Mock }, i) => (
              <Reveal key={kind} as="article" className="group grid overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 lg:grid-cols-[0.75fr_1fr]">
                <div className="flex flex-col p-8 sm:p-10">
                  <p className="font-mono text-xs text-slate-600 dark:text-slate-400">
                    {String(i + 1).padStart(2, '0')} · {kind}
                  </p>
                  <h3 className="mt-5 font-display text-3xl sm:text-4xl font-medium tracking-[-0.035em] text-slate-900 dark:text-white">{title}</h3>
                  <p className="mt-4 max-w-md text-lg leading-relaxed text-slate-600 dark:text-slate-400">{text}</p>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-10">
                    <ul className="flex flex-wrap gap-2">
                      {tags.map((t) => (
                        <li key={t} className="rounded-full border border-slate-300 dark:border-slate-700 px-3 py-1 text-xs text-slate-700 dark:text-slate-300">
                          {t}
                        </li>
                      ))}
                    </ul>
                    <Link href="/register" className="inline-flex items-center gap-3 text-sm font-medium text-slate-900 dark:text-white outline-none focus-visible:ring-4 focus-visible:ring-accent-500/40 rounded-full">
                      Try it<span className="sr-only"> for {kind.toLowerCase()}</span>
                      <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white dark:bg-paper dark:text-ink transition-transform duration-500 group-hover:rotate-45">
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </Link>
                  </div>
                </div>
                <div aria-hidden="true" className="relative min-h-[18rem] overflow-hidden border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-paper dark:bg-slate-950">
                  <div className="absolute inset-0 bg-dots opacity-60" />
                  <div className="relative h-full transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]">
                    <Mock />
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Changelog */}
        <section id="changelog" aria-labelledby="changelog-title" className="mx-auto max-w-[1400px] scroll-mt-24 px-5 sm:px-10 xl:px-[72px] py-24">
          <SplitReveal
            id="changelog-title"
            text="From the changelog."
            className="mb-14 font-display text-[clamp(2.6rem,6vw,4.5rem)] font-medium leading-none tracking-[-0.045em] text-slate-900 dark:text-white"
          />
          <ul className="grid gap-6 md:grid-cols-3">
            {CHANGELOG.map((c, i) => (
              <Reveal as="li" key={c.title} delay={i * 100} className="group flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-7 transition-all duration-500 hover:-translate-y-1 hover:border-slate-900 dark:hover:border-slate-300">
                <div className="flex items-center justify-between font-mono text-xs text-slate-600 dark:text-slate-400">
                  <span>
                    {String(i + 1).padStart(2, '0')} · {c.kind}
                  </span>
                  <span>{c.date}</span>
                </div>
                <div aria-hidden="true" className="my-8 flex h-28 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-950 bg-dots">
                  <span className="font-display text-6xl font-medium tracking-[-0.05em] text-slate-900 dark:text-white transition-transform duration-700 group-hover:scale-110">
                    {['0.1', 'k8s', 'AA'][i]}
                    <span className="text-accent-500">.</span>
                  </span>
                </div>
                <h3 className="font-display text-2xl font-medium tracking-[-0.03em] text-slate-900 dark:text-white">{c.title}</h3>
                <p className="mt-3 text-slate-600 dark:text-slate-400">{c.text}</p>
              </Reveal>
            ))}
          </ul>
        </section>

        <div className="mx-auto max-w-[1400px] px-5 sm:px-10 xl:px-[72px] py-24">
          <CtaBlock />
        </div>
      </main>

      <footer className="relative border-t border-slate-300 dark:border-slate-800">
        <div className="mx-auto grid max-w-[1400px] gap-12 px-5 sm:px-10 xl:px-[72px] pt-16 pb-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="max-w-sm text-slate-600 dark:text-slate-400">
              Open-source project management. Self-hosted, real-time and accessible. Made to be used every day and run for years.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-slate-700 dark:text-slate-300">
              {['Free and open source', 'Your data, your servers', 'No tracking'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-accent-700 dark:text-accent-400" aria-hidden="true" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="Chapters">
            <p className="eyebrow">Chapters</p>
            <ul className="mt-4 space-y-2">
              {CHAPTERS.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} className="link-draw text-slate-900 dark:text-white">
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="eyebrow">Settings</p>
            <div className="mt-4 flex items-center gap-3 text-slate-900 dark:text-white">
              <ThemeToggle label />
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-[1400px] overflow-hidden px-5 sm:px-10 xl:px-[72px] pb-4">
          <Reveal>
            <Brand size="xl" meter={false} />
          </Reveal>
        </div>
        <div className="mx-auto flex max-w-[1400px] flex-wrap justify-between gap-4 px-5 sm:px-10 xl:px-[72px] py-8 font-mono text-xs text-slate-600 dark:text-slate-400">
          <span>© 2026 OpenPM · AGPL-3.0</span>
          <span>Plan closer. Ship together.</span>
        </div>
      </footer>
    </div>
  );
}

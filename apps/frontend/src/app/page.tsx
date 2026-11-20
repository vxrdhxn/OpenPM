import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Bell,
  CheckCircle2,
  Scale,
  KanbanSquare,
  Lock,
  MessageSquare,
  Paperclip,
  Radio,
  Search,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Tags,
  Users,
} from 'lucide-react';
import Brand from '@/components/Brand';
import ThreeScene from '@/components/three/ThreeScene';

export const metadata = { title: 'OpenPM · Open-source project management' };

const FEATURES = [
  { icon: KanbanSquare, title: 'Kanban boards', text: 'Drag work across columns with the mouse or the keyboard, filter by anything, and undo a move.' },
  { icon: Radio, title: 'Real-time by default', text: 'Every change appears for everyone on the board the moment it happens, across servers.' },
  { icon: MessageSquare, title: 'Comments & mentions', text: 'Discuss work where it lives. @mention a teammate and they hear about it.' },
  { icon: Bell, title: 'Smart notifications', text: 'Assignments, mentions, status changes and due-date reminders, each one yours to tune.' },
  { icon: Tags, title: 'Labels & search', text: 'Color labels and an org-wide search that stays fast on tens of thousands of tasks.' },
  { icon: Paperclip, title: 'Attachments', text: 'Drop files onto a task. Stored in your own S3-compatible bucket and checked on upload.' },
  { icon: Lock, title: 'Private projects', text: 'Keep a board to the people who need it. Roles from viewer to owner, enforced everywhere.' },
  { icon: ShieldCheck, title: 'Security built in', text: 'Audit log, revocable sessions, strict CSP and tenant isolation tested against a real database.' },
  { icon: ServerCog, title: 'Kubernetes-native', text: 'A Helm chart, GitOps with Argo CD, autoscaling, backups and dashboards included.' },
];

const STEPS = [
  { title: 'Create a workspace', text: 'Sign up in seconds. Your organization gets its own isolated space.' },
  { title: 'Add a board', text: 'One project per piece of work, with To Do, In Progress, In Review and Done.' },
  { title: 'Bring the team', text: 'Invite teammates, assign tasks, and watch the board move in real time.' },
];

/** The product, in miniature: a static board preview for the hero (decoration). */
function BoardPreview() {
  const columns = [
    {
      title: 'To Do',
      dot: 'bg-slate-400',
      cards: [
        { t: 'Draft the launch announcement', p: 'High', pc: 'bg-orange-50 text-orange-800', a: 'from-rose-600 to-pink-700', i: 'JD' },
        { t: 'Research pricing pages', p: 'Low', pc: 'bg-slate-100 text-slate-700', a: 'from-cyan-700 to-blue-700', i: 'AK' },
      ],
    },
    {
      title: 'In Progress',
      dot: 'bg-blue-500',
      cards: [
        { t: 'Onboarding flow redesign', p: 'Urgent', pc: 'bg-red-50 text-red-800', a: 'from-indigo-600 to-violet-700', i: 'SM' },
        { t: 'API rate-limit dashboard', p: 'Medium', pc: 'bg-sky-50 text-sky-800', a: 'from-teal-700 to-emerald-700', i: 'RP' },
      ],
    },
    {
      title: 'Done',
      dot: 'bg-emerald-500',
      cards: [{ t: 'Ship v0.1.0 🎉', p: 'High', pc: 'bg-orange-50 text-orange-800', a: 'from-amber-700 to-orange-700', i: 'LW' }],
    },
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto max-w-5xl text-left">
      <div className="absolute -inset-x-8 -inset-y-6 rounded-[2.5rem] bg-gradient-to-r from-indigo-500/30 via-violet-500/30 to-fuchsia-500/30 blur-3xl" />
      <div className="relative rounded-3xl border border-slate-200/80 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200/80 dark:border-slate-800 px-4 py-3">
          <span className="w-3 h-3 rounded-full bg-red-400" />
          <span className="w-3 h-3 rounded-full bg-amber-400" />
          <span className="w-3 h-3 rounded-full bg-emerald-400" />
          <div className="ml-4 hidden sm:flex items-center gap-2 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-1 text-xs text-slate-500">
            <Search className="w-3 h-3" /> openpm.your-company.com/projects/launch
          </div>
          <span className="ml-auto chip bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 sm:p-6 bg-slate-50/80 dark:bg-slate-950/40">
          {columns.map((col, ci) => (
            <div key={col.title} className={`rounded-2xl bg-slate-100/80 dark:bg-slate-900/60 p-3 ring-1 ring-slate-200/80 dark:ring-slate-800 ${ci > 0 ? 'hidden sm:block' : ''}`}>
              <div className="flex items-center gap-2 px-1 pb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                {col.title}
                <span className="ml-auto rounded-full bg-white dark:bg-slate-800 px-2 text-xs text-slate-500">{col.cards.length}</span>
              </div>
              <div className="space-y-2.5">
                {col.cards.map((c, i) => (
                  <div
                    key={c.t}
                    className="rounded-xl bg-white dark:bg-slate-800 p-3 shadow-soft border border-slate-200/80 dark:border-slate-700/80 animate-float"
                    style={{ animationDelay: `${-(ci * 2 + i) * 1.3}s`, animationDuration: `${7 + i}s` }}
                  >
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{c.t}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c.pc}`}>{c.p}</span>
                      <span className={`flex w-6 h-6 items-center justify-center rounded-full bg-gradient-to-br ${c.a} text-[9px] font-bold text-white`}>{c.i}</span>
                    </div>
                  </div>
                ))}
                {ci === 1 && (
                  <div className="rounded-xl border-2 border-dashed border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/60 dark:bg-indigo-500/5 p-3 text-center text-xs font-medium text-indigo-700 dark:text-indigo-300">
                    Drop here
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* Floating toasts around the preview. */}
      <div className="hidden md:flex absolute -left-16 top-48 items-center gap-2 rounded-2xl bg-white dark:bg-slate-800 px-3 py-2.5 shadow-lift ring-1 ring-slate-200 dark:ring-slate-700 animate-float [animation-delay:-2s]">
        <span className="flex w-7 h-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><CheckCircle2 className="w-4 h-4" /></span>
        <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Moved to Done</span>
      </div>
      <div className="hidden md:flex absolute -right-8 bottom-16 items-center gap-2 rounded-2xl bg-white dark:bg-slate-800 px-3 py-2.5 shadow-lift ring-1 ring-slate-200 dark:ring-slate-700 animate-float [animation-delay:-4s]">
        <span className="flex w-7 h-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-700 text-[10px] font-bold text-white">SM</span>
        <span className="text-xs text-slate-700 dark:text-slate-200"><strong>Sam</strong> mentioned you</span>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Background */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[70rem] h-[40rem] rounded-full bg-gradient-to-r from-indigo-400/25 via-violet-400/20 to-fuchsia-400/25 blur-3xl animate-drift" />
        <div className="absolute inset-0 bg-dots opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_60%)]" />
      </div>

      <header className="relative z-10">
        <nav aria-label="Site" className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-8 py-5">
          <Link href="/" aria-label="OpenPM home" className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost">Sign in</Link>
            <Link href="/register" className="btn-compact">
              Get started <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        </nav>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-4 px-4 sm:px-8 pt-8 sm:pt-14 pb-8 lg:grid-cols-[1.05fr_1fr] lg:gap-0">
          <div className="text-center lg:text-left">
            <p className="inline-flex items-center gap-2 rounded-full border border-indigo-200 dark:border-indigo-500/30 bg-white/70 dark:bg-slate-900/60 px-4 py-1.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 shadow-sm backdrop-blur animate-fade-up">
              <Sparkles className="w-4 h-4" aria-hidden="true" /> Open source · Self-hosted · Real-time
            </p>
            <h1 className="mx-auto lg:mx-0 mt-6 max-w-3xl font-display text-4xl sm:text-6xl xl:text-7xl font-extrabold tracking-tight text-slate-900 dark:text-white animate-fade-up [animation-delay:80ms]">
              Project management your team will <span className="gradient-text">actually love</span>
            </h1>
            <p className="mx-auto lg:mx-0 mt-6 max-w-xl text-lg sm:text-xl text-slate-600 dark:text-slate-300 animate-fade-up [animation-delay:160ms]">
              Live Kanban boards, comments, notifications and a dashboard that tells you what matters. Runs on your own servers, from a laptop to Kubernetes.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center lg:justify-start gap-3 animate-fade-up [animation-delay:240ms]">
              <Link href="/register" className="btn-compact px-6 py-3 text-base group">
                Create your workspace
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
              <Link href="/login" className="btn-secondary px-6 py-3 text-base">I already have an account</Link>
            </div>
            <dl className="mt-10 flex flex-wrap justify-center lg:justify-start gap-x-8 gap-y-3 text-sm animate-fade-up [animation-delay:320ms]">
              {[
                ['Real-time', 'every change, live'],
                ['WCAG 2.1 AA', 'checked on every build'],
                ['AGPL-3.0', 'yours to run'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-display text-base font-bold text-slate-900 dark:text-white">{k}</dt>
                  <dd className="text-slate-600 dark:text-slate-400">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <ThreeScene scene="kanban" className="h-[22rem] sm:h-[30rem] lg:h-[40rem] -mx-4 sm:mx-0 lg:-mr-6" />
        </section>

        {/* The real board, in miniature */}
        <section aria-labelledby="preview-title" className="mx-auto max-w-7xl px-4 sm:px-8 pt-8 pb-16 text-center">
          <p className="eyebrow text-indigo-700 dark:text-indigo-300">See it in action</p>
          <h2 id="preview-title" className="mt-3 mb-14 font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
            A board that moves as fast as your team
          </h2>
          <BoardPreview />
        </section>

        {/* Features */}
        <section aria-labelledby="features-title" className="mx-auto max-w-7xl px-4 sm:px-8 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow text-indigo-700 dark:text-indigo-300">Everything in one place</p>
            <h2 id="features-title" className="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
              All the tools, none of the clutter
            </h2>
            <p className="mt-4 text-slate-600 dark:text-slate-400">The essentials of modern project management, built carefully and tested hard.</p>
          </div>
          <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="card-interactive group relative overflow-hidden p-6">
                <div aria-hidden="true" className="absolute -right-10 -top-10 w-32 h-32 rounded-full bg-indigo-500/0 blur-2xl transition-all duration-500 group-hover:bg-indigo-500/15" />
                <span aria-hidden="true" className="relative icon-tile w-11 h-11 bg-brand text-white shadow-glow transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                  <Icon className="w-5 h-5" />
                </span>
                <h3 className="relative mt-4 text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
                <p className="relative mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section aria-labelledby="steps-title" className="mx-auto max-w-7xl px-4 sm:px-8 py-20">
          <div className="relative overflow-hidden rounded-[2rem] bg-slate-900 dark:bg-slate-900/80 px-6 py-14 sm:px-12 text-white ring-1 ring-white/10">
            <div aria-hidden="true" className="absolute inset-0 bg-dots opacity-20" />
            <div aria-hidden="true" className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-violet-500/30 blur-3xl animate-drift" />
            <div aria-hidden="true" className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-indigo-500/30 blur-3xl animate-drift [animation-delay:-8s]" />
            <div className="relative grid gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="eyebrow text-indigo-200">Up and running in minutes</p>
                <h2 id="steps-title" className="mt-3 font-display text-3xl sm:text-4xl font-bold tracking-tight">From sign-up to a moving board</h2>
                <p className="mt-4 text-slate-300">No sales call, no setup wizard. Create a workspace and start planning.</p>
                <ul className="mt-8 flex flex-wrap gap-6 text-sm text-slate-200">
                  <li className="flex items-center gap-2"><Users className="w-4 h-4 text-indigo-300" aria-hidden="true" /> Unlimited members</li>
                  <li className="flex items-center gap-2"><Activity className="w-4 h-4 text-indigo-300" aria-hidden="true" /> Full activity history</li>
                  <li className="flex items-center gap-2"><Scale className="w-4 h-4 text-indigo-300" aria-hidden="true" /> AGPL-3.0 open source</li>
                </ul>
              </div>
              <ol className="space-y-4">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="flex gap-4 rounded-2xl bg-white/5 p-5 ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white/10">
                    <span aria-hidden="true" className="flex w-10 h-10 shrink-0 items-center justify-center rounded-xl bg-brand font-display text-lg font-bold shadow-glow">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold">{step.title}</h3>
                      <p className="mt-1 text-sm text-slate-300">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* Call to action */}
        <section className="mx-auto max-w-4xl px-4 sm:px-8 py-20 text-center">
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Ready to <span className="gradient-text">ship together</span>?
          </h2>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">Create a workspace now. It takes less than a minute.</p>
          <div className="mt-8 flex justify-center">
            <Link href="/register" className="btn-compact px-7 py-3.5 text-base group">
              Get started for free
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-slate-200/80 dark:border-slate-800">
        <div className="mx-auto flex max-w-7xl flex-col sm:flex-row items-center justify-between gap-4 px-4 sm:px-8 py-8 text-sm text-slate-600 dark:text-slate-400">
          <Brand />
          <p>Open-source project management. Self-hosted, real-time, yours.</p>
        </div>
      </footer>
    </div>
  );
}

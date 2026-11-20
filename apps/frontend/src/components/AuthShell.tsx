import Link from 'next/link';
import { CheckCircle2, KanbanSquare, Radio, ShieldCheck, Zap } from 'lucide-react';
import Brand from './Brand';
import ThreeScene from './three/ThreeScene';

const FEATURES = [
  { icon: Radio, title: 'Live boards', text: 'Every move shows up for your whole team, instantly.' },
  { icon: ShieldCheck, title: 'Yours to run', text: 'Self-hosted and open source. Your data stays with you.' },
  { icon: Zap, title: 'Fast by design', text: 'Keyboard friendly, quick to load, calm to use.' },
];

/** A miniature board that floats on the brand panel (decoration). */
function MiniBoard() {
  const card = (title: string, tone: string, width: string, delay: string) => (
    <div className="rounded-xl bg-white/95 p-3 shadow-lg animate-float" style={{ animationDelay: delay }}>
      <div className={`h-1.5 w-8 rounded-full ${tone}`} />
      <p className="mt-2 text-[11px] font-semibold text-slate-800">{title}</p>
      <div className={`mt-1.5 h-1.5 rounded-full bg-slate-200 ${width}`} />
      <div className="mt-2 flex items-center justify-between">
        <div className="h-1.5 w-6 rounded-full bg-slate-200" />
        <div className="h-4 w-4 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500" />
      </div>
    </div>
  );
  return (
    <div aria-hidden="true" className="grid grid-cols-3 gap-3 rotate-[-4deg] scale-95">
      <div className="space-y-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/20 backdrop-blur">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/80">To do</p>
        {card('Write launch post', 'bg-sky-400', 'w-3/4', '0s')}
        {card('Plan Q3 roadmap', 'bg-amber-400', 'w-1/2', '-2s')}
      </div>
      <div className="space-y-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/20 backdrop-blur mt-6">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/80">In progress</p>
        {card('Design onboarding', 'bg-fuchsia-400', 'w-2/3', '-1s')}
      </div>
      <div className="space-y-3 rounded-2xl bg-white/10 p-3 ring-1 ring-white/20 backdrop-blur mt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/80">Done</p>
        {card('Ship v1.0', 'bg-emerald-400', 'w-1/2', '-3s')}
        <div className="flex items-center gap-1.5 rounded-xl bg-emerald-400/20 px-2 py-1.5 text-[10px] font-semibold text-white ring-1 ring-emerald-300/40">
          <CheckCircle2 className="h-3 w-3" /> 12 done this week
        </div>
      </div>
    </div>
  );
}

/**
 * The frame of every signed-out page: an animated brand panel on wide screens, and the page's form
 * in a glass card on a soft gradient.
 */
export default function AuthShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
      <aside
        aria-label="About OpenPM"
        className="relative hidden lg:flex w-[46%] max-w-2xl flex-col justify-between overflow-hidden bg-brand bg-[length:200%_200%] animate-gradient-pan p-12 text-white"
      >
        <div aria-hidden="true" className="absolute inset-0 bg-dots opacity-20" />
        <div aria-hidden="true" className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-3xl animate-drift" />
        <div aria-hidden="true" className="absolute -bottom-32 -left-20 w-[28rem] h-[28rem] rounded-full bg-fuchsia-300/20 blur-3xl animate-drift [animation-delay:-7s]" />

        <Link href="/" className="relative inline-flex items-center gap-2.5 self-start rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white">
          <span className="inline-flex w-10 h-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur" aria-hidden="true">
            <KanbanSquare className="w-5 h-5" />
          </span>
          <span className="font-display text-2xl font-extrabold tracking-tight">OpenPM</span>
        </Link>

        <div className="relative">
          <ThreeScene
            scene="gem"
            tone="brand"
            className="-mx-12 -mt-6 h-[19rem] xl:h-[23rem]"
            fallback={
              <div className="mb-10">
                <MiniBoard />
              </div>
            }
          />
          <h2 className="font-display text-4xl xl:text-5xl font-extrabold leading-[1.1] tracking-tight">
            Plan it. Track it.
            <br />
            <span className="text-white/80">Ship it together.</span>
          </h2>
          <p className="mt-4 max-w-md text-lg text-white/90">The open-source project management platform your team will actually enjoy using.</p>
        </div>

        <ul className="relative grid gap-4 xl:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/20 backdrop-blur">
              <Icon className="w-5 h-5" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs text-white/90">{text}</p>
            </li>
          ))}
        </ul>
      </aside>

      <main className="relative flex-1 flex items-center justify-center overflow-hidden p-4 sm:p-8">
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-[30%] -right-[10%] w-[60%] h-[60%] rounded-full bg-indigo-400/20 dark:bg-indigo-500/15 blur-[120px] animate-drift" />
          <div className="absolute -bottom-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-fuchsia-400/15 dark:bg-fuchsia-500/10 blur-[120px] animate-drift [animation-delay:-9s]" />
          <div className="absolute inset-0 bg-dots opacity-50 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        </div>
        <div className={`relative w-full ${wide ? 'max-w-lg' : 'max-w-md'} my-8`}>
          <div className="lg:hidden flex justify-center mb-8 animate-fade-in">
            <Link href="/" aria-label="OpenPM home" className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <Brand size="lg" />
            </Link>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** The card a signed-out page's form sits in. */
export function AuthCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`glass-panel rounded-3xl p-6 sm:p-8 animate-scale-in ${className}`}>{children}</div>;
}

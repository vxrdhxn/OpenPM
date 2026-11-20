import Link from 'next/link';
import { Compass } from 'lucide-react';
import Brand from '@/components/Brand';
import ThreeScene from '@/components/three/ThreeScene';

export const metadata = { title: 'Page not found · OpenPM' };

export default function NotFound() {
  return (
    <main className="relative min-h-screen flex items-center justify-center overflow-hidden p-6 bg-slate-50 dark:bg-slate-950">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[40rem] h-[40rem] rounded-full bg-gradient-to-r from-indigo-400/20 via-violet-400/15 to-fuchsia-400/20 blur-3xl animate-drift" />
        <div className="absolute inset-0 bg-dots opacity-50 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      </div>
      <div className="relative max-w-md text-center animate-fade-up">
        <div className="flex justify-center mb-10">
          <Brand />
        </div>
        <ThreeScene
          scene="planet"
          className="-mx-24 -mt-6 -mb-4 h-72 sm:h-80"
          fallback={
            <div aria-hidden="true" className="mx-auto mb-6 icon-tile w-14 h-14 rounded-2xl bg-white dark:bg-slate-900 shadow-lift ring-1 ring-slate-200 dark:ring-slate-700 text-indigo-600 dark:text-indigo-300 animate-float">
              <Compass className="w-7 h-7" />
            </div>
          }
        />
        <p aria-hidden="true" className="font-display text-7xl font-extrabold tracking-tighter gradient-text select-none">404</p>
        <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">404</p>
        <h1 className="mt-2 page-title">Page not found</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">The page you are looking for does not exist or has moved.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/dashboard" className="btn-compact">Go to the dashboard</Link>
          <Link href="/projects" className="btn-secondary">Projects</Link>
        </div>
      </div>
    </main>
  );
}

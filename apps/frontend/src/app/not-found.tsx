import Link from 'next/link';

export const metadata = { title: 'Page not found · OpenPM' };

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">404</p>
        <h1 className="mt-2 text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">The page you are looking for does not exist or has moved.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/dashboard" className="btn-compact">Go to the dashboard</Link>
          <Link href="/projects" className="btn-secondary">Projects</Link>
        </div>
      </div>
    </main>
  );
}

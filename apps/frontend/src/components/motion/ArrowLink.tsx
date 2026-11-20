import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

/**
 * The site's call-to-action: a pill with a round arrow badge. On hover the arrow flies out to the top
 * right and a fresh one slides in from the bottom left.
 */
export default function ArrowLink({
  href,
  children,
  variant = 'ink',
  size = 'md',
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'ink' | 'outline' | 'light';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const shell = {
    ink: 'bg-ink text-white hover:bg-black dark:bg-paper dark:text-ink dark:hover:bg-white',
    outline: 'border border-slate-300 text-slate-900 hover:border-slate-900 dark:border-slate-700 dark:text-white dark:hover:border-slate-300',
    light: 'border border-white/25 text-white hover:border-white',
  }[variant];
  const badge = {
    ink: 'bg-accent-500 text-white',
    outline: 'bg-slate-200 text-slate-900 group-hover:bg-accent-500 group-hover:text-white dark:bg-slate-800 dark:text-white',
    light: 'bg-accent-500 text-white',
  }[variant];
  const pad = size === 'sm' ? 'pl-4 pr-1 py-1 text-sm gap-2.5' : 'pl-6 pr-1.5 py-1.5 text-[15px] gap-4';
  const dot = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  return (
    <Link
      href={href}
      className={`group inline-flex items-center rounded-full font-medium transition-all duration-300 outline-none focus-visible:ring-4 focus-visible:ring-accent-500/40 active:scale-[0.97] ${shell} ${pad} ${className}`}
    >
      <span>{children}</span>
      <span aria-hidden="true" className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full transition-colors duration-300 ${badge} ${dot}`}>
        <ArrowUpRight className="h-4 w-4 transition-transform duration-500 ease-[cubic-bezier(0.76,0,0.24,1)] group-hover:translate-x-6 group-hover:-translate-y-6" />
        <ArrowUpRight className="absolute h-4 w-4 -translate-x-6 translate-y-6 transition-transform duration-500 ease-[cubic-bezier(0.76,0,0.24,1)] group-hover:translate-x-0 group-hover:translate-y-0" />
      </span>
    </Link>
  );
}

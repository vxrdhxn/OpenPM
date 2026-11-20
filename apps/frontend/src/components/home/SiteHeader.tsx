'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/motion/ThemeToggle';
import ArrowLink from '@/components/motion/ArrowLink';
import { CHAPTERS } from './chapters';

/** X-ray: outlines every element on the page and lays a grid over it, to show how it is built. */
function XRayToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (on) root.setAttribute('data-xray', '');
    else root.removeAttribute('data-xray');
    return () => root.removeAttribute('data-xray');
  }, [on]);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setOn((v) => !v)}
      className={`hidden sm:inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-4 focus-visible:ring-accent-500/40 ${
        on ? 'bg-accent-500 text-white' : 'text-slate-900 hover:bg-slate-200/70 dark:text-white dark:hover:bg-slate-800'
      }`}
    >
      <ScanSearch className="h-4 w-4" aria-hidden="true" />
      X-ray
    </button>
  );
}

/**
 * The marketing header: the wordmark, X-ray, the theme switch, sign in, a call to action and a menu
 * that opens a full-screen list of chapters. It gains a paper backdrop once the page scrolls.
 */
export default function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const button = menuButton.current;
    firstLink.current?.focus();
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
      button?.focus();
    };
  }, [open]);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-[60] transition-all duration-500 ${
          open ? 'border-b border-transparent' : scrolled ? 'bg-paper/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200/70 dark:border-slate-800/70' : 'border-b border-transparent'
        }`}
      >
        <nav aria-label="Site" className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-5 sm:px-10 xl:px-[72px] py-4">
          <Link
            href="/"
            aria-label="OpenPM home"
            tabIndex={open ? -1 : undefined}
            className={`rounded-lg outline-none transition-opacity duration-300 focus-visible:ring-4 focus-visible:ring-accent-500/40 ${open ? 'pointer-events-none opacity-0' : ''}`}
          >
            <Brand />
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-3">
            {/* While the menu is open only its close button stays: the rest is behind the menu. */}
            <div inert={open} className={`flex items-center gap-1.5 sm:gap-3 transition-opacity duration-300 ${open ? 'pointer-events-none opacity-0' : ''}`}>
            <XRayToggle />
            <ThemeToggle />
            <Link href="/login" className="link-draw hidden md:inline px-2 py-1 text-sm text-slate-900 dark:text-white">
              Sign in
            </Link>
            <ArrowLink href="/register" size="sm" className="hidden sm:inline-flex">
              Get started
            </ArrowLink>
            </div>
            <button
              ref={menuButton}
              type="button"
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full outline-none transition-all duration-300 hover:scale-105 focus-visible:ring-4 focus-visible:ring-accent-500/40 ${
                open ? 'bg-paper text-ink dark:bg-ink dark:text-white' : 'bg-ink text-white dark:bg-paper dark:text-ink'
              }`}
            >
              <span aria-hidden="true" className="relative block h-3 w-4">
                <span className={`absolute left-0 h-[1.5px] w-4 rounded bg-current transition-all duration-500 ${open ? 'top-1.5 rotate-45' : 'top-0.5'}`} />
                <span className={`absolute left-0 h-[1.5px] w-4 rounded bg-current transition-all duration-500 ${open ? 'top-1.5 -rotate-45' : 'top-2.5'}`} />
              </span>
            </button>
          </div>
        </nav>
      </header>

      {/* The full-screen menu: chapters rise in one after another. */}
      <div
        id="site-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        hidden={!open}
        className="fixed inset-0 z-[55] bg-ink text-white dark:bg-paper dark:text-ink animate-[menu-in_0.6s_cubic-bezier(0.76,0,0.24,1)_both]"
      >
        <div className="mx-auto flex h-full max-w-[1400px] flex-col justify-between px-5 sm:px-10 xl:px-[72px] pt-28 pb-10">
          <ol className="space-y-1 sm:space-y-2">
            {CHAPTERS.map((c, i) => (
              <li key={c.href} className="overflow-hidden">
                <Link
                  ref={i === 0 ? firstLink : undefined}
                  href={c.href}
                  onClick={() => setOpen(false)}
                  className="group flex items-baseline gap-5 outline-none focus-visible:text-accent-400 animate-[menu-item_0.8s_cubic-bezier(0.22,1,0.36,1)_both]"
                  style={{ animationDelay: `${200 + i * 60}ms` }}
                >
                  <span className="font-mono text-xs text-white/50 dark:text-ink/50">0{i + 1}</span>
                  <span className="font-display text-5xl sm:text-7xl font-medium tracking-[-0.04em] transition-transform duration-500 group-hover:translate-x-4 group-hover:text-accent-400 dark:group-hover:text-accent-600">
                    {c.label}
                    <span className="text-accent-500">.</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-xs text-white/60 dark:text-ink/60">
            <span>Open source · AGPL-3.0</span>
            <span>Self-hosted · Real-time · Accessible</span>
          </div>
        </div>
      </div>
    </>
  );
}

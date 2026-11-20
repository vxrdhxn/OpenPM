'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, Bell, KanbanSquare, MessageSquare, Paperclip, Radio, Search, ShieldCheck } from 'lucide-react';

const FEATURES = [
  { icon: KanbanSquare, title: 'Kanban boards', tag: 'Drag work across four columns, with the mouse or the keyboard.', note: 'Undo included' },
  { icon: Radio, title: 'Real-time', tag: 'Every move appears for everyone on the board, the moment it happens.', note: 'WebSockets' },
  { icon: MessageSquare, title: 'Comments & mentions', tag: 'Talk where the work lives. Mention a teammate and they hear about it.', note: 'Threads per task' },
  { icon: Bell, title: 'Notifications', tag: 'Assignments, mentions, status changes and due dates, each one yours to tune.', note: 'In-app + email' },
  { icon: Search, title: 'Search & labels', tag: 'Colour labels and a search that stays fast on tens of thousands of tasks.', note: 'Full-text' },
  { icon: Paperclip, title: 'Attachments', tag: 'Drop files onto a task. Stored in your own S3-compatible bucket.', note: 'Checked on upload' },
  { icon: ShieldCheck, title: 'Roles & audit', tag: 'Viewer to owner, private boards, an audit log and revocable sessions.', note: 'Tenant-isolated' },
];

/**
 * The features as a fan of cards: one is open, the others stand on edge showing their number and
 * name. The fan gives way to wherever you point (hover or keyboard focus). On phones it is a list.
 */
export default function FeatureFan() {
  const [active, setActive] = useState(0);
  return (
    <ul className="flex flex-col gap-3 md:h-[30rem] md:flex-row">
      {FEATURES.map(({ icon: Icon, title, tag, note }, i) => {
        const open = i === active;
        return (
          <li
            key={title}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            className={`group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 transition-[flex-grow,background-color,border-color] duration-700 ease-[cubic-bezier(0.76,0,0.24,1)] md:min-w-0 ${
              open ? 'md:grow-[5] border-slate-300 dark:border-slate-700' : 'md:grow'
            } md:basis-0`}
          >
            {/* Dot grid and a big outline icon: the card's picture. */}
            <div aria-hidden="true" className="absolute inset-0 bg-dots opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
            <Icon
              aria-hidden="true"
              strokeWidth={0.6}
              className={`absolute right-6 top-6 h-40 w-40 text-slate-300 dark:text-slate-700 transition-all duration-700 ${
                open ? 'opacity-100 md:scale-100' : 'md:opacity-0 md:scale-75'
              }`}
            />
            <span aria-hidden="true" className={`absolute right-8 top-8 h-3 w-3 rounded-full bg-accent-500 transition-all duration-700 ${open ? 'opacity-100' : 'md:opacity-0'}`} />

            <div className="relative flex h-full flex-col p-6">
              <span className="font-mono text-xs text-slate-500">{String(i + 1).padStart(2, '0')}</span>

              {/* Closed (wide screens): the name stands on edge at the bottom. */}
              <span
                aria-hidden="true"
                className={`hidden md:block absolute bottom-6 left-6 origin-bottom-left translate-x-[1.1em] -rotate-90 whitespace-nowrap font-display text-2xl font-medium tracking-[-0.03em] text-slate-900 dark:text-white transition-opacity duration-500 ${
                  open ? 'opacity-0' : 'opacity-100'
                }`}
              >
                {title}
              </span>

              <div className={`mt-auto transition-all duration-700 ${open ? 'opacity-100 translate-y-0' : 'md:pointer-events-none md:opacity-0 md:translate-y-4'}`}>
                <h3 className="font-display text-3xl font-medium tracking-[-0.03em] text-slate-900 dark:text-white md:whitespace-nowrap">{title}</h3>
                <p className="mt-2 max-w-sm text-slate-600 dark:text-slate-400">{tag}</p>
                <div className="mt-5 flex flex-wrap items-center gap-5">
                  <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{note}</span>
                  <Link href="/register" className="link-draw inline-flex items-center gap-1 text-sm font-medium text-slate-900 dark:text-white outline-none focus-visible:ring-4 focus-visible:ring-accent-500/40 rounded">
                    Try it <span className="sr-only">: {title}</span>
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { BellRing, ChevronUp, Loader2, LogOut, User } from 'lucide-react';
import { initials, menuFocusTarget } from '@/lib/menu';

export interface AccountMenuUser {
  name: string;
  email: string;
  role: string;
}

interface Props {
  me: AccountMenuUser;
  onLogout: () => void;
  loggingOut: boolean;
}

const itemClass =
  'flex w-full items-center gap-3 px-3 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus:bg-slate-100 dark:focus:bg-slate-800 outline-none';

/**
 * The signed-in person at the bottom of the sidebar: a button that opens a menu with their profile,
 * notification settings and sign out. Follows the WAI-ARIA menu button pattern: Enter, Space or the
 * arrow keys open it, arrows/Home/End move between items, Escape closes it and returns focus to the
 * button, Tab or a click outside closes it.
 */
export default function AccountMenu({ me, onLogout, loggingOut }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // Which item to focus when the menu opens: first (Enter, Space, ArrowDown) or last (ArrowUp).
  const [startAt, setStartAt] = useState<'first' | 'last'>('first');

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  // On open: focus an item, and close on a click outside.
  useEffect(() => {
    if (!open) return;
    const list = items();
    (startAt === 'last' ? list[list.length - 1] : list[0])?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, startAt]);

  const openWith = (at: 'first' | 'last') => {
    setStartAt(at);
    setOpen(true);
  };

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openWith(e.key === 'ArrowUp' ? 'last' : 'first');
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Only the menu closes, not the phone drawer around it.
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    const list = items();
    const next = menuFocusTarget(e.key, list.indexOf(document.activeElement as HTMLElement), list.length);
    if (next !== null) {
      e.preventDefault();
      list[next]?.focus();
    }
  };

  return (
    <div className="relative p-4 border-t border-slate-200 dark:border-slate-800">
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute bottom-full left-4 right-4 mb-2 z-50 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1"
        >
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{me.name}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 truncate">{me.email}</p>
          </div>
          <Link href="/settings/profile" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => setOpen(false)}>
            <User className="w-4 h-4" aria-hidden="true" />
            Profile
          </Link>
          <Link href="/settings/notifications" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => setOpen(false)}>
            <BellRing className="w-4 h-4" aria-hidden="true" />
            Notification settings
          </Link>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={loggingOut}
            onClick={onLogout}
            className={`${itemClass} border-t border-slate-200 dark:border-slate-800 text-red-700 dark:text-red-400`}
          >
            {loggingOut ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <LogOut className="w-4 h-4" aria-hidden="true" />}
            Sign out
          </button>
        </div>
      )}

      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openWith('first'))}
        onKeyDown={onButtonKeyDown}
        className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 text-sm font-semibold"
        >
          {initials(me.name)}
        </span>
        {/* The accessible name is the visible text ("Account: <name> <role>"), so speech users can say what they see. */}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
            <span className="sr-only">Account: </span>
            {me.name}
          </span>
          <span className="block text-xs text-slate-600 dark:text-slate-400 truncate capitalize">{me.role}</span>
        </span>
        <ChevronUp className={`w-4 h-4 text-slate-500 transition-transform ${open ? '' : 'rotate-180'}`} aria-hidden="true" />
      </button>
    </div>
  );
}

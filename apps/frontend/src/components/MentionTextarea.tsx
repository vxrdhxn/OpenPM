'use client';

import { useId, useRef, useState } from 'react';
import { activeMentionQuery, insertMention, suggestMembers, type Mentionable } from '@/lib/mentions';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Called when someone is picked from the suggestions. */
  onMention: (member: Mentionable) => void;
  members: Mentionable[];
  selfId?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
}

/**
 * A textarea with "@" autocomplete over the organization's members (a combobox: arrows move, Enter or
 * Tab picks, Escape closes the list without closing the dialog).
 */
export default function MentionTextarea({ value, onChange, onMention, members, selfId, onKeyDown, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const mention = activeMentionQuery(value, caret);
  const suggestions = mention && mention.start !== dismissedAt ? suggestMembers(members, mention.query, selfId) : [];
  const open = suggestions.length > 0;
  const highlighted = Math.min(active, suggestions.length - 1);

  const track = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);

  const pick = (member: Mentionable) => {
    if (!mention) return;
    const next = insertMention(value, mention.start, caret, member.name);
    onChange(next.text);
    onMention(member);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const keys = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((highlighted + step + suggestions.length) % suggestions.length);
        return;
      }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(suggestions[highlighted]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // close the list, not the dialog
        setDismissedAt(mention!.start);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        {...rest}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${highlighted}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target);
          setActive(0);
        }}
        onSelect={(e) => track(e.currentTarget)}
        onKeyDown={keys}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className="absolute left-0 z-10 mt-1 w-64 max-w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg py-1"
        >
          {suggestions.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlighted}
              // mousedown, not click: keeps focus in the textarea.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              className={`px-3 py-1.5 text-sm cursor-pointer ${i === highlighted ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200' : 'text-slate-700 dark:text-slate-200'}`}
            >
              {m.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

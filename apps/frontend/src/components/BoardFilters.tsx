'use client';

import { Search, X } from 'lucide-react';
import type { Member } from '@/lib/members';
import type { Label } from '@/lib/labels';

export interface BoardFilterValues {
  q: string;
  priority: '' | 'low' | 'medium' | 'high' | 'urgent';
  /** '' = anyone, 'me', 'none' = unassigned, or a member id. */
  assignee: string;
  /** '' = any, or a label id. */
  label: string;
}

export const EMPTY_BOARD_FILTERS: BoardFilterValues = { q: '', priority: '', assignee: '', label: '' };

export const isFiltering = (f: BoardFilterValues) =>
  f.q.trim() !== '' || f.priority !== '' || f.assignee !== '' || f.label !== '';

/** Search, priority and assignee filters above the board. */
export default function BoardFilters({
  value,
  onChange,
  members,
  labels,
}: {
  value: BoardFilterValues;
  onChange: (next: BoardFilterValues) => void;
  members: Member[];
  labels: Label[];
}) {
  const set = (patch: Partial<BoardFilterValues>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 sm:px-8 pt-4">
      <div className="relative w-64">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search tasks"
          placeholder="Search tasks"
          value={value.q}
          maxLength={100}
          onChange={(e) => set({ q: e.target.value })}
          className="input-field pl-10"
        />
      </div>

      <select
        aria-label="Filter by priority"
        value={value.priority}
        onChange={(e) => set({ priority: e.target.value as BoardFilterValues['priority'] })}
        className="input-field w-40"
      >
        <option value="">Any priority</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>

      <select
        aria-label="Filter by assignee"
        value={value.assignee}
        onChange={(e) => set({ assignee: e.target.value })}
        className="input-field w-48"
      >
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      {labels.length > 0 && (
        <select
          aria-label="Filter by label"
          value={value.label}
          onChange={(e) => set({ label: e.target.value })}
          className="input-field w-44"
        >
          <option value="">Any label</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}

      {isFiltering(value) && (
        <button
          onClick={() => onChange(EMPTY_BOARD_FILTERS)}
          className="btn-ghost animate-fade-in"
        >
          <X className="w-4 h-4" aria-hidden="true" />
          Clear filters
        </button>
      )}
    </div>
  );
}

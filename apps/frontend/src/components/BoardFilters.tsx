'use client';

import { Search, X } from 'lucide-react';
import type { Member } from '@/lib/members';

export interface BoardFilterValues {
  q: string;
  priority: '' | 'low' | 'medium' | 'high' | 'urgent';
  /** '' = anyone, 'me', 'none' = unassigned, or a member id. */
  assignee: string;
}

export const EMPTY_BOARD_FILTERS: BoardFilterValues = { q: '', priority: '', assignee: '' };

export const isFiltering = (f: BoardFilterValues) => f.q.trim() !== '' || f.priority !== '' || f.assignee !== '';

/** Search, priority and assignee filters above the board. */
export default function BoardFilters({
  value,
  onChange,
  members,
}: {
  value: BoardFilterValues;
  onChange: (next: BoardFilterValues) => void;
  members: Member[];
}) {
  const set = (patch: Partial<BoardFilterValues>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-3 px-8 pt-4">
      <div className="relative w-64">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
        <input
          type="search"
          aria-label="Search tasks"
          placeholder="Search tasks"
          value={value.q}
          maxLength={100}
          onChange={(e) => set({ q: e.target.value })}
          className="input-field pl-9"
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

      {isFiltering(value) && (
        <button
          onClick={() => onChange(EMPTY_BOARD_FILTERS)}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <X className="w-4 h-4" />
          Clear filters
        </button>
      )}
    </div>
  );
}

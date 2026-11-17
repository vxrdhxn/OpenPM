import { describe, expect, it } from 'vitest';
import { changesOf, draftOf, EMPTY_DRAFT, fromDateInput, newTaskBody, toDateInput } from './tasks';

const task = {
  title: 'Write docs',
  description: null,
  status: 'todo',
  priority: 'medium',
  assignee_id: null,
  due_date: null,
};

describe('due dates', () => {
  it('round-trips a picked day in the local time zone', () => {
    expect(toDateInput(fromDateInput('2026-11-20'))).toBe('2026-11-20');
  });

  it('is due at the end of the picked day, so it is not overdue during that day', () => {
    const due = new Date(fromDateInput('2026-11-20')!);
    expect(due.getTime()).toBeGreaterThan(new Date(2026, 10, 20, 23, 59).getTime());
    expect(due.getTime()).toBeLessThan(new Date(2026, 10, 21).getTime());
  });

  it('treats empty or malformed values as no date', () => {
    expect(toDateInput(null)).toBe('');
    expect(toDateInput('not a date')).toBe('');
    expect(fromDateInput('')).toBeNull();
    expect(fromDateInput('20/11/2026')).toBeNull();
  });
});

describe('changesOf', () => {
  it('is empty when nothing changed', () => {
    expect(changesOf(task, draftOf(task))).toEqual({});
  });

  it('sends only the changed fields, trimmed', () => {
    const draft = { ...draftOf(task), title: '  Write the docs ', priority: 'high' };
    expect(changesOf(task, draft)).toEqual({ title: 'Write the docs', priority: 'high' });
  });

  it('ignores whitespace-only title edits', () => {
    expect(changesOf(task, { ...draftOf(task), title: 'Write docs  ' })).toEqual({});
  });

  it('clears an assignee and a due date with null', () => {
    const assigned = { ...task, assignee_id: 'u1', due_date: fromDateInput('2026-11-20') };
    expect(changesOf(assigned, { ...draftOf(assigned), assignee_id: '', due: '' })).toEqual({ assignee_id: null, due_date: null });
  });

  it('sends the description as a string, even when cleared', () => {
    const described = { ...task, description: 'old' };
    expect(changesOf(described, { ...draftOf(described), description: '' })).toEqual({ description: '' });
  });
});

describe('newTaskBody', () => {
  it('leaves out empty optional fields', () => {
    expect(newTaskBody({ ...EMPTY_DRAFT, title: ' New ' })).toEqual({ title: 'New', priority: 'medium' });
  });

  it('includes the fields that were filled in', () => {
    const body = newTaskBody({ ...EMPTY_DRAFT, title: 'New', priority: 'urgent', assignee_id: 'u1', description: 'Why', due: '2026-11-20' });
    expect(body).toMatchObject({ title: 'New', priority: 'urgent', assignee_id: 'u1', description: 'Why' });
    expect(toDateInput(body.due_date)).toBe('2026-11-20');
  });
});

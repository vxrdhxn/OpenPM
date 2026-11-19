import { describe, expect, it } from 'vitest';
import { badgeText, describeNotification, isForMe, TYPE_LABELS, typeLabel } from './notifications';

describe('typeLabel', () => {
  it('describes every type the API knows, and falls back to the raw name', () => {
    expect(Object.keys(TYPE_LABELS)).toEqual(['task_assigned', 'mentioned', 'commented', 'status_changed', 'due_soon']);
    expect(typeLabel('due_soon')).toMatch(/due within 24 hours/);
    expect(typeLabel('something_new')).toBe('something_new');
  });
});

describe('describeNotification', () => {
  const base = { actor_name: 'Ada', task_title: 'Fix login', data: {} };

  it.each([
    ['task_assigned', 'Ada assigned you Fix login'],
    ['mentioned', 'Ada mentioned you on Fix login'],
    ['commented', 'Ada commented on Fix login'],
  ])('%s', (type, text) => {
    expect(describeNotification({ ...base, type })).toBe(text);
  });

  it('words a due-date reminder without an actor', () => {
    const text = describeNotification({ type: 'due_soon', actor_name: null, task_title: 'Fix login', data: { due_date: '2026-11-20T15:00:00Z' } });
    expect(text).toMatch(/^Fix login is due \S/);
    expect(text).not.toMatch(/Someone/);
    expect(describeNotification({ type: 'due_soon', actor_name: null, task_title: 'Fix login', data: {} })).toBe('Fix login is due soon');
  });

  it('names the new status', () => {
    expect(describeNotification({ ...base, type: 'status_changed', data: { to: 'in_review' } })).toBe('Ada moved Fix login to In Review');
  });

  it('falls back when the task or actor is gone', () => {
    expect(describeNotification({ type: 'commented', actor_name: null, task_title: null, data: { title: 'Old title' } })).toBe(
      'Someone commented on Old title'
    );
  });
});

describe('isForMe', () => {
  it('matches only notification events naming this user', () => {
    expect(isForMe({ type: 'notification', user_ids: ['u1', 'u2'] }, 'u2')).toBe(true);
    expect(isForMe({ type: 'notification', user_ids: ['u1'] }, 'u2')).toBe(false);
    expect(isForMe({ type: 'task_updated', user_ids: ['u2'] }, 'u2')).toBe(false);
    expect(isForMe({ type: 'notification', user_ids: 'u2' }, 'u2')).toBe(false);
    expect(isForMe(null, 'u2')).toBe(false);
  });
});

describe('badgeText', () => {
  it('hides zero and caps at 99+', () => {
    expect([0, 1, 99, 100].map(badgeText)).toEqual(['', '1', '99', '99+']);
  });
});

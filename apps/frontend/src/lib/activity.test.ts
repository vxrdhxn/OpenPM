import { describe, expect, it } from 'vitest';
import { compactNumber, describeActivity, timeAgo } from './activity';

describe('describeActivity', () => {
  it.each([
    [{ entity_type: 'task', action: 'created', changes: null }, 'created the task'],
    [{ entity_type: 'task', action: 'updated', changes: { changes: ['status'], from: 'todo', to: 'done' } }, 'moved to Done:'],
    [{ entity_type: 'task', action: 'updated', changes: { changes: ['assignee_id'] } }, 'reassigned'],
    [{ entity_type: 'task', action: 'updated', changes: { changes: ['title', 'priority'] } }, 'updated the task'],
    [{ entity_type: 'task', action: 'labels_changed', changes: null }, 'changed the labels of'],
    [{ entity_type: 'comment', action: 'created', changes: null }, 'commented on'],
    [{ entity_type: 'project', action: 'deleted', changes: null }, 'deleted the project'],
    [{ entity_type: 'widget', action: 'frobbed_hard', changes: null }, 'frobbed hard widget'],
  ])('%o -> %s', (entry, phrase) => {
    expect(describeActivity(entry)).toBe(phrase);
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('uses relative times for the last week', () => {
    expect(timeAgo(ago(10_000), now)).toBe('just now');
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3 h ago');
    expect(timeAgo(ago(24 * 3_600_000), now)).toBe('yesterday');
    expect(timeAgo(ago(4 * 24 * 3_600_000), now)).toBe('4 days ago');
  });

  it('never says "in the future" for clock skew', () => {
    expect(timeAgo(new Date(now + 5000).toISOString(), now)).toBe('just now');
  });
});

describe('compactNumber', () => {
  it('compacts large numbers', () => {
    expect(compactNumber(7)).toBe('7');
    expect(compactNumber(1284)).toBe('1,284');
    expect(compactNumber(12_900)).toBe('12.9K');
    expect(compactNumber(250_000)).toBe('250K');
    expect(compactNumber(4_200_000)).toBe('4.2M');
  });
});

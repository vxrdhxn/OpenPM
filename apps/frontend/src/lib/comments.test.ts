import { describe, expect, it } from 'vitest';
import { applyCommentEvent, canComment, canDeleteComment, canEditComment, type Comment } from './comments';

const c = (id: string, author = 'u1', body = id): Comment => ({
  id,
  task_id: 't1',
  body,
  author_id: author,
  author_name: author,
  author_removed: false,
  created_at: '',
  updated_at: '',
  edited_at: null,
});

describe('applyCommentEvent', () => {
  const thread = [c('a'), c('b')];

  it('appends a new comment once (our own post also arrives as an event)', () => {
    const once = applyCommentEvent(thread, 't1', { type: 'comment_created', task_id: 't1', comment: c('n') });
    expect(once.map((x) => x.id)).toEqual(['a', 'b', 'n']);
    expect(applyCommentEvent(once, 't1', { type: 'comment_created', task_id: 't1', comment: c('n') })).toBe(once);
  });

  it('replaces an edited comment and removes a deleted one', () => {
    const edited = applyCommentEvent(thread, 't1', { type: 'comment_updated', task_id: 't1', comment: c('a', 'u1', 'new text') });
    expect(edited[0]!.body).toBe('new text');

    const deleted = applyCommentEvent(thread, 't1', { type: 'comment_deleted', task_id: 't1', comment_id: 'b' });
    expect(deleted.map((x) => x.id)).toEqual(['a']);
  });

  it('ignores events for other tasks, other types, and comments not loaded', () => {
    expect(applyCommentEvent(thread, 't1', { type: 'comment_created', task_id: 't2', comment: c('x') })).toBe(thread);
    expect(applyCommentEvent(thread, 't1', { type: 'task_updated', task_id: 't1' })).toBe(thread);
    expect(applyCommentEvent(thread, 't1', { type: 'comment_updated', task_id: 't1', comment: c('zz') })).toBe(thread);
    expect(applyCommentEvent(thread, 't1', { type: 'comment_deleted', task_id: 't1', comment_id: 'zz' })).toBe(thread);
  });
});

describe('comment permissions (UI mirror)', () => {
  const mine = c('a', 'me');
  const theirs = c('b', 'someone');

  it('lets members comment, not viewers', () => {
    expect(canComment({ user_id: 'me', role: 'member' })).toBe(true);
    expect(canComment({ user_id: 'me', role: 'viewer' })).toBe(false);
    expect(canComment(null)).toBe(false);
  });

  it('lets only the author edit; the author or an admin delete', () => {
    const member = { user_id: 'me', role: 'member' };
    const admin = { user_id: 'boss', role: 'admin' };

    expect(canEditComment(member, mine)).toBe(true);
    expect(canEditComment(member, theirs)).toBe(false);
    expect(canEditComment(admin, theirs)).toBe(false);
    expect(canDeleteComment(member, theirs)).toBe(false);
    expect(canDeleteComment(admin, theirs)).toBe(true);
  });

  it('gives a demoted author (now a viewer) no edit or delete', () => {
    expect(canEditComment({ user_id: 'me', role: 'viewer' }, mine)).toBe(false);
    expect(canDeleteComment({ user_id: 'me', role: 'viewer' }, mine)).toBe(false);
  });
});

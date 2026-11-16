import { api } from './api';
import { buildQuery, type Page } from './query';

export const MAX_COMMENT_LENGTH = 10_000;

export interface Comment {
  id: string;
  task_id: string;
  body: string;
  author_id: string;
  author_name: string;
  /** The author has since been removed from the organization. */
  author_removed: boolean;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  /** People mentioned (and notified) in this comment. */
  mentions?: Array<{ id: string; name: string }>;
}

const base = (projectId: string, taskId: string) => `/projects/${projectId}/tasks/${taskId}/comments`;

/** A page of comments, newest first. */
export const listComments = (projectId: string, taskId: string, cursor?: string | null): Promise<Page<Comment>> =>
  api.get(`${base(projectId, taskId)}${buildQuery({ cursor, limit: 30 })}`);

export const postComment = (projectId: string, taskId: string, body: string, mentionIds: string[] = []): Promise<Comment> =>
  api.post(base(projectId, taskId), { body, mention_ids: mentionIds });

/** `mentionIds` replaces the comment's mentions; people newly mentioned are notified. */
export const editComment = (projectId: string, taskId: string, id: string, body: string, mentionIds: string[]): Promise<Comment> =>
  api.patch(`${base(projectId, taskId)}/${id}`, { body, mention_ids: mentionIds });

export const deleteComment = (projectId: string, taskId: string, id: string): Promise<void> =>
  api.delete(`${base(projectId, taskId)}/${id}`);

interface Viewer {
  user_id: string;
  role: string;
}

const RANK: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

/** UI rules, mirroring the API (which enforces them). */
export const canComment = (me: Viewer | null) => (RANK[me?.role ?? ''] ?? 0) >= RANK.member!;
export const canEditComment = (me: Viewer | null, c: Comment) => canComment(me) && me!.user_id === c.author_id;
export const canDeleteComment = (me: Viewer | null, c: Comment) =>
  canEditComment(me, c) || (RANK[me?.role ?? ''] ?? 0) >= RANK.admin!;

/** A live event from the organization channel, as published by the API. */
export interface CommentEvent {
  type: string;
  task_id?: string;
  comment?: Comment;
  comment_id?: string;
}

/**
 * Apply a live comment event to a thread kept oldest-first. Returns the same array when the event is
 * not about this task (or changes nothing), so callers can skip a re-render. Creating is idempotent:
 * our own posts arrive both in the response and as an event.
 */
export function applyCommentEvent(thread: Comment[], taskId: string, event: CommentEvent): Comment[] {
  if (event.task_id !== taskId) return thread;

  switch (event.type) {
    case 'comment_created': {
      const c = event.comment;
      if (!c || thread.some((t) => t.id === c.id)) return thread;
      return [...thread, c];
    }
    case 'comment_updated': {
      const c = event.comment;
      if (!c || !thread.some((t) => t.id === c.id)) return thread;
      return thread.map((t) => (t.id === c.id ? c : t));
    }
    case 'comment_deleted':
      return thread.some((t) => t.id === event.comment_id) ? thread.filter((t) => t.id !== event.comment_id) : thread;
    default:
      return thread;
  }
}

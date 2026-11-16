import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyCommentEvent,
  deleteComment,
  editComment,
  listComments,
  postComment,
  type Comment,
  type CommentEvent,
} from '@/lib/comments';

/**
 * One task's comment thread, kept oldest-first for display. Loads the newest page first and earlier
 * ones on demand, applies live events from the organization channel, and exposes post/edit/delete.
 */
export function useComments(projectId: string, taskId: string, lastMessage: CommentEvent | null) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // First (newest) page. State is only set in the promise callbacks.
  useEffect(() => {
    listComments(projectId, taskId)
      .then((page) => {
        if (!mounted.current) return;
        setComments([...page.items].reverse());
        setOlderCursor(page.next_cursor);
        setError('');
      })
      .catch((err) => mounted.current && setError(err instanceof Error ? err.message : 'Could not load comments'))
      .finally(() => mounted.current && setLoading(false));
  }, [projectId, taskId]);

  // Live updates from other people (and echoes of our own changes, applied idempotently).
  // Adjusting state while rendering, keyed on the message, instead of in an effect.
  const [seenMessage, setSeenMessage] = useState(lastMessage);
  if (lastMessage !== seenMessage) {
    setSeenMessage(lastMessage);
    if (lastMessage) {
      const next = applyCommentEvent(comments, taskId, lastMessage);
      if (next !== comments) setComments(next);
    }
  }

  const loadOlder = useCallback(() => {
    if (!olderCursor) return;
    setLoadingOlder(true);
    listComments(projectId, taskId, olderCursor)
      .then((page) => {
        if (!mounted.current) return;
        const older = [...page.items].reverse();
        setComments((current) => [...older.filter((o) => !current.some((c) => c.id === o.id)), ...current]);
        setOlderCursor(page.next_cursor);
      })
      .catch((err) => mounted.current && setError(err instanceof Error ? err.message : 'Could not load comments'))
      .finally(() => mounted.current && setLoadingOlder(false));
  }, [projectId, taskId, olderCursor]);

  const add = useCallback(
    async (body: string) => {
      const created = await postComment(projectId, taskId, body);
      if (mounted.current) setComments((current) => applyCommentEvent(current, taskId, { type: 'comment_created', task_id: taskId, comment: created }));
    },
    [projectId, taskId]
  );

  const edit = useCallback(
    async (id: string, body: string) => {
      const updated = await editComment(projectId, taskId, id, body);
      if (mounted.current) setComments((current) => applyCommentEvent(current, taskId, { type: 'comment_updated', task_id: taskId, comment: updated }));
    },
    [projectId, taskId]
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteComment(projectId, taskId, id);
      if (mounted.current) setComments((current) => applyCommentEvent(current, taskId, { type: 'comment_deleted', task_id: taskId, comment_id: id }));
    },
    [projectId, taskId]
  );

  return { comments, loading, error, hasOlder: olderCursor !== null, loadingOlder, loadOlder, add, edit, remove };
}

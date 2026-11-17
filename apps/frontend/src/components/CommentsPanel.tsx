'use client';

import { useId, useState } from 'react';
import { Loader2, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { useComments } from '@/hooks/useComments';
import MentionTextarea from './MentionTextarea';
import { useConfirm } from '@/components/ui/feedback';
import { mentionIdsIn, type Mentionable } from '@/lib/mentions';
import {
  canComment,
  canDeleteComment,
  canEditComment,
  MAX_COMMENT_LENGTH,
  type Comment,
  type CommentEvent,
} from '@/lib/comments';

interface Props {
  projectId: string;
  taskId: string;
  me: { user_id: string; role: string } | null;
  lastMessage: CommentEvent | null;
  /** The organization's members, for @mentions. */
  members?: Mentionable[];
}

const NO_MEMBERS: Mentionable[] = [];

const messageOf = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** Show the remaining characters only when it matters. */
function Counter({ length }: { length: number }) {
  const left = MAX_COMMENT_LENGTH - length;
  if (left > 500) return null;
  return <span className={`text-xs ${left < 0 ? 'text-red-600' : 'text-slate-500'}`}>{left} characters left</span>;
}

/**
 * The task's discussion: comments oldest-first with the newest at the bottom, live updates, and a box
 * to write one. Text is rendered as text (React escapes it), never as HTML.
 */
export default function CommentsPanel({ projectId, taskId, me, lastMessage, members = NO_MEMBERS }: Props) {
  const { comments, loading, error, hasOlder, loadingOlder, loadOlder, add, edit, remove } = useComments(projectId, taskId, lastMessage);
  const confirm = useConfirm();
  const [draft, setDraft] = useState('');
  // People picked from the @ suggestions while writing; only those still named in the text are sent.
  const [draftMentions, setDraftMentions] = useState<Mentionable[]>([]);
  const [posting, setPosting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string; mentions: Mentionable[] } | null>(null);
  const inputId = useId();

  const submit = async () => {
    const body = draft.trim();
    if (!body || body.length > MAX_COMMENT_LENGTH || posting) return;
    setPosting(true);
    setActionError('');
    try {
      await add(body, mentionIdsIn(body, draftMentions));
      setDraft('');
      setDraftMentions([]);
    } catch (err) {
      setActionError(messageOf(err, 'Could not post the comment'));
    } finally {
      setPosting(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body || body.length > MAX_COMMENT_LENGTH) return;
    setActionError('');
    try {
      await edit(editing.id, body, mentionIdsIn(body, editing.mentions));
      setEditing(null);
    } catch (err) {
      setActionError(messageOf(err, 'Could not save the comment'));
    }
  };

  const confirmDelete = async (c: Comment) => {
    if (!(await confirm({ title: 'Delete this comment?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true }))) return;
    setActionError('');
    try {
      await remove(c.id);
    } catch (err) {
      setActionError(messageOf(err, 'Could not delete the comment'));
    }
  };

  // Ctrl/Cmd+Enter submits. Escape with unsaved text only leaves the box, instead of closing the
  // whole dialog and losing the text.
  const keys = (onSubmit: () => void, hasText: boolean, onCancel?: () => void) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'Escape' && (hasText || onCancel)) {
      e.stopPropagation();
      if (onCancel) onCancel();
      else e.currentTarget.blur();
    }
  };

  return (
    <section aria-labelledby={`${inputId}-heading`}>
      <h3 id={`${inputId}-heading`} className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
        <MessageSquare className="w-4 h-4" aria-hidden="true" />
        Comments {comments.length > 0 && <span className="font-normal text-slate-500">({comments.length}{hasOlder ? '+' : ''})</span>}
      </h3>

      {(error || actionError) && (
        <div role="alert" className="mb-3 p-2 rounded-lg text-sm bg-red-50 text-red-700">
          {error || actionError}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading comments...</p>
      ) : (
        <>
          {hasOlder && (
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="mb-3 text-sm text-indigo-600 hover:underline disabled:opacity-50 flex items-center gap-1"
            >
              {loadingOlder && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
              Show earlier comments
            </button>
          )}

          {comments.length === 0 ? (
            <p className="text-sm text-slate-500 mb-3">No comments yet.</p>
          ) : (
            <ul className="space-y-3 mb-4" aria-live="polite">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">
                      {c.author_name}
                      {c.author_removed && <span className="ml-1 text-xs font-normal text-slate-500">(removed)</span>}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <time dateTime={c.created_at}>{new Date(c.created_at).toLocaleString()}</time>
                      {c.edited_at && <span>(edited)</span>}
                      {canEditComment(me, c) && editing?.id !== c.id && (
                        <button
                          type="button"
                          onClick={() => setEditing({ id: c.id, body: c.body, mentions: c.mentions ?? [] })}
                          aria-label="Edit comment"
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                      {canDeleteComment(me, c) && (
                        <button
                          type="button"
                          onClick={() => confirmDelete(c)}
                          aria-label="Delete comment"
                          className="p-1 rounded hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  </div>

                  {editing?.id === c.id ? (
                    <div className="space-y-2">
                      <MentionTextarea
                        aria-label="Edit comment"
                        value={editing.body}
                        onChange={(body) => setEditing({ ...editing, body })}
                        onMention={(m) => setEditing({ ...editing, mentions: [...editing.mentions, m] })}
                        members={members}
                        selfId={me?.user_id}
                        onKeyDown={keys(saveEdit, true, () => setEditing(null))}
                        rows={3}
                        autoFocus
                        className="input-field text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={saveEdit} className="btn-compact">
                          Save
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className="text-sm text-slate-600 dark:text-slate-300">
                          Cancel
                        </button>
                        <Counter length={editing.body.length} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{c.body}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canComment(me) ? (
            <div className="space-y-2">
              <label htmlFor={inputId} className="sr-only">
                Write a comment
              </label>
              <MentionTextarea
                id={inputId}
                value={draft}
                onChange={setDraft}
                onMention={(m) => setDraftMentions((list) => [...list, m])}
                members={members}
                selfId={me?.user_id}
                onKeyDown={keys(submit, draft !== '')}
                placeholder="Write a comment... (@ to mention, Ctrl+Enter to send)"
                rows={3}
                className="input-field text-sm"
              />
              <div className="flex items-center justify-between">
                <Counter length={draft.length} />
                <button
                  type="button"
                  onClick={submit}
                  disabled={posting || !draft.trim() || draft.length > MAX_COMMENT_LENGTH}
                  className="btn-compact ml-auto"
                >
                  {posting && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                  Comment
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Viewers can read comments but not write them.</p>
          )}
        </>
      )}
    </section>
  );
}

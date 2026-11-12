'use client';

import { useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Paperclip, Trash2, X } from 'lucide-react';
import { ACCEPT, Attachment, formatBytes } from '@/lib/attachments';
import { useAttachments } from '@/hooks/useAttachments';

interface Props {
  projectId: string;
  taskId: string;
  /** Viewers can see and download attachments but not add them. (The server enforces this too.) */
  canUpload: boolean;
  currentUserId: string | null;
  isAdmin: boolean;
}

const isImage = (a: Attachment) => a.content_type.startsWith('image/');

export default function AttachmentsPanel({ projectId, taskId, canUpload, currentUserId, isAdmin }: Props) {
  const { attachments, loading, loadError, uploads, notice, upload, cancel, dismiss, remove, download } =
    useAttachments(projectId, taskId);

  const dragDepth = useRef(0); // dragenter/leave also fire for child elements; count to avoid flicker
  const [dragging, setDragging] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (hasFiles(e)) e.preventDefault(); // required to allow a drop
  };
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) upload(files);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) upload(files);
    e.target.value = ''; // allow picking the same file again
  };

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } catch {
      /* the hook already reports the failure through `notice` */
    } finally {
      setBusyId(null);
      setConfirmingId(null);
    }
  };

  const canDelete = (a: Attachment) => canUpload && (isAdmin || a.uploaded_by === currentUserId);

  return (
    <section aria-labelledby="attachments-heading" className="space-y-3">
      <h3 id="attachments-heading" className="flex items-center gap-2 text-sm font-semibold">
        <Paperclip className="w-4 h-4" aria-hidden="true" />
        Attachments
        {!loading && <span className="font-normal text-slate-500">({attachments.length})</span>}
      </h3>

      {/* Announces upload/delete/download results to screen readers. */}
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>

      {canUpload && (
        <label
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-indigo-500 ${
            dragging
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
              : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400'
          }`}
        >
          <input type="file" multiple accept={ACCEPT} onChange={onPick} className="sr-only" />
          <span className="font-medium">{dragging ? 'Drop to upload' : 'Drag files here or click to browse'}</span>
          <span className="text-xs text-slate-500">Images, PDF, Office documents, text, CSV, JSON</span>
        </label>
      )}

      {uploads.length > 0 && (
        <ul className="space-y-2" aria-label="Uploads in progress">
          {uploads.map((u) => (
            <li
              key={u.key}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate" title={u.name}>
                  {u.name}
                </span>
                {u.status === 'uploading' ? (
                  <button
                    type="button"
                    onClick={() => cancel(u.key)}
                    className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label={`Cancel upload of ${u.name}`}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => dismiss(u.key)}
                    className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label={`Dismiss error for ${u.name}`}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {u.status === 'uploading' ? (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${u.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(u.progress * 100)}
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                >
                  <div
                    className="h-full bg-indigo-600 transition-[width]"
                    style={{ width: `${Math.round(u.progress * 100)}%` }}
                  />
                </div>
              ) : (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{u.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading attachments…</p>
      ) : loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : attachments.length === 0 && uploads.length === 0 ? (
        <p className="text-sm text-slate-500">No attachments yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              {isImage(a) ? (
                <ImageIcon className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
              ) : (
                <FileText className="w-4 h-4 shrink-0 text-slate-400" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" title={a.filename}>
                  {a.filename}
                </p>
                <p className="text-xs text-slate-500">{formatBytes(a.size_bytes)}</p>
              </div>

              {confirmingId === a.id ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-600 dark:text-slate-300">Delete?</span>
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => act(a.id, () => remove(a))}
                    className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    className="rounded px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={busyId === a.id}
                    onClick={() => act(a.id, () => download(a))}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                    aria-label={`Download ${a.filename}`}
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                  </button>
                  {canDelete(a) && (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(a.id)}
                      className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                      aria-label={`Delete ${a.filename}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

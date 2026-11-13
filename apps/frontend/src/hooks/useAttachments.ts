import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Attachment,
  AttachmentError,
  deleteAttachment,
  getDownloadUrl,
  listAttachments,
  uploadAttachment,
} from '@/lib/attachments';

export interface UploadItem {
  key: string;
  name: string;
  /** 0..1 */
  progress: number;
  status: 'uploading' | 'error';
  error?: string;
}

let nextKey = 0;

/**
 * Attachments of one task: the list, in-flight uploads (with progress, cancel and errors), and the
 * download/delete actions. Uploads run one after another so a big drop doesn't open many
 * connections at once. In-flight uploads are cancelled (and their pending rows cleaned up) when
 * the task view closes.
 */
export function useAttachments(projectId: string, taskId: string) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [notice, setNotice] = useState<string>(''); // announced to screen readers

  const mounted = useRef(true);
  const controllers = useRef(new Map<string, AbortController>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const cancelledWhileQueued = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    const active = controllers.current;
    return () => {
      mounted.current = false;
      active.forEach((c) => c.abort());
      active.clear();
    };
  }, []);

  const refresh = useCallback(
    () =>
      listAttachments(projectId, taskId)
        .then((list) => {
          if (!mounted.current) return;
          setAttachments(list);
          setLoadError(null);
        })
        .catch((err) => {
          if (!mounted.current) return;
          setLoadError(err instanceof Error ? err.message : 'Could not load attachments');
        })
        .finally(() => {
          if (mounted.current) setLoading(false);
        }),
    [projectId, taskId]
  );

  // Show the loading state again when the view switches to another task (adjusting state during
  // render rather than in an effect).
  const taskKey = `${projectId}/${taskId}`;
  const [loadedKey, setLoadedKey] = useState(taskKey);
  if (loadedKey !== taskKey) {
    setLoadedKey(taskKey);
    setLoading(true);
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  const patchUpload = (key: string, patch: Partial<UploadItem>) =>
    setUploads((items) => items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const dropUpload = (key: string) => setUploads((items) => items.filter((i) => i.key !== key));

  const runUpload = async (file: File, key: string) => {
    const controller = new AbortController();
    controllers.current.set(key, controller);
    try {
      const attachment = await uploadAttachment({
        projectId,
        taskId,
        file,
        signal: controller.signal,
        onProgress: (progress) => mounted.current && patchUpload(key, { progress }),
      });
      if (!mounted.current) return;
      dropUpload(key);
      setAttachments((list) => [...list, attachment]);
      setNotice(`Uploaded ${attachment.filename}`);
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof AttachmentError && err.aborted) {
        dropUpload(key); // the user cancelled; nothing to report
        setNotice(`Cancelled ${file.name}`);
      } else {
        const message = err instanceof Error ? err.message : 'Upload failed';
        patchUpload(key, { status: 'error', error: message });
        setNotice(`Upload failed for ${file.name}: ${message}`);
      }
    } finally {
      controllers.current.delete(key);
    }
  };

  const upload = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const key = `u${nextKey++}`;
        setUploads((items) => [...items, { key, name: file.name, progress: 0, status: 'uploading' }]);
        queue.current = queue.current.then(() => {
          // Skip anything cancelled while it was still waiting its turn.
          if (!mounted.current || cancelledWhileQueued.current.delete(key)) return undefined;
          return runUpload(file, key);
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, taskId]
  );

  const cancel = useCallback((key: string) => {
    const controller = controllers.current.get(key);
    if (controller) {
      controller.abort(); // in flight: the upload's own error path removes the item
    } else {
      cancelledWhileQueued.current.add(key); // not started yet: make the queue skip it
      dropUpload(key);
    }
  }, []);

  const dismiss = useCallback((key: string) => dropUpload(key), []);

  const remove = useCallback(
    async (attachment: Attachment) => {
      try {
        await deleteAttachment(projectId, taskId, attachment.id);
        if (!mounted.current) return;
        setAttachments((list) => list.filter((a) => a.id !== attachment.id));
        setNotice(`Deleted ${attachment.filename}`);
      } catch (err) {
        if (!mounted.current) return;
        setNotice(`Could not delete ${attachment.filename}: ${err instanceof Error ? err.message : 'error'}`);
        throw err;
      }
    },
    [projectId, taskId]
  );

  const download = useCallback(
    async (attachment: Attachment) => {
      try {
        const url = await getDownloadUrl(projectId, taskId, attachment.id);
        // The signed URL forces a download, so this saves the file without leaving the page.
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (err) {
        if (mounted.current) {
          setNotice(`Could not download ${attachment.filename}: ${err instanceof Error ? err.message : 'error'}`);
        }
        throw err;
      }
    },
    [projectId, taskId]
  );

  return { attachments, loading, loadError, uploads, notice, upload, cancel, dismiss, remove, download, refresh };
}

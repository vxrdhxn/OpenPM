import { api } from './api';

/**
 * Task attachments: client side of the presigned-upload flow.
 *
 *   1. POST .../attachments            declare filename/type/size -> pending row + presigned PUT URL
 *   2. PUT  <presigned url>            the browser sends the bytes straight to object storage
 *   3. POST .../attachments/:id/complete   the API verifies the stored object and marks it ready
 *
 * The server validates everything; checks here only save a round trip and give clearer messages.
 */

export interface Attachment {
  id: string;
  task_id: string;
  filename: string;
  content_type: string;
  size_bytes: string | number; // BIGINT arrives from the API as a string
  status: 'pending' | 'ready';
  uploaded_by: string;
  created_at: string;
}

/**
 * The content type is derived from the file EXTENSION, not `File.type`: browsers report empty or
 * OS-specific types for some files (e.g. .md, or .csv on Windows), and the server requires the
 * declared type to match the extension exactly.
 *
 * Keep in sync with ALLOWED_TYPES in apps/api/src/attachments/policy.ts (a test enforces this).
 */
export const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Value for the file input's `accept` attribute. */
export const ACCEPT = Object.keys(CONTENT_TYPE_BY_EXTENSION)
  .map((ext) => `.${ext}`)
  .join(',');

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** The content type to declare for a file, or null if its type is not supported. */
export function contentTypeFor(filename: string): string | null {
  return CONTENT_TYPE_BY_EXTENSION[extensionOf(filename)] ?? null;
}

export function formatBytes(bytes: number | string): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[i]}`;
}

export type UploadStage = 'validate' | 'request' | 'upload' | 'complete';

export class AttachmentError extends Error {
  constructor(
    message: string,
    public readonly stage: UploadStage,
    public readonly aborted = false
  ) {
    super(message);
    this.name = 'AttachmentError';
  }
}

export interface PutArgs {
  url: string;
  method: string;
  headers: Record<string, string>;
  file: Blob;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}
export type PutFile = (args: PutArgs) => Promise<void>;

/** Upload with progress. `fetch` can't report upload progress, so this uses XMLHttpRequest. */
export const putWithProgress: PutFile = ({ url, method, headers, file, onProgress, signal }) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    // Send exactly the headers the server told us to: the signature binds them.
    // (Content-Length is set by the browser from the body; it can't and needn't be set here.)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new Error(`Storage rejected the upload (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading. Check your connection.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));

    if (signal) {
      if (signal.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });

/** Subset of the API client this module needs (injectable for tests). */
export interface ApiLike {
  get: (endpoint: string) => Promise<any>;
  post: (endpoint: string, data: any) => Promise<any>;
  delete: (endpoint: string) => Promise<any>;
}

export const attachmentsPath = (projectId: string, taskId: string) =>
  `/projects/${projectId}/tasks/${taskId}/attachments`;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

export interface UploadOptions {
  projectId: string;
  taskId: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  client?: ApiLike;
  put?: PutFile;
}

/**
 * Run the whole upload. Resolves with the ready attachment, or throws an AttachmentError naming the
 * stage that failed. If anything fails after the server created the pending row, that row is
 * deleted (best effort) so a failed upload doesn't linger as an orphan.
 */
export async function uploadAttachment(opts: UploadOptions): Promise<Attachment> {
  const { projectId, taskId, file, onProgress, signal, client = api, put = putWithProgress } = opts;
  const base = attachmentsPath(projectId, taskId);

  const contentType = contentTypeFor(file.name);
  if (!contentType) {
    throw new AttachmentError(
      `"${file.name}" is not a supported file type. Allowed: ${Object.keys(CONTENT_TYPE_BY_EXTENSION).join(', ')}.`,
      'validate'
    );
  }
  if (file.size === 0) {
    throw new AttachmentError(`"${file.name}" is empty.`, 'validate');
  }

  let created: { attachment: Attachment; upload: { method: string; url: string; headers: Record<string, string> } };
  try {
    created = await client.post(base, { filename: file.name, content_type: contentType, size: file.size });
  } catch (err) {
    throw new AttachmentError(messageOf(err), 'request');
  }

  const { attachment, upload } = created;
  const discard = () => client.delete(`${base}/${attachment.id}`).catch(() => undefined);

  try {
    await put({ url: upload.url, method: upload.method, headers: upload.headers, file, onProgress, signal });
  } catch (err) {
    await discard();
    throw new AttachmentError(messageOf(err), 'upload', isAbort(err));
  }

  try {
    // Send a body: the API rejects a POST that declares JSON but sends nothing.
    return await client.post(`${base}/${attachment.id}/complete`, {});
  } catch (err) {
    await discard();
    throw new AttachmentError(messageOf(err), 'complete');
  }
}

export async function listAttachments(
  projectId: string,
  taskId: string,
  client: ApiLike = api
): Promise<Attachment[]> {
  return client.get(attachmentsPath(projectId, taskId));
}

export async function deleteAttachment(
  projectId: string,
  taskId: string,
  attachmentId: string,
  client: ApiLike = api
): Promise<void> {
  await client.delete(`${attachmentsPath(projectId, taskId)}/${attachmentId}`);
}

/** Fetch a short-lived signed download URL. The URL forces a download, so navigating to it is safe. */
export async function getDownloadUrl(
  projectId: string,
  taskId: string,
  attachmentId: string,
  client: ApiLike = api
): Promise<string> {
  const { url } = await client.get(`${attachmentsPath(projectId, taskId)}/${attachmentId}/download`);
  return url;
}

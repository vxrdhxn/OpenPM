import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config';
import { hasMinRole } from '../plugins/auth';
import { getStorage, type ObjectStorage } from '../storage';
import { MAX_ATTACHMENTS_PER_TASK, SNIFF_BYTES, buildStorageKey, contentMatchesType, validateUpload } from '../attachments/policy';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../domain/errors';
import * as attachments from '../data/attachments';
import * as storageDeletions from '../data/storageDeletions';
import { withTransaction } from '../db/transaction';
import { deleteStoredObjects } from '../attachments/cleanup';
import type { AttachmentRow, PublicAttachment } from '../data/attachments';
import type { TenantScope } from '../data/scope';
import type { TaskPath } from '../data/tasks';

/**
 * Task attachments. Bytes go browser -> object storage via presigned URLs; the API only issues URLs
 * and records metadata, so it never proxies file content.
 *
 *   request an upload URL   creates a 'pending' row
 *   complete                verifies the uploaded object, marks it 'ready'
 *   list / download         ready attachments only
 *   delete                  the uploader or an admin
 */

export const UPLOAD_URL_TTL_SECONDS = 300;
export const DOWNLOAD_URL_TTL_SECONDS = 120;

type Log = Pick<FastifyBaseLogger, 'error' | 'warn'>;

const attachmentNotFound = () => new NotFoundError('Attachment not found');

/** Attachments are optional: without S3 settings the feature is off rather than half-working. */
function requireStorage(): ObjectStorage {
  const storage = getStorage();
  if (!storage) throw new AppError(503, 'Attachments are not configured on this server');
  return storage;
}

async function requireAttachment(scope: TenantScope, path: TaskPath, attachmentId: string): Promise<AttachmentRow> {
  const attachment = await attachments.find(scope, path.projectId, path.taskId, attachmentId);
  if (!attachment) throw attachmentNotFound();
  return attachment;
}

const isUploaderOrAdmin = (scope: TenantScope, attachment: AttachmentRow) =>
  attachment.uploaded_by === scope.userId || hasMinRole(scope.role, 'admin');

/** Remove an attachment's row (owing its object in the same transaction), then the object. */
async function removeAttachment(scope: TenantScope, attachment: AttachmentRow, log: Log) {
  await withTransaction(async (client) => {
    await attachments.removeIn(client, scope, attachment.id);
    await storageDeletions.owe(client, [attachment.storage_key]);
  });
  await deleteStoredObjects([attachment.storage_key], log);
}

export interface UploadRequest {
  filename: string;
  content_type: string;
  size: number;
}

export async function requestUpload(scope: TenantScope, path: TaskPath, file: UploadRequest) {
  const storage = requireStorage();

  const check = validateUpload({ filename: file.filename, contentType: file.content_type, size: file.size }, config.ATTACHMENT_MAX_BYTES);
  if (!check.ok) throw new BadRequestError(check.error);

  if (!(await attachments.taskExists(scope, path.projectId, path.taskId))) throw new NotFoundError('Task not found');
  if ((await attachments.countForTask(scope, path.taskId)) >= MAX_ATTACHMENTS_PER_TASK) {
    throw new ConflictError(`A task can have at most ${MAX_ATTACHMENTS_PER_TASK} attachments`);
  }

  // Presign first (a local computation): if the insert fails, nothing is left behind.
  const key = buildStorageKey(scope.orgId, path.taskId);
  const upload = await storage.presignUpload({ key, contentType: file.content_type, size: file.size, expiresInSeconds: UPLOAD_URL_TTL_SECONDS });

  const attachment = await attachments.insertPending(scope, path.taskId, {
    filename: check.filename,
    contentType: file.content_type,
    size: file.size,
    storageKey: key,
  });
  return {
    attachment,
    upload: { method: 'PUT', url: upload.url, headers: upload.headers, expires_in: UPLOAD_URL_TTL_SECONDS },
  };
}

/**
 * Verify an upload and mark it ready (the uploader or an admin). Trusts nothing the client said: the
 * object's size, type and first bytes must match what was declared, or the attachment is removed (422).
 * Idempotent for an attachment that is already ready.
 */
export async function completeUpload(scope: TenantScope, path: TaskPath, attachmentId: string, log: Log): Promise<PublicAttachment> {
  const storage = requireStorage();
  const attachment = await requireAttachment(scope, path, attachmentId);
  if (!isUploaderOrAdmin(scope, attachment)) throw new ForbiddenError('Only the uploader or an admin can complete this upload');

  if (attachment.status === 'ready') {
    const ready = await attachments.findPublic(scope, attachmentId);
    if (!ready) throw attachmentNotFound();
    return ready;
  }

  let stored: Awaited<ReturnType<ObjectStorage['head']>>;
  let prefix: Uint8Array = new Uint8Array();
  try {
    stored = await storage.head(attachment.storage_key);
    if (stored) prefix = await storage.readPrefix(attachment.storage_key, SNIFF_BYTES);
  } catch (err) {
    log.error({ err, attachmentId }, 'Storage unavailable while completing upload');
    throw new AppError(502, 'Storage is unavailable, try again');
  }
  if (!stored) throw new ConflictError('No uploaded file found. Upload the file first, then complete.');

  const mismatch =
    stored.size !== Number(attachment.size_bytes)
      ? 'Uploaded file size does not match the declared size'
      : stored.contentType !== attachment.content_type
        ? 'Uploaded file content type does not match the declared type'
        : !contentMatchesType(attachment.content_type, prefix)
          ? 'File contents do not match the declared type'
          : null;
  if (mismatch) {
    await removeAttachment(scope, attachment, log);
    throw new AppError(422, mismatch);
  }

  const ready = await attachments.markReady(scope, attachmentId);
  if (!ready) throw attachmentNotFound(); // deleted meanwhile
  await attachments.logTaskActivity(scope, path.taskId, 'attachment_added', { attachment_id: attachmentId, filename: attachment.filename });
  return ready;
}

export async function listAttachments(scope: TenantScope, path: TaskPath): Promise<PublicAttachment[]> {
  if (!(await attachments.taskExists(scope, path.projectId, path.taskId))) throw new NotFoundError('Task not found');
  return attachments.listReady(scope, path.taskId);
}

/** A short-lived URL that downloads (never displays) the file. A pending upload is not downloadable yet. */
export async function downloadUrl(scope: TenantScope, path: TaskPath, attachmentId: string) {
  const storage = requireStorage();
  const attachment = await attachments.find(scope, path.projectId, path.taskId, attachmentId);
  if (!attachment || attachment.status !== 'ready') throw attachmentNotFound();

  const url = await storage.presignDownload({
    key: attachment.storage_key,
    filename: attachment.filename,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
  return { url, expires_in: DOWNLOAD_URL_TTL_SECONDS };
}

export async function deleteAttachment(scope: TenantScope, path: TaskPath, attachmentId: string, log: Log): Promise<void> {
  requireStorage();
  const attachment = await requireAttachment(scope, path, attachmentId);
  if (!isUploaderOrAdmin(scope, attachment)) throw new ForbiddenError('Only the uploader or an admin can delete this attachment');

  await removeAttachment(scope, attachment, log);
  if (attachment.status === 'ready') {
    await attachments.logTaskActivity(scope, path.taskId, 'attachment_removed', { attachment_id: attachmentId, filename: attachment.filename });
  }
}

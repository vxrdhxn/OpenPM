import { FastifyPluginAsync } from 'fastify';
import { db } from '../db/client';
import { config } from '../config';
import { hasMinRole } from '../plugins/auth';
import { getStorage, ObjectStorage } from '../storage';
import {
  MAX_ATTACHMENTS_PER_TASK,
  SNIFF_BYTES,
  buildStorageKey,
  contentMatchesType,
  validateUpload,
} from '../attachments/policy';

const UPLOAD_URL_TTL_SECONDS = 300;
const DOWNLOAD_URL_TTL_SECONDS = 120;

const uuid = { type: 'string', format: 'uuid' } as const;
const taskParams = {
  type: 'object',
  required: ['projectId', 'taskId'],
  properties: { projectId: uuid, taskId: uuid },
} as const;
const attachmentParams = {
  type: 'object',
  required: ['projectId', 'taskId', 'attachmentId'],
  properties: { projectId: uuid, taskId: uuid, attachmentId: uuid },
} as const;

// The storage key is an internal detail and is never returned to clients.
const PUBLIC_COLUMNS = 'id, task_id, filename, content_type, size_bytes, status, uploaded_by, created_at, completed_at';

interface AttachmentRow {
  id: string;
  task_id: string;
  filename: string;
  content_type: string;
  size_bytes: string | number; // BIGINT arrives as a string from pg
  storage_key: string;
  status: 'pending' | 'ready';
  uploaded_by: string;
}

/**
 * Task attachments. Bytes go browser -> object storage via presigned URLs; the API only issues
 * URLs and records metadata, so it never proxies file content.
 *
 *   POST   .../attachments                 ask for an upload URL (creates a 'pending' row)
 *   POST   .../attachments/:id/complete    verify the uploaded object, mark it 'ready'
 *   GET    .../attachments                 list ready attachments
 *   GET    .../attachments/:id/download    short-lived download URL (forces download)
 *   DELETE .../attachments/:id             remove (uploader or admin+)
 *
 * Every query is scoped by the org_id from the JWT, and by project and task, so an id from
 * another tenant (or another task) is indistinguishable from a missing one.
 */
const attachmentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // Attachments are optional: without S3 settings the feature is off rather than half-working.
  function requireStorage(reply: { code: (n: number) => { send: (b: unknown) => unknown } }): ObjectStorage | null {
    const storage = getStorage();
    if (!storage) {
      reply.code(503).send({ error: 'Attachments are not configured on this server' });
      return null;
    }
    return storage;
  }

  async function logActivity(orgId: string, userId: string, taskId: string, action: string, metadata: object) {
    await db.query(
      'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [orgId, userId, 'task', taskId, action, JSON.stringify(metadata)]
    );
  }

  async function findTask(projectId: string, taskId: string, orgId: string) {
    const rows = await db.query('SELECT id FROM tasks WHERE id = $1 AND project_id = $2 AND org_id = $3', [
      taskId,
      projectId,
      orgId,
    ]);
    return rows.length > 0;
  }

  async function findAttachment(projectId: string, taskId: string, attachmentId: string, orgId: string) {
    const rows = await db.query<AttachmentRow>(
      `SELECT a.id, a.task_id, a.filename, a.content_type, a.size_bytes, a.storage_key, a.status, a.uploaded_by
         FROM task_attachments a
         JOIN tasks t ON t.id = a.task_id
        WHERE a.id = $1 AND a.task_id = $2 AND t.project_id = $3 AND a.org_id = $4 AND t.org_id = $4`,
      [attachmentId, taskId, projectId, orgId]
    );
    return rows[0] ?? null;
  }

  /** Remove an attachment's metadata, then its object. A failed object delete leaves a harmless orphan. */
  async function removeAttachment(storage: ObjectStorage, attachment: AttachmentRow, orgId: string) {
    await db.query('DELETE FROM task_attachments WHERE id = $1 AND org_id = $2', [attachment.id, orgId]);
    try {
      await storage.delete(attachment.storage_key);
    } catch (err) {
      fastify.log.error({ err, attachmentId: attachment.id }, 'Failed to delete attachment object (orphaned)');
    }
  }

  // POST .../attachments: request an upload URL (member or higher)
  fastify.post('/:projectId/tasks/:taskId/attachments', {
    preHandler: fastify.requireRole('member'),
    schema: {
      params: taskParams,
      body: {
        type: 'object',
        required: ['filename', 'content_type', 'size'],
        properties: {
          filename: { type: 'string', minLength: 1, maxLength: 1024 },
          content_type: { type: 'string', minLength: 1, maxLength: 127 },
          size: { type: 'integer', minimum: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const storage = requireStorage(reply);
    if (!storage) return;

    const { projectId, taskId } = request.params as { projectId: string; taskId: string };
    const { filename, content_type, size } = request.body as { filename: string; content_type: string; size: number };
    const { org_id, user_id } = request.user;

    const check = validateUpload({ filename, contentType: content_type, size }, config.ATTACHMENT_MAX_BYTES);
    if (!check.ok) return reply.code(400).send({ error: check.error });

    if (!(await findTask(projectId, taskId, org_id))) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    const countRows = await db.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM task_attachments WHERE task_id = $1 AND org_id = $2',
      [taskId, org_id]
    );
    if (Number(countRows[0]?.count ?? 0) >= MAX_ATTACHMENTS_PER_TASK) {
      return reply.code(409).send({ error: `A task can have at most ${MAX_ATTACHMENTS_PER_TASK} attachments` });
    }

    // Presign first (a local computation): if the insert fails, nothing is left behind.
    const key = buildStorageKey(org_id, taskId);
    const upload = await storage.presignUpload({
      key,
      contentType: content_type,
      size,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    const [attachment] = await db.query(
      `INSERT INTO task_attachments (org_id, task_id, uploaded_by, filename, content_type, size_bytes, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${PUBLIC_COLUMNS}`,
      [org_id, taskId, user_id, check.filename, content_type, size, key]
    );

    return reply.code(201).send({
      attachment,
      upload: { method: 'PUT', url: upload.url, headers: upload.headers, expires_in: UPLOAD_URL_TTL_SECONDS },
    });
  });

  // POST .../attachments/:attachmentId/complete: verify the upload (uploader or admin+)
  fastify.post('/:projectId/tasks/:taskId/attachments/:attachmentId/complete', {
    preHandler: fastify.requireRole('member'),
    schema: { params: attachmentParams },
  }, async (request, reply) => {
    const storage = requireStorage(reply);
    if (!storage) return;

    const { projectId, taskId, attachmentId } = request.params as {
      projectId: string; taskId: string; attachmentId: string;
    };
    const { org_id, user_id, role } = request.user;

    const attachment = await findAttachment(projectId, taskId, attachmentId, org_id);
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' });

    if (attachment.uploaded_by !== user_id && !hasMinRole(role, 'admin')) {
      return reply.code(403).send({ error: 'Only the uploader or an admin can complete this upload' });
    }

    if (attachment.status === 'ready') {
      const [ready] = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM task_attachments WHERE id = $1 AND org_id = $2`, [
        attachmentId,
        org_id,
      ]);
      return reply.send(ready); // idempotent
    }

    // Trust nothing the client said: check what actually landed in storage.
    let stored: Awaited<ReturnType<ObjectStorage['head']>>;
    let prefix: Uint8Array = new Uint8Array();
    try {
      stored = await storage.head(attachment.storage_key);
      if (stored) prefix = await storage.readPrefix(attachment.storage_key, SNIFF_BYTES);
    } catch (err) {
      fastify.log.error({ err, attachmentId }, 'Storage unavailable while completing upload');
      return reply.code(502).send({ error: 'Storage is unavailable, try again' });
    }

    if (!stored) {
      return reply.code(409).send({ error: 'No uploaded file found. Upload the file first, then complete.' });
    }

    const reject = async (error: string) => {
      await removeAttachment(storage, attachment, org_id);
      return reply.code(422).send({ error });
    };

    if (stored.size !== Number(attachment.size_bytes)) {
      return reject('Uploaded file size does not match the declared size');
    }
    if (stored.contentType !== attachment.content_type) {
      return reject('Uploaded file content type does not match the declared type');
    }
    if (!contentMatchesType(attachment.content_type, prefix)) {
      return reject('File contents do not match the declared type');
    }

    const [ready] = await db.query(
      `UPDATE task_attachments SET status = 'ready', completed_at = NOW()
        WHERE id = $1 AND org_id = $2 RETURNING ${PUBLIC_COLUMNS}`,
      [attachmentId, org_id]
    );
    await logActivity(org_id, user_id, taskId, 'attachment_added', {
      attachment_id: attachmentId,
      filename: attachment.filename,
    });

    return reply.send(ready);
  });

  // GET .../attachments: list ready attachments (viewer or higher)
  fastify.get('/:projectId/tasks/:taskId/attachments', {
    preHandler: fastify.requireRole('viewer'),
    schema: { params: taskParams },
  }, async (request, reply) => {
    const { projectId, taskId } = request.params as { projectId: string; taskId: string };
    const { org_id } = request.user;

    if (!(await findTask(projectId, taskId, org_id))) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    const attachments = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM task_attachments
        WHERE task_id = $1 AND org_id = $2 AND status = 'ready' ORDER BY created_at ASC`,
      [taskId, org_id]
    );
    return reply.send(attachments);
  });

  // GET .../attachments/:attachmentId/download: short-lived download URL (viewer or higher)
  fastify.get('/:projectId/tasks/:taskId/attachments/:attachmentId/download', {
    preHandler: fastify.requireRole('viewer'),
    schema: { params: attachmentParams },
  }, async (request, reply) => {
    const storage = requireStorage(reply);
    if (!storage) return;

    const { projectId, taskId, attachmentId } = request.params as {
      projectId: string; taskId: string; attachmentId: string;
    };
    const { org_id } = request.user;

    const attachment = await findAttachment(projectId, taskId, attachmentId, org_id);
    // A pending upload has not been verified yet, so it is not downloadable.
    if (!attachment || attachment.status !== 'ready') {
      return reply.code(404).send({ error: 'Attachment not found' });
    }

    const url = await storage.presignDownload({
      key: attachment.storage_key,
      filename: attachment.filename,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });
    return reply.send({ url, expires_in: DOWNLOAD_URL_TTL_SECONDS });
  });

  // DELETE .../attachments/:attachmentId (uploader, or admin or higher)
  fastify.delete('/:projectId/tasks/:taskId/attachments/:attachmentId', {
    preHandler: fastify.requireRole('member'),
    schema: { params: attachmentParams },
  }, async (request, reply) => {
    const storage = requireStorage(reply);
    if (!storage) return;

    const { projectId, taskId, attachmentId } = request.params as {
      projectId: string; taskId: string; attachmentId: string;
    };
    const { org_id, user_id, role } = request.user;

    const attachment = await findAttachment(projectId, taskId, attachmentId, org_id);
    if (!attachment) return reply.code(404).send({ error: 'Attachment not found' });

    if (attachment.uploaded_by !== user_id && !hasMinRole(role, 'admin')) {
      return reply.code(403).send({ error: 'Only the uploader or an admin can delete this attachment' });
    }

    await removeAttachment(storage, attachment, org_id);
    if (attachment.status === 'ready') {
      await logActivity(org_id, user_id, taskId, 'attachment_removed', {
        attachment_id: attachmentId,
        filename: attachment.filename,
      });
    }
    return reply.code(204).send();
  });
};

export default attachmentRoutes;

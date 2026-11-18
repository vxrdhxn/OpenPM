import { FastifyPluginAsync } from 'fastify';
import { scopeOf } from '../data/scope';
import * as attachmentService from '../services/attachments';
import type { TaskPath, UploadRequest } from '../services/attachments';

/**
 * /api/projects/:projectId/tasks/:taskId/attachments. HTTP only; the upload flow and its checks are in
 * services/attachments.ts. Path ids are validated as UUIDs app-wide (plugins/uuidParams.ts).
 */

type AttachmentPath = TaskPath & { attachmentId: string };

const attachmentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  const base = '/:projectId/tasks/:taskId/attachments';

  // Request an upload URL (member or higher)
  fastify.post<{ Params: TaskPath; Body: UploadRequest }>(base, {
    preHandler: fastify.requireRole('member'),
    schema: {
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
    const result = await attachmentService.requestUpload(scopeOf(request.user), request.params, request.body);
    return reply.code(201).send(result);
  });

  // Verify the upload (uploader or admin)
  fastify.post<{ Params: AttachmentPath }>(`${base}/:attachmentId/complete`, {
    preHandler: fastify.requireRole('member'),
  }, async (request) =>
    attachmentService.completeUpload(scopeOf(request.user), request.params, request.params.attachmentId, request.log)
  );

  // List ready attachments (viewer or higher)
  fastify.get<{ Params: TaskPath }>(base, {
    preHandler: fastify.requireRole('viewer'),
  }, async (request) => attachmentService.listAttachments(scopeOf(request.user), request.params));

  // Short-lived download URL (viewer or higher)
  fastify.get<{ Params: AttachmentPath }>(`${base}/:attachmentId/download`, {
    preHandler: fastify.requireRole('viewer'),
  }, async (request) => attachmentService.downloadUrl(scopeOf(request.user), request.params, request.params.attachmentId));

  // Delete (uploader, or admin or higher)
  fastify.delete<{ Params: AttachmentPath }>(`${base}/:attachmentId`, {
    preHandler: fastify.requireRole('member'),
  }, async (request, reply) => {
    await attachmentService.deleteAttachment(scopeOf(request.user), request.params, request.params.attachmentId, request.log);
    return reply.code(204).send();
  });
};

export default attachmentRoutes;

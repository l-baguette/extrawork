import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, CompleteUploadSchema, CreateUploadSchema } from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { LocalObjectStore } from '@extrawork/files';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * Upload endpoints plus the signed-URL server for the local storage driver.
 *
 * Report §9.7: uploads go directly to object storage through a short-lived
 * signed URL, land in quarantine, and are only promoted after the scan.
 */
export async function registerFileRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const uploadLimit = rateLimit(limiter, {
    name: 'UPLOAD_CREATE',
    subject: authenticatedSubject,
  });
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });

  app.post('/v1/uploads', { preHandler: uploadLimit }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'file:upload');
    const input = CreateUploadSchema.parse(request.body);
    const result = await app.services.files.createUpload(auth, input);
    return reply.status(201).send(result);
  });

  app.post('/v1/uploads/complete', { preHandler: uploadLimit }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { fileObjectId } = CompleteUploadSchema.parse(request.body);
    const file = await app.services.files.completeUpload(auth, fileObjectId);
    return reply.send({
      id: file.id,
      filename: file.originalFilename,
      mimeType: file.detectedMimeType ?? file.declaredMimeType,
      byteSize: Number(file.byteSize),
      scanStatus: file.scanStatus,
      scanDetail: file.scanDetail,
      sha256: file.sha256?.toString('hex') ?? null,
      createdAt: file.createdAt.toISOString(),
      downloadUrl: null,
    });
  });

  app.get('/v1/files/:id', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const file = await app.repos.files.requireById(auth.tenant, id);

    const downloadUrl =
      file.scanStatus === 'CLEAN' ? await app.services.files.downloadUrl(auth, id) : null;

    return reply.send({
      id: file.id,
      filename: file.originalFilename,
      mimeType: file.detectedMimeType ?? file.declaredMimeType,
      byteSize: Number(file.byteSize),
      sha256: file.sha256?.toString('hex') ?? null,
      scanStatus: file.scanStatus,
      scanDetail: file.scanDetail,
      createdAt: file.createdAt.toISOString(),
      downloadUrl,
    });
  });

  /**
   * Signed-URL server for STORAGE_DRIVER=local.
   *
   * This is what keeps the local driver honest: bytes are never served from a
   * static directory. Each request carries an HMAC-signed, expiring token that
   * the store itself validates, mirroring what S3 does with a presigned URL.
   * Production rejects this driver outright (report §9.7, §11.3).
   */
  if (appContext.objectStore instanceof LocalObjectStore) {
    const store = appContext.objectStore;

    app.put('/v1/files/local/:token', async (request, reply) => {
      const { token } = z.object({ token: z.string().min(16) }).parse(request.params);
      const payload = store.verify(token);
      if (payload.op !== 'put') throw new AppError('NOT_FOUND');

      const body = request.body;
      const bytes = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? ''));

      if (payload.maxBytes !== undefined && bytes.byteLength > payload.maxBytes) {
        throw new AppError('FILE_TOO_LARGE');
      }
      await store.put(payload.key, bytes);
      return reply.status(200).send({ ok: true, byteSize: bytes.byteLength });
    });

    app.get('/v1/files/local/:token', async (request, reply) => {
      const { token } = z.object({ token: z.string().min(16) }).parse(request.params);
      const { filename } = z
        .object({ filename: z.string().max(255).optional() })
        .parse(request.query);
      const payload = store.verify(token);
      if (payload.op !== 'get') throw new AppError('NOT_FOUND');

      const bytes = await store.get(payload.key);
      return (
        reply
          .header('content-type', 'application/octet-stream')
          // Untrusted content is never rendered inline (report §12.2).
          .header(
            'content-disposition',
            `attachment; filename="${(filename ?? 'file').replace(/"/g, '')}"`,
          )
          .header('x-content-type-options', 'nosniff')
          .send(bytes)
      );
    });

    // Accept raw bytes for the local PUT endpoint only.
    app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });
  }
}

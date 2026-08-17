import {
  AppError,
  DOMAIN_EVENTS,
  JOB_KINDS,
  type CreateUploadInput,
  type PresignedUploadDto,
} from '@extrawork/contracts';
import { enqueueJob, newId, type FileObjectRow } from '@extrawork/db';
import { authorize } from '@extrawork/domain';
import { StorageKeys, assertUploadRequestAllowed, sanitizeFilename } from '@extrawork/files';
import type { AppContext, RequestContext } from '../context.js';

/**
 * Upload lifecycle — report §9.7.
 *
 * 1. `createUpload` validates type and size, registers metadata, and returns a
 *    short-lived signed PUT into the **quarantine** prefix.
 * 2. The client PUTs the bytes directly to storage (report §15.4: direct-to-
 *    object-storage uploads avoid API bandwidth).
 * 3. `completeUpload` enqueues the scan job.
 * 4. The worker validates magic bytes, scans, re-encodes an EXIF-stripped
 *    derivative, and promotes the object out of quarantine.
 *
 * A file is unusable — not attachable, not viewable, not embeddable in evidence
 * — until it reaches CLEAN.
 */
export class FileService {
  constructor(private readonly app: AppContext) {}

  async createUpload(
    ctx: RequestContext,
    input: CreateUploadInput,
  ): Promise<PresignedUploadDto & { fileObjectId: string }> {
    authorize(ctx.actor, 'file:upload', {
      organizationId: ctx.tenant.organizationId,
      projectId: input.projectId ?? null,
    });

    assertUploadRequestAllowed({
      contentType: input.contentType,
      byteSize: input.byteSize,
      maxUploadBytes: this.app.env.MAX_UPLOAD_BYTES,
    });

    if (input.projectId) {
      // Confirms tenant ownership before a signed URL is minted.
      await this.app.repos.projects.requireById(ctx.tenant, input.projectId);
    }

    // The id is generated first so the quarantine key can embed it, keeping the
    // key pattern in report §9.7 exact and the registration a single write.
    const fileObjectId = newId();
    const quarantineKey = StorageKeys.quarantine(
      ctx.tenant.organizationId,
      fileObjectId,
      input.filename,
    );

    const file = await this.app.uow.transaction(async (tx) =>
      this.app.repos.files.register(tx, ctx.tenant, {
        id: fileObjectId,
        projectId: input.projectId ?? null,
        storageKey: quarantineKey,
        filename: sanitizeFilename(input.filename),
        declaredMimeType: input.contentType,
        byteSize: BigInt(input.byteSize),
        purpose: input.purpose,
        sha256: input.sha256 ? Buffer.from(input.sha256, 'hex') : null,
      }),
    );

    const upload = await this.app.objectStore.createUpload({
      key: quarantineKey,
      contentType: input.contentType,
      byteSize: input.byteSize,
      ttlSeconds: this.app.env.SIGNED_URL_TTL_SECONDS,
    });

    return {
      fileObjectId: file.id,
      uploadUrl: upload.url,
      method: upload.method,
      headers: upload.headers,
      expiresAt: upload.expiresAt.toISOString(),
      maxBytes: input.byteSize,
    };
  }

  async completeUpload(ctx: RequestContext, fileObjectId: string): Promise<FileObjectRow> {
    const file = await this.app.repos.files.requireById(ctx.tenant, fileObjectId);
    authorize(ctx.actor, 'file:upload', {
      organizationId: file.organizationId,
      projectId: file.projectId,
    });

    // The bytes must actually be there before a scan is worth queueing.
    if (!(await this.app.objectStore.exists(file.storageKey))) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'The upload did not complete. Try again.',
      });
    }

    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.files.markUploaded(tx, ctx.tenant, fileObjectId);
      await enqueueJob(tx, {
        kind: JOB_KINDS.SCAN_FILE,
        organizationId: ctx.tenant.organizationId,
        dedupeKey: `scan:${fileObjectId}`,
        payload: { fileObjectId },
      });
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'file',
          aggregateId: fileObjectId,
          projectId: file.projectId,
          eventType: DOMAIN_EVENTS.FILE_UPLOAD_REGISTERED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            filename: file.originalFilename,
            declaredMimeType: file.declaredMimeType,
            byteSize: file.byteSize.toString(),
          },
        },
      ]);
    });

    return this.app.repos.files.requireById(ctx.tenant, fileObjectId);
  }

  /** Short-lived signed read, issued only after authorization and a clean scan. */
  async downloadUrl(ctx: RequestContext, fileObjectId: string): Promise<string> {
    const file = await this.app.repos.files.requireById(ctx.tenant, fileObjectId);
    authorize(ctx.actor, 'file:read', {
      organizationId: file.organizationId,
      projectId: file.projectId,
    });
    this.app.repos.files.assertViewable(file);

    return this.app.objectStore.createDownload(
      file.promotedStorageKey ?? file.storageKey,
      this.app.env.SIGNED_URL_TTL_SECONDS,
      file.originalFilename,
    );
  }
}

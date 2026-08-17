import { createHash } from 'node:crypto';
import { DOMAIN_EVENTS } from '@extrawork/contracts';
import type { JobRow } from '@extrawork/db';
import { StorageKeys, processUploadedFile } from '@extrawork/files';
import { systemTenantContext } from '@extrawork/domain';
import type { WorkerContext } from '../context.js';
import { PermanentJobError, requireTenant } from '../runner.js';

/**
 * Quarantine pipeline — report §9.7 and §12.1.
 *
 * "Uploads first enter a quarantine prefix; worker verifies size, magic-byte
 * MIME, image decodability, hash, and malware scan before promotion."
 *
 * A rejected file is never promoted and never gets a display derivative, so it
 * can never be served to a customer. The original quarantine object is removed
 * once the verdict is recorded.
 */

interface ScanPayload {
  fileObjectId: string;
  organizationId: string;
}

export async function scanFile(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = job.payload as unknown as ScanPayload;
  const organizationId = requireTenant(job, payload.organizationId);
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const log = ctx.logger.child({ fileObjectId: payload.fileObjectId });

  const claimed = await ctx.repos.files.claimForScan(ctx.db, payload.fileObjectId);
  if (!claimed) {
    log.info('file already scanned or in flight');
    return;
  }

  const file = await ctx.repos.files.findById(tenant, payload.fileObjectId);
  if (!file) throw new PermanentJobError('FILE_MISSING', 'File object no longer exists');

  let bytes: Buffer;
  try {
    bytes = await ctx.app.objectStore.get(file.storageKey);
  } catch (error) {
    // The client may not have completed the PUT yet; that is retryable.
    log.warn({ err: error }, 'quarantined object not readable yet');
    throw error;
  }

  const result = await processUploadedFile(
    bytes,
    file.declaredMimeType ?? 'application/octet-stream',
    Number(file.byteSize),
    ctx.app.scanner,
    file.originalFilename,
  );

  const sha256 = createHash('sha256').update(bytes).digest();

  if (result.scan.verdict !== 'CLEAN') {
    await ctx.repos.files.recordScanResult(ctx.db, file.id, {
      status: result.scan.verdict,
      detail: result.scan.detail,
      detectedMimeType: result.validation.detectedMimeType,
      sha256,
      promotedStorageKey: null,
      derivativeStorageKey: null,
      imageWidth: null,
      imageHeight: null,
      storageVersion: null,
    });
    // A rejected object is deleted rather than left sitting in quarantine.
    await ctx.app.objectStore.delete(file.storageKey).catch(() => undefined);
    log.warn({ verdict: result.scan.verdict, detail: result.scan.detail }, 'file rejected');
    return;
  }

  // Promote out of quarantine only now that the bytes have passed everything.
  const promotedKey = StorageKeys.source(
    organizationId,
    file.projectId,
    file.id,
    file.originalFilename,
  );
  const moved = await ctx.app.objectStore.move(file.storageKey, promotedKey);

  let derivativeKey: string | null = null;
  if (result.derivative) {
    derivativeKey = StorageKeys.derivative(organizationId, file.projectId, file.id);
    await ctx.app.objectStore.put(
      derivativeKey,
      result.derivative.bytes,
      result.derivative.contentType,
    );
  }

  await ctx.repos.files.recordScanResult(ctx.db, file.id, {
    status: 'CLEAN',
    detail: null,
    detectedMimeType: result.validation.detectedMimeType,
    sha256,
    promotedStorageKey: promotedKey,
    derivativeStorageKey: derivativeKey,
    imageWidth: result.derivative?.width ?? result.imageWidth,
    imageHeight: result.derivative?.height ?? result.imageHeight,
    storageVersion: moved.versionId,
  });

  await ctx.app.uow.transaction(async (tx) => {
    await ctx.repos.audit.append(tx, tenant, [
      {
        aggregateType: 'file',
        aggregateId: file.id,
        projectId: file.projectId,
        eventType: DOMAIN_EVENTS.FILE_SCAN_COMPLETED,
        actorType: 'SYSTEM',
        actorId: null,
        occurredAt: ctx.app.clock.now(),
        payload: {
          verdict: 'CLEAN',
          detectedMimeType: result.validation.detectedMimeType,
          sha256: sha256.toString('hex'),
          hasDerivative: derivativeKey !== null,
        },
      },
    ]);
  });

  log.info({ hasDerivative: derivativeKey !== null }, 'file scanned and promoted');
}

import { createHash } from 'node:crypto';
import { DOMAIN_EVENTS } from '@extrawork/contracts';
import type { JobRow } from '@extrawork/db';
import { StorageKeys, processUploadedFile } from '@extrawork/files';
import { systemTenantContext } from '@extrawork/domain';
import type { WorkerContext } from '../context.js';
import {
  optionalPayloadString,
  PermanentJobError,
  requirePayloadUuid,
  requireTenant,
} from '../runner.js';

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

export async function scanFile(job: JobRow, ctx: WorkerContext): Promise<void> {
  const fileObjectId = requirePayloadUuid(job, 'fileObjectId');
  const organizationId = requireTenant(job, optionalPayloadString(job, 'organizationId'));
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const log = ctx.logger.child({ fileObjectId });
  const leaseToken = `${job.id}:${job.attemptCount}`;

  const claimed = await ctx.repos.files.claimForScan(
    ctx.db,
    organizationId,
    fileObjectId,
    leaseToken,
    ctx.env.WORKER_LEASE_SECONDS,
  );
  if (!claimed) {
    log.info('file already scanned or in flight');
    return;
  }

  try {
    const file = await ctx.repos.files.findById(tenant, fileObjectId);
    if (!file) throw new PermanentJobError('FILE_MISSING', 'File object no longer exists');

    const metadata = await ctx.app.objectStore.head(file.storageKey);
    if (metadata.byteSize > ctx.env.MAX_UPLOAD_BYTES) {
      const recorded = await ctx.repos.files.recordScanResult(
        ctx.db,
        organizationId,
        file.id,
        leaseToken,
        {
          status: 'REJECTED',
          detail: `Stored object exceeds the ${ctx.env.MAX_UPLOAD_BYTES} byte upload limit`,
          detectedMimeType: null,
          sha256: null,
          promotedStorageKey: null,
          derivativeStorageKey: null,
          imageWidth: null,
          imageHeight: null,
          storageVersion: metadata.versionId,
        },
      );
      if (recorded) await ctx.app.objectStore.delete(file.storageKey).catch(() => undefined);
      return;
    }
    const bytes = await ctx.app.objectStore.get(file.storageKey, ctx.env.MAX_UPLOAD_BYTES);

    const result = await processUploadedFile(
      bytes,
      file.declaredMimeType ?? 'application/octet-stream',
      Number(file.byteSize),
      ctx.app.scanner,
      file.originalFilename,
    );

    const sha256 = createHash('sha256').update(bytes).digest();

    if (result.scan.verdict !== 'CLEAN') {
      const recorded = await ctx.repos.files.recordScanResult(
        ctx.db,
        organizationId,
        file.id,
        leaseToken,
        {
          status: result.scan.verdict,
          detail: result.scan.detail,
          detectedMimeType: result.validation.detectedMimeType,
          sha256,
          promotedStorageKey: null,
          derivativeStorageKey: null,
          imageWidth: null,
          imageHeight: null,
          storageVersion: null,
        },
      );
      if (recorded && result.scan.verdict === 'REJECTED') {
        // Only terminal rejection removes quarantine. A FAILED scanner verdict
        // is retryable and must leave the bytes available for the next attempt.
        await ctx.app.objectStore.delete(file.storageKey).catch(() => undefined);
        log.warn({ verdict: result.scan.verdict, detail: result.scan.detail }, 'file rejected');
      } else if (!recorded) {
        log.warn('scan verdict discarded because this worker lost the file lease');
      }
      if (result.scan.verdict === 'FAILED') {
        throw new Error(result.scan.detail ?? 'Malware scanner failed');
      }
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

    const recorded = await ctx.repos.files.recordScanResult(
      ctx.db,
      organizationId,
      file.id,
      leaseToken,
      {
        status: 'CLEAN',
        detail: null,
        detectedMimeType: result.validation.detectedMimeType,
        sha256,
        promotedStorageKey: promotedKey,
        derivativeStorageKey: derivativeKey,
        imageWidth: result.derivative?.width ?? result.imageWidth,
        imageHeight: result.derivative?.height ?? result.imageHeight,
        storageVersion: moved.versionId,
      },
    );
    if (!recorded) {
      log.warn('scan result discarded because this worker lost the file lease');
      return;
    }

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
  } catch (error) {
    // Release only our own lease. A newer worker's state is never overwritten.
    await ctx.repos.files
      .recordScanResult(ctx.db, organizationId, fileObjectId, leaseToken, {
        status: 'FAILED',
        detail: String((error as Error).message).slice(0, 2_000),
        detectedMimeType: null,
        sha256: null,
        promotedStorageKey: null,
        derivativeStorageKey: null,
        imageWidth: null,
        imageHeight: null,
        storageVersion: null,
      })
      .catch(() => false);
    log.warn({ err: error }, 'file scan attempt failed');
    throw error;
  }
}

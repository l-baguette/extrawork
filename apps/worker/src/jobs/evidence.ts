import { createHash } from 'node:crypto';
import { buildEvidenceViewModel } from '@extrawork/application';
import { AppError } from '@extrawork/contracts';
import { StorageKeys } from '@extrawork/files';
import { systemTenantContext } from '@extrawork/domain';
import type { JobRow } from '@extrawork/db';
import type { WorkerContext } from '../context.js';
import { PermanentJobError } from '../runner.js';
import { renderEvidenceHtml } from '../pdf/template.js';

/**
 * Evidence pack generation — report §8.5.
 *
 * Produces a PDF *and* a machine-readable manifest, records the template
 * version, renderer version, generated file hash, storage object version and
 * generation time, and stores the object under the private evidence prefix.
 *
 * Idempotent by construction (report §13.4, at-least-once): `claimForGeneration`
 * only succeeds from PENDING/FAILED, so a duplicate delivery of the same job is
 * a no-op rather than a second document.
 *
 * The view-model builder re-verifies the snapshot digest and the audit chain
 * before rendering. Report §8.1 requires an integrity mismatch to *block* new
 * evidence, so that failure is permanent, not retried.
 */

export const EVIDENCE_GENERATOR_VERSION = 'evidence-generator-v1';

interface EvidencePayload {
  documentId: string;
  versionId: string;
  organizationId: string;
}

export async function generateEvidence(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = job.payload as unknown as EvidencePayload;
  // The tenant comes from the job row: `enqueueJob` records it inside the same
  // transaction as the decision, so it is authoritative and always present.
  // Reading it from the payload would depend on every producer remembering to
  // include it.
  const organizationId = job.organizationId ?? payload.organizationId;
  if (!organizationId) {
    throw new PermanentJobError('NO_TENANT', 'Evidence job has no organization scope');
  }
  const log = ctx.logger.child({ documentId: payload.documentId, versionId: payload.versionId });

  const claimed = await ctx.repos.documents.claimForGeneration(ctx.db, payload.documentId);
  if (!claimed) {
    log.info('evidence document already generated or in flight; nothing to do');
    return;
  }

  try {
    const rendererVersion = await ctx.pdf.rendererVersion();
    const model = await buildEvidenceViewModel({
      db: ctx.db,
      repos: ctx.repos,
      versionId: payload.versionId,
      organizationId: organizationId,
      requestId: `job:${job.id}`,
      generatorVersion: EVIDENCE_GENERATOR_VERSION,
      rendererVersion,
      now: ctx.app.clock.now(),
    });

    const html = renderEvidenceHtml(model);
    const pdf = await ctx.pdf.render(html, { timeoutMs: ctx.env.PDF_TIMEOUT_MS });

    const tenant = systemTenantContext(organizationId, `job:${job.id}`);
    const version = await ctx.repos.changeOrders.requireVersion(ctx.db, tenant, payload.versionId);

    const key = StorageKeys.evidence(
      organizationId,
      version.projectId,
      payload.versionId,
      payload.documentId,
    );
    const stored = await ctx.app.objectStore.put(key, pdf, 'application/pdf');

    // The stored manifest is the document itself, and its digest is the one the
    // builder computed over that document — so a recipient holding only the
    // manifest JSON can recompute and verify it (report §8.5).
    const manifestSha256 = Buffer.from(model.manifestSha256, 'hex');

    await ctx.repos.documents.markReady(ctx.db, payload.documentId, {
      storageKey: key,
      fileSha256: createHash('sha256').update(pdf).digest(),
      byteSize: BigInt(pdf.byteLength),
      rendererVersion,
      generatorVersion: EVIDENCE_GENERATOR_VERSION,
      storageObjectVersion: stored.versionId,
      manifest: model.manifest,
      manifestSha256,
    });

    log.info(
      {
        bytes: pdf.byteLength,
        templateVersion: model.templateVersion,
        chainVerified: model.render.chainVerified,
      },
      'evidence pack generated',
    );
  } catch (error) {
    await ctx.repos.documents
      .markFailed(ctx.db, payload.documentId, truncate((error as Error).message))
      .catch(() => undefined);

    // An integrity failure or a version that cannot legitimately have evidence
    // will fail identically on every retry; dead-letter it so an operator sees
    // it instead of burning the backoff schedule.
    if (
      AppError.is(error) &&
      (error.code === 'INVALID_STATE_TRANSITION' || error.code === 'PROJECT_INTEGRITY_REVIEW')
    ) {
      throw new PermanentJobError(error.code, error.message);
    }
    throw error;
  }
}

function truncate(value: string, max = 480): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

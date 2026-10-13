import { createHash } from 'node:crypto';
import {
  buildEvidenceViewModel,
  formatInTimezone,
  type EvidenceViewModel,
} from '@extrawork/application';
import { AppError, DOMAIN_EVENTS } from '@extrawork/contracts';
import type { JobRow } from '@extrawork/db';
import { StorageKeys } from '@extrawork/files';
import { canonicalize, formatMoney, systemTenantContext } from '@extrawork/domain';
import type { WorkerContext } from '../context.js';
import {
  optionalPayloadString,
  PermanentJobError,
  requirePayloadUuid,
  requireTenant,
} from '../runner.js';
import { renderProjectEvidencePackHtml } from '../pdf/template.js';

/**
 * Export generation — report §10.5 (CSV/PDF first) and §16.3, which makes
 * "a customer can export records even after subscription lapse" a launch
 * blocker. Exports are therefore deliberately reachable in read-only mode.
 *
 * The output is a CSV plus a manifest whose digest is recorded, so an export
 * handed to an accountant can be tied back to the records it came from.
 */

export const EXPORT_TEMPLATE_VERSION = 'accounting-csv-v1';
export const PROJECT_EVIDENCE_PACK_TEMPLATE_VERSION = 'evidence-pack-v1';
export const PROJECT_EVIDENCE_PACK_GENERATOR_VERSION = 'project-evidence-generator-v1';

interface ExportPayload {
  exportId: string;
  organizationId: string | undefined;
}

export async function generateExport(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = parseExportPayload(job);
  const organizationId = requireTenant(job, payload.organizationId);
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const log = ctx.logger.child({ exportId: payload.exportId });
  const leaseToken = `${job.id}:${job.attemptCount}`;

  const claimed = await ctx.repos.documents.claimForGeneration(
    ctx.db,
    organizationId,
    payload.exportId,
    leaseToken,
    ctx.env.WORKER_LEASE_SECONDS,
  );
  if (!claimed) {
    log.info('export already generated or in flight');
    return;
  }

  const document = await ctx.repos.documents.findById(tenant, payload.exportId);
  if (!document) throw new PermanentJobError('EXPORT_MISSING', 'Export record no longer exists');

  try {
    if (!document.projectId) {
      throw new PermanentJobError(
        'EXPORT_SCOPE_MISSING',
        'Project exports require a project scope in this release',
      );
    }

    const generated =
      document.kind === 'PROJECT_EVIDENCE_PACK'
        ? await generateProjectEvidencePack({
            ctx,
            exportId: payload.exportId,
            organizationId,
            projectId: document.projectId,
            generationToken: leaseToken,
          })
        : document.kind === 'ACCOUNTING_CSV'
          ? await generateAccountingCsv({
              ctx,
              exportId: payload.exportId,
              organizationId,
              projectId: document.projectId,
              generationToken: leaseToken,
            })
          : null;

    if (!generated) {
      throw new PermanentJobError(
        'EXPORT_KIND_UNSUPPORTED',
        `Export kind ${document.kind} is not implemented`,
      );
    }

    const stored = await ctx.app.objectStore.put(
      generated.key,
      generated.bytes,
      generated.contentType,
    );

    const recorded = await ctx.repos.documents.markReady(
      ctx.db,
      organizationId,
      payload.exportId,
      leaseToken,
      {
        storageKey: generated.key,
        fileSha256: createHash('sha256').update(generated.bytes).digest(),
        byteSize: BigInt(generated.bytes.byteLength),
        rendererVersion: generated.rendererVersion,
        generatorVersion: generated.generatorVersion,
        storageObjectVersion: stored.versionId,
        manifest: generated.manifest,
        manifestSha256: generated.manifestSha256,
      },
    );
    if (!recorded) {
      await ctx.app.objectStore.delete(generated.key).catch(() => undefined);
      log.warn('generated export discarded because this worker lost the document lease');
      return;
    }

    await ctx.app.uow.transaction(async (tx) => {
      await ctx.repos.audit.append(tx, tenant, [
        {
          aggregateType: document.projectId ? 'project' : 'organization',
          aggregateId: document.projectId ?? organizationId,
          projectId: document.projectId,
          eventType: DOMAIN_EVENTS.PROJECT_EXPORT_GENERATED,
          actorType: 'SYSTEM',
          actorId: null,
          occurredAt: ctx.app.clock.now(),
          payload: {
            exportId: payload.exportId,
            kind: document.kind,
            recordCount: generated.recordCount,
          },
        },
      ]);
    });

    log.info(
      { kind: document.kind, records: generated.recordCount, bytes: generated.bytes.byteLength },
      'export generated',
    );
  } catch (error) {
    await ctx.repos.documents
      .markFailed(
        ctx.db,
        organizationId,
        payload.exportId,
        leaseToken,
        String((error as Error).message),
      )
      .catch(() => undefined);
    if (
      AppError.is(error) &&
      (error.code === 'INVALID_STATE_TRANSITION' || error.code === 'PROJECT_INTEGRITY_REVIEW')
    ) {
      throw new PermanentJobError(error.code, error.message);
    }
    throw error;
  }
}

interface GeneratedExport {
  bytes: Buffer;
  contentType: string;
  key: string;
  rendererVersion: string;
  generatorVersion: string;
  manifest: Record<string, unknown>;
  manifestSha256: Buffer;
  recordCount: number;
}

async function generateProjectEvidencePack(input: {
  ctx: WorkerContext;
  exportId: string;
  organizationId: string;
  projectId: string;
  generationToken: string;
}): Promise<GeneratedExport> {
  const { ctx, exportId, organizationId, projectId, generationToken } = input;
  const tenant = systemTenantContext(organizationId, `export:${exportId}`);
  const generatedAt = ctx.app.clock.now();
  const [project, organization, versions, rendererVersion] = await Promise.all([
    ctx.repos.projects.requireById(tenant, projectId),
    ctx.repos.organizations.findById(tenant),
    ctx.repos.changeOrders.listFrozenVersionsForProject(ctx.db, tenant, projectId),
    ctx.pdf.rendererVersion(),
  ]);
  if (!organization) {
    throw new PermanentJobError('ORGANIZATION_MISSING', 'Export organization no longer exists');
  }

  // Build sequentially. Each model performs several integrity reads; an
  // unbounded Promise.all would turn a large project export into a connection
  // burst and could starve interactive API traffic.
  const records: EvidenceViewModel[] = [];
  for (const version of versions) {
    records.push(
      await buildEvidenceViewModel({
        db: ctx.db,
        repos: ctx.repos,
        versionId: version.id,
        organizationId,
        requestId: `job:${exportId}`,
        generatorVersion: PROJECT_EVIDENCE_PACK_GENERATOR_VERSION,
        rendererVersion,
        now: generatedAt,
      }),
    );
  }

  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    kind: 'PROJECT_EVIDENCE_PACK',
    exportId,
    organization: {
      id: organizationId,
      displayName: organization.displayName,
      legalName: organization.legalName,
    },
    project: {
      id: project.id,
      number: project.projectNumber,
      title: project.title,
      currency: project.currency,
      timezone: project.timezone,
    },
    generation: {
      generatedAt: generatedAt.toISOString(),
      templateVersion: PROJECT_EVIDENCE_PACK_TEMPLATE_VERSION,
      rendererVersion,
      generatorVersion: PROJECT_EVIDENCE_PACK_GENERATOR_VERSION,
    },
    records: versions.map((version, index) => ({
      versionId: version.id,
      changeOrderId: version.changeOrderId,
      versionNumber: version.versionNumber,
      status: version.status,
      canonicalSha256: version.canonicalSha256?.toString('hex') ?? null,
      manifestSha256: records[index]?.manifestSha256 ?? null,
      manifest: records[index]?.manifest ?? null,
    })),
  };
  const manifestSha256 = createHash('sha256')
    .update(canonicalize(manifest as never), 'utf8')
    .digest();
  const html = renderProjectEvidencePackHtml({
    organizationName: organization.displayName,
    organizationLegalName: organization.legalName,
    projectNumber: project.projectNumber,
    projectTitle: project.title,
    generatedAt: formatInTimezone(generatedAt, project.timezone),
    templateVersion: PROJECT_EVIDENCE_PACK_TEMPLATE_VERSION,
    manifestSha256: manifestSha256.toString('hex'),
    records,
  });
  const bytes = await ctx.pdf.render(html, { timeoutMs: ctx.env.PDF_TIMEOUT_MS });

  return {
    bytes,
    contentType: 'application/pdf',
    key: StorageKeys.export(organizationId, exportId, 'pdf', generationToken),
    rendererVersion,
    generatorVersion: PROJECT_EVIDENCE_PACK_GENERATOR_VERSION,
    manifest,
    manifestSha256,
    recordCount: records.length,
  };
}

async function generateAccountingCsv(input: {
  ctx: WorkerContext;
  exportId: string;
  organizationId: string;
  projectId: string;
  generationToken: string;
}): Promise<GeneratedExport> {
  const { ctx, exportId, organizationId, projectId, generationToken } = input;
  const tenant = systemTenantContext(organizationId, `export:${exportId}`);
  const rows = await ctx.repos.reporting.approvedChangesForExport(tenant, projectId);
  const bytes = Buffer.from(toCsv(rows), 'utf8');
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    kind: 'ACCOUNTING_CSV',
    exportId,
    organizationId,
    projectId,
    templateVersion: EXPORT_TEMPLATE_VERSION,
    generatedAt: ctx.app.clock.now().toISOString(),
    rowCount: rows.length,
    changeNumbers: rows.map((row) => row.changeNumber).sort(),
    csvSha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return {
    bytes,
    contentType: 'text/csv; charset=utf-8',
    key: StorageKeys.export(organizationId, exportId, 'csv', generationToken),
    rendererVersion: 'csv',
    generatorVersion: EXPORT_TEMPLATE_VERSION,
    manifest,
    manifestSha256: createHash('sha256')
      .update(canonicalize(manifest as never), 'utf8')
      .digest(),
    recordCount: rows.length,
  };
}

function parseExportPayload(job: JobRow): ExportPayload {
  return {
    exportId: requirePayloadUuid(job, 'exportId'),
    organizationId: optionalPayloadString(job, 'organizationId'),
  };
}

const HEADERS = [
  'change_number',
  'project_ref',
  'external_customer_ref',
  'approved_at',
  'currency',
  'line_description',
  'quantity',
  'unit_rate_minor',
  'tax_rate_bps',
  'line_total_minor',
  'line_total_display',
] as const;

/**
 * One row per line item so the file drops straight into an accounting import.
 * Amounts stay in minor units as text: a spreadsheet must not be able to
 * reinterpret a paise integer as a float (report §8.1, §10.5).
 */
function toCsv(
  rows: ReadonlyArray<{
    changeNumber: string;
    projectRef: string;
    approvedAt: Date;
    currency: string;
    lineItems: ReadonlyArray<{
      description: string;
      quantity: string;
      unitRateMinor: string;
      taxRateBps: number;
      totalMinor: string;
    }>;
  }>,
): string {
  const lines: string[] = [HEADERS.join(',')];
  for (const row of rows) {
    for (const item of row.lineItems) {
      lines.push(
        [
          row.changeNumber,
          row.projectRef,
          '',
          row.approvedAt.toISOString(),
          row.currency,
          item.description,
          item.quantity,
          item.unitRateMinor,
          String(item.taxRateBps),
          item.totalMinor,
          formatMoney(BigInt(item.totalMinor), row.currency),
        ]
          .map(csvCell)
          .join(','),
      );
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Quotes per RFC 4180 and neutralises spreadsheet formula injection: a cell
 * beginning `=`, `+`, `-` or `@` is prefixed with a single quote so Excel
 * treats it as text (an export is untrusted input to whoever opens it).
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

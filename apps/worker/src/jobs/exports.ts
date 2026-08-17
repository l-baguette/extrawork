import { createHash } from 'node:crypto';
import { DOMAIN_EVENTS } from '@extrawork/contracts';
import type { JobRow } from '@extrawork/db';
import { StorageKeys } from '@extrawork/files';
import { canonicalize, formatMoney, systemTenantContext } from '@extrawork/domain';
import type { WorkerContext } from '../context.js';
import { PermanentJobError, requireTenant } from '../runner.js';

/**
 * Export generation — report §10.5 (CSV/PDF first) and §16.3, which makes
 * "a customer can export records even after subscription lapse" a launch
 * blocker. Exports are therefore deliberately reachable in read-only mode.
 *
 * The output is a CSV plus a manifest whose digest is recorded, so an export
 * handed to an accountant can be tied back to the records it came from.
 */

export const EXPORT_TEMPLATE_VERSION = 'accounting-csv-v1';

interface ExportPayload {
  exportId: string;
  organizationId: string;
}

export async function generateExport(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = job.payload as unknown as ExportPayload;
  const organizationId = requireTenant(job, payload.organizationId);
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const log = ctx.logger.child({ exportId: payload.exportId });

  const claimed = await ctx.repos.documents.claimForGeneration(ctx.db, payload.exportId);
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
        'Accounting exports are scoped to a project in this release',
      );
    }
    const rows = await ctx.repos.reporting.approvedChangesForExport(tenant, document.projectId);

    const csv = toCsv(rows);
    const bytes = Buffer.from(csv, 'utf8');
    const key = StorageKeys.export(organizationId, payload.exportId);
    const stored = await ctx.app.objectStore.put(key, bytes, 'text/csv; charset=utf-8');

    const manifest = {
      schemaVersion: 1,
      exportId: payload.exportId,
      organizationId: organizationId,
      projectId: document.projectId,
      templateVersion: EXPORT_TEMPLATE_VERSION,
      generatedAt: ctx.app.clock.now().toISOString(),
      rowCount: rows.length,
      changeNumbers: rows.map((r) => r.changeNumber).sort(),
      csvSha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const manifestSha256 = createHash('sha256')
      .update(canonicalize(manifest as never), 'utf8')
      .digest();

    await ctx.repos.documents.markReady(ctx.db, payload.exportId, {
      storageKey: key,
      fileSha256: createHash('sha256').update(bytes).digest(),
      byteSize: BigInt(bytes.byteLength),
      rendererVersion: 'csv',
      generatorVersion: EXPORT_TEMPLATE_VERSION,
      storageObjectVersion: stored.versionId,
      manifest,
      manifestSha256,
    });

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
          payload: { exportId: payload.exportId, rowCount: rows.length },
        },
      ]);
    });

    log.info({ rows: rows.length, bytes: bytes.byteLength }, 'export generated');
  } catch (error) {
    await ctx.repos.documents
      .markFailed(ctx.db, payload.exportId, String((error as Error).message))
      .catch(() => undefined);
    throw error;
  }
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

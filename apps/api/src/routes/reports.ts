import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateEvidencePackSchema, JOB_KINDS, ReportQuerySchema } from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { enqueueJob } from '@extrawork/db';
import { authorize, formatMoney } from '@extrawork/domain';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * Reports and exports — report §6.2 `/app/reports`, §10.5 accounting export.
 *
 * Export stays available in read-only mode: report §16.3 makes "a customer can
 * export records even after subscription lapse" a launch gate.
 */
export async function registerReportRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });

  app.get('/v1/reports/extra-work', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'report:read', { organizationId: auth.actor.organizationId });

    const query = ReportQuerySchema.parse(request.query);
    const rows = await app.repos.reporting.extraWorkReport(auth.tenant, query);

    const totals = rows.reduce(
      (acc, row) => ({
        currency: row.currency,
        count: acc.count + 1,
        subtotalDeltaMinor: acc.subtotalDeltaMinor + row.subtotalDeltaMinor,
        taxDeltaMinor: acc.taxDeltaMinor + row.taxDeltaMinor,
        totalDeltaMinor: acc.totalDeltaMinor + row.totalDeltaMinor,
      }),
      { currency: 'INR', count: 0, subtotalDeltaMinor: 0n, taxDeltaMinor: 0n, totalDeltaMinor: 0n },
    );

    return reply.send({
      rows: rows.map((r) => ({
        ...r,
        subtotalDeltaMinor: Number(r.subtotalDeltaMinor),
        taxDeltaMinor: Number(r.taxDeltaMinor),
        totalDeltaMinor: Number(r.totalDeltaMinor),
        sentAt: r.sentAt?.toISOString() ?? null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
      })),
      totals: {
        currency: totals.currency,
        count: totals.count,
        subtotalDeltaMinor: Number(totals.subtotalDeltaMinor),
        taxDeltaMinor: Number(totals.taxDeltaMinor),
        totalDeltaMinor: Number(totals.totalDeltaMinor),
      },
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/v1/reports/extra-work.csv', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'report:export', { organizationId: auth.actor.organizationId });

    const query = ReportQuerySchema.parse(request.query);
    const rows = await app.repos.reporting.extraWorkReport(auth.tenant, query);

    const header = [
      'change_number',
      'version',
      'project_number',
      'project_title',
      'customer',
      'title',
      'status',
      'currency',
      'subtotal_delta_minor',
      'tax_delta_minor',
      'total_delta_minor',
      'total_delta_display',
      'schedule_delta_days',
      'sent_at',
      'decided_at',
      'decision',
      'assurance',
      'created_by',
    ];

    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(
        [
          row.number,
          row.versionNumber,
          row.projectNumber,
          row.projectTitle,
          row.customerName,
          row.title,
          row.status,
          row.currency,
          // Minor units as integers so a spreadsheet cannot introduce a float.
          row.subtotalDeltaMinor.toString(),
          row.taxDeltaMinor.toString(),
          row.totalDeltaMinor.toString(),
          formatMoney(row.totalDeltaMinor, row.currency),
          row.scheduleDeltaDays,
          row.sentAt?.toISOString() ?? '',
          row.decidedAt?.toISOString() ?? '',
          row.decisionType ?? '',
          row.assuranceAchieved ?? '',
          row.createdBy,
        ]
          .map(csvCell)
          .join(','),
      );
    }

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="extrawork-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      )
      .send(`${lines.join('\n')}\n`);
  });

  /** Accounting hand-off model (report §10.5). */
  app.get('/v1/projects/:id/accounting-export', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const project = await app.repos.projects.requireById(auth.tenant, id);
    authorize(auth.actor, 'project:export', {
      organizationId: project.organizationId,
      projectId: id,
    });

    const changes = await app.repos.reporting.approvedChangesForExport(auth.tenant, id);
    return reply.send({
      projectRef: project.projectNumber,
      currency: project.currency,
      changes: changes.map((c) => ({
        externalCustomerRef: null,
        projectRef: c.projectRef,
        changeNumber: c.changeNumber,
        approvedAt: c.approvedAt.toISOString(),
        currency: c.currency,
        lineItems: c.lineItems,
      })),
    });
  });

  app.post('/v1/projects/:id/evidence-pack', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    CreateEvidencePackSchema.parse(request.body ?? {});

    const project = await app.repos.projects.requireById(auth.tenant, id);
    authorize(auth.actor, 'project:export', {
      organizationId: project.organizationId,
      projectId: id,
    });

    const documentId = await appContext.uow.transaction(async (tx) => {
      const docId = await app.repos.documents.requestExport(tx, auth.tenant, {
        projectId: id,
        kind: 'PROJECT_EVIDENCE_PACK',
        templateVersion: 'evidence-pack-v1',
      });
      await enqueueJob(tx, {
        kind: JOB_KINDS.GENERATE_EXPORT,
        organizationId: auth.actor.organizationId,
        dedupeKey: `export:${docId}`,
        payload: { documentId: docId, projectId: id, kind: 'PROJECT_EVIDENCE_PACK' },
      });
      return docId;
    });

    return reply.status(202).send({ id: documentId, status: 'PENDING' });
  });

  app.get('/v1/exports/:id', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const document = await app.repos.documents.findById(auth.tenant, id);
    if (!document) return reply.status(404).send({ error: { code: 'NOT_FOUND' } });

    const downloadUrl =
      document.status === 'READY' && document.storageKey
        ? await appContext.objectStore.createDownload(
            document.storageKey,
            app.env.SIGNED_URL_TTL_SECONDS,
            `export-${document.id}.zip`,
          )
        : null;

    return reply.send({
      id: document.id,
      kind: document.kind,
      status: document.status,
      requestedAt: document.requestedAt.toISOString(),
      completedAt: document.generatedAt?.toISOString() ?? null,
      downloadUrl,
      manifestSha256: document.manifestSha256?.toString('hex') ?? null,
      error: document.error,
    });
  });
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  // Guard against CSV formula injection in spreadsheet software.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

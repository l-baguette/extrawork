import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BaselineAmendmentSchema,
  BaselineInputSchema,
  CloseProjectSchema,
  CreateProjectSchema,
  ListProjectsQuerySchema,
  ReopenProjectSchema,
  SearchQuerySchema,
  UpdateProjectSchema,
} from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import type { ChangeOrderSummaryRow } from '@extrawork/db';
import { authorize, projectAccessFilter } from '@extrawork/domain';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

const IdParams = z.object({ id: z.string().uuid() });

export async function registerProjectRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });
  const write = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });

  app.get('/v1/projects', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'project:read', { organizationId: auth.actor.organizationId });

    const query = ListProjectsQuerySchema.parse(request.query);
    const result = await app.repos.projects.list(auth.tenant, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.query ? { query: query.query } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
      projectGrants: projectAccessFilter(auth.actor),
    });

    return reply.send({
      items: result.items.map(summariseProject),
      nextCursor: result.nextCursor,
    });
  });

  app.post('/v1/projects', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'project:create');
    const input = CreateProjectSchema.parse(request.body);
    const project = await app.services.projects.createProject(auth, input);
    return reply.status(201).send({
      id: project.id,
      projectNumber: project.projectNumber,
      revisedTotalMinor: Number(project.revisedTotalMinor),
    });
  });

  app.get('/v1/projects/:id', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const totals = await app.services.projects.projectTotals(auth.tenant, id);
    authorize(auth.actor, 'project:read', {
      organizationId: totals.project.organizationId,
      projectId: id,
    });
    return reply.send(fullProject(totals));
  });

  app.patch('/v1/projects/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const patch = UpdateProjectSchema.parse(request.body);

    const existing = await app.repos.projects.requireById(auth.tenant, id);
    authorize(auth.actor, 'project:update', {
      organizationId: existing.organizationId,
      projectId: id,
    });
    app.requireWrite(request, 'project:update');

    const updated = await appContext.uow.transaction((tx) =>
      app.repos.projects.update(tx, auth.tenant, id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description?.trim() || null }
          : {}),
        ...(patch.siteAddress !== undefined ? { siteAddress: patch.siteAddress } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
        ...(patch.expectedCompletionDate !== undefined
          ? { expectedCompletionDate: patch.expectedCompletionDate }
          : {}),
        ...(patch.defaultApproverContactId !== undefined
          ? { defaultApproverContactId: patch.defaultApproverContactId }
          : {}),
      }),
    );
    return reply.send({ id: updated.id, lockVersion: updated.lockVersion });
  });

  /**
   * Baseline correction before the first send; after that the API requires an
   * explicit amendment instead (report §4.1).
   */
  app.patch('/v1/projects/:id/baseline', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const baseline = BaselineInputSchema.parse(request.body);
    app.requireWrite(request, 'project:update');

    const project = await app.services.projects.updateBaselineBeforeFirstSend(auth, id, baseline);
    return reply.send({
      id: project.id,
      baselineTotalMinor: Number(project.baselineTotalMinor),
      revisedTotalMinor: Number(project.revisedTotalMinor),
    });
  });

  app.post(
    '/v1/projects/:id/baseline-amendments',
    { preHandler: write },
    async (request, reply) => {
      const auth = await app.requireAuth(request, reply);
      const { id } = IdParams.parse(request.params);
      const input = BaselineAmendmentSchema.parse(request.body);
      app.requireWrite(request, 'project:amend_baseline');

      const project = await app.services.projects.amendBaseline(auth, id, input);
      return reply.status(201).send({
        id: project.id,
        baselineTotalMinor: Number(project.baselineTotalMinor),
        revisedTotalMinor: Number(project.revisedTotalMinor),
      });
    },
  );

  app.post('/v1/projects/:id/close', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const { reason } = CloseProjectSchema.parse(request.body ?? {});
    app.requireWrite(request, 'project:close');

    await app.services.projects.closeProject(auth, id, reason ?? null);
    return reply.status(204).send();
  });

  /** Undo a close; `project:close` authorizes both directions. */
  app.post('/v1/projects/:id/reopen', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const { reason } = ReopenProjectSchema.parse(request.body ?? {});
    app.requireWrite(request, 'project:close');

    await app.services.projects.reopenProject(auth, id, reason ?? null);
    return reply.status(204).send();
  });

  /** Contract value over time: baseline, amendments, approved changes, running total. */
  app.get('/v1/projects/:id/contract-history', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    return reply.send(await app.services.projects.contractHistory(auth, id));
  });

  /** Project change register — report §6.2 `/app/projects/{id}`. */
  app.get('/v1/projects/:id/change-register', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const totals = await app.services.projects.projectTotals(auth.tenant, id);
    authorize(auth.actor, 'project:read', {
      organizationId: totals.project.organizationId,
      projectId: id,
    });

    const changes = await app.repos.changeOrders.listSummaries(auth.tenant, {
      projectId: id,
      limit: 100,
    });

    return reply.send({
      project: summariseProject(totals.project),
      totals: projectTotalsDto(totals),
      changes: changes.items.map(summaryDto),
    });
  });

  /**
   * Dashboard cards — report §6.6. Every figure respects project grants.
   *
   * A collaborator gets the same shape with only the queue figures: their own
   * requests waiting for the designer, and what is waiting on or was decided by
   * the homeowner on their projects. The firm's money figures (approved this
   * month, unbilled) are the designer's bookkeeping, not theirs, so they come
   * back as zero rather than as an error the page has to work around.
   */
  app.get('/v1/dashboard', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'project:read', { organizationId: auth.actor.organizationId });
    const projectGrants = projectAccessFilter(auth.actor);
    const collaborator = auth.actor.role === 'COLLABORATOR';
    const ownRequestsOnly = collaborator && auth.actor.userId ? auth.actor.userId : null;

    const [data, review, awaiting, recent] = await Promise.all([
      app.repos.reporting.dashboard(
        auth.tenant,
        auth.organizationTimezone ?? 'Asia/Kolkata',
        projectGrants,
        { submittedByUserId: ownRequestsOnly },
      ),
      app.repos.changeOrders.listSummaries(auth.tenant, {
        bucket: 'REVIEW',
        limit: 5,
        projectGrants,
        ...(ownRequestsOnly ? { raisedByUserId: ownRequestsOnly } : {}),
      }),
      app.repos.changeOrders.listSummaries(auth.tenant, {
        bucket: 'PENDING',
        limit: 10,
        projectGrants,
      }),
      app.repos.changeOrders.listSummaries(auth.tenant, {
        bucket: 'DECIDED',
        limit: 10,
        projectGrants,
      }),
    ]);

    return reply.send({
      audience: collaborator ? 'COLLABORATOR' : 'TEAM',
      currency: data.currency,
      pendingDecisions: data.pendingDecisions,
      overdueOrExpiring: data.overdueOrExpiring,
      approvedValueThisMonthMinor: collaborator ? 0 : Number(data.approvedValueThisMonthMinor),
      averageHoursToDecision: collaborator ? null : data.averageHoursToDecision,
      unbilledApprovedTotalMinor: collaborator ? 0 : Number(data.unbilledApprovedTotalMinor),
      unbilledApprovedCount: collaborator ? 0 : data.unbilledApprovedCount,
      awaitingReviewCount: data.awaitingReviewCount,
      awaitingReview: review.items.map(summaryDto),
      awaitingDecision: awaiting.items.map(summaryDto),
      recentDecisions: recent.items.map(summaryDto),
    });
  });

  /** Tenant-scoped search — report §6.6. */
  app.get('/v1/search', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'project:read', { organizationId: auth.actor.organizationId });
    const { q, limit } = SearchQuerySchema.parse(request.query);
    const results = await app.repos.reporting.search(
      auth.tenant,
      q,
      limit,
      projectAccessFilter(auth.actor),
    );
    return reply.send(results);
  });
}

type ProjectRowLike = Awaited<ReturnType<AppContext['repos']['projects']['requireById']>>;

function summariseProject(project: ProjectRowLike) {
  return {
    id: project.id,
    projectNumber: project.projectNumber,
    title: project.title,
    customerId: project.customerId,
    customerName: project.customerName,
    status: project.status,
    currency: project.currency,
    baselineTotalMinor: Number(project.baselineTotalMinor),
    approvedDeltaMinor: Number(project.approvedDeltaMinor),
    revisedTotalMinor: Number(project.revisedTotalMinor),
    pendingChangeCount: project.pendingChangeCount,
    awaitingReviewCount: project.awaitingReviewCount,
    city: addressCity(project.siteAddressJson),
    expectedCompletionDate: project.expectedCompletionDate,
    updatedAt: project.updatedAt.toISOString(),
  };
}

function addressCity(address: Record<string, unknown> | null): string | null {
  const city = address?.city;
  return typeof city === 'string' && city.trim() ? city.trim() : null;
}

function projectTotalsDto(totals: {
  project: ProjectRowLike;
  pendingDeltaMinor: bigint;
  pendingCount: number;
  approvedCount: number;
}) {
  return {
    currency: totals.project.currency,
    baselineSubtotalMinor: Number(totals.project.baselineSubtotalMinor),
    baselineTaxMinor: Number(totals.project.baselineTaxMinor),
    baselineTotalMinor: Number(totals.project.baselineTotalMinor),
    approvedDeltaMinor: Number(totals.project.approvedDeltaMinor),
    revisedTotalMinor: Number(totals.project.revisedTotalMinor),
    pendingDeltaMinor: Number(totals.pendingDeltaMinor),
    approvedChangeCount: totals.approvedCount,
    pendingChangeCount: totals.pendingCount,
    approvedScheduleDeltaDays: totals.project.approvedScheduleDeltaDays,
  };
}

function fullProject(totals: {
  project: ProjectRowLike;
  pendingDeltaMinor: bigint;
  pendingCount: number;
  approvedCount: number;
}) {
  const p = totals.project;
  return {
    id: p.id,
    organizationId: p.organizationId,
    customerId: p.customerId,
    customerName: p.customerName,
    projectNumber: p.projectNumber,
    title: p.title,
    description: p.description,
    siteAddress: p.siteAddressJson,
    status: p.status,
    currency: p.currency,
    timezone: p.timezone,
    totals: projectTotalsDto(totals),
    awaitingReviewCount: p.awaitingReviewCount,
    startDate: p.startDate,
    expectedCompletionDate: p.expectedCompletionDate,
    revisedCompletionDate: null,
    defaultApproverContactId: p.defaultApproverContactId,
    baselineDocumentFileId: p.baselineDocumentFileId,
    // Drives whether the UI offers a baseline edit or an amendment (§4.1).
    baselineEditable: !p.hasSentChange,
    hasSentChange: p.hasSentChange,
    closedAt: p.closedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    lockVersion: p.lockVersion,
  };
}

function summaryDto(c: ChangeOrderSummaryRow) {
  return {
    id: c.id,
    projectId: c.projectId,
    projectTitle: c.projectTitle,
    customerName: c.customerName,
    number: c.number,
    title: c.title,
    type: c.type,
    status: c.status,
    versionNumber: c.versionNumber,
    totalDeltaMinor: Number(c.totalDeltaMinor),
    currency: c.currency,
    scheduleDeltaDays: c.scheduleDeltaDays,
    sentAt: c.sentAt?.toISOString() ?? null,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    updatedAt: c.updatedAt.toISOString(),
    room: c.room,
    workCategory: c.workCategory,
    projectNumber: c.projectNumber,
    origin: c.origin,
    awaitingReview: c.awaitingReview,
    submittedByLabel: c.submittedByLabel,
    invoicedAt: c.invoicedAt?.toISOString() ?? null,
  };
}

export { summaryDto, summariseProject };

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BaselineAmendmentSchema,
  BaselineInputSchema,
  CloseProjectSchema,
  CreateProjectSchema,
  ListProjectsQuerySchema,
  SearchQuerySchema,
  UpdateProjectSchema,
} from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { authorize } from '@extrawork/domain';
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
    });

    // Project-scoped roles only see granted projects (report §3.2).
    const visible = result.items.filter(
      (p) =>
        auth.actor.role === 'OWNER' ||
        auth.actor.role === 'ADMIN' ||
        auth.actor.role === 'FINANCE' ||
        auth.actor.projectGrants.has(p.id),
    );

    return reply.send({
      items: visible.map(summariseProject),
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
      changes: changes.items.map((c) => ({
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
      })),
    });
  });

  /** Dashboard cards — report §6.6. */
  app.get('/v1/dashboard', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'project:read', { organizationId: auth.actor.organizationId });

    const [data, awaiting, recent] = await Promise.all([
      app.repos.reporting.dashboard(auth.tenant, auth.organizationTimezone ?? 'Asia/Kolkata'),
      app.repos.changeOrders.listSummaries(auth.tenant, { bucket: 'PENDING', limit: 10 }),
      app.repos.changeOrders.listSummaries(auth.tenant, { bucket: 'DECIDED', limit: 10 }),
    ]);

    return reply.send({
      currency: data.currency,
      pendingDecisions: data.pendingDecisions,
      overdueOrExpiring: data.overdueOrExpiring,
      approvedValueThisMonthMinor: Number(data.approvedValueThisMonthMinor),
      averageHoursToDecision: data.averageHoursToDecision,
      projectsWithUnbilledApprovedExtras: data.projectsWithUnbilledApprovedExtras,
      awaitingDecision: awaiting.items.map(summaryDto),
      recentDecisions: recent.items.map(summaryDto),
    });
  });

  /** Tenant-scoped search — report §6.6. */
  app.get('/v1/search', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'project:read', { organizationId: auth.actor.organizationId });
    const { q, limit } = SearchQuerySchema.parse(request.query);
    const results = await app.repos.reporting.search(auth.tenant, q, limit);
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
    updatedAt: project.updatedAt.toISOString(),
  };
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
    siteAddress: p.siteAddressJson,
    status: p.status,
    currency: p.currency,
    timezone: p.timezone,
    totals: projectTotalsDto(totals),
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

function summaryDto(c: {
  id: string;
  projectId: string;
  projectTitle: string;
  customerName: string;
  number: string;
  title: string;
  type: string;
  status: string;
  versionNumber: number;
  totalDeltaMinor: bigint;
  currency: string;
  scheduleDeltaDays: number;
  sentAt: Date | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  updatedAt: Date;
}) {
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
  };
}

export { summaryDto, summariseProject };

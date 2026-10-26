import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import { JOB_KINDS } from '@extrawork/contracts';
import { claimJobs } from '@extrawork/db';
import type { RequestContext } from '@extrawork/application';
import type { Container } from '@extrawork/runtime';
import {
  addMember,
  createSentChangeOrder,
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

interface Session {
  cookie: string;
}

let container: Container;
let app: FastifyInstance;
let tenant: TenantFixture;
let projectManager: RequestContext;
let session: Session;
let ungrantedProjectId: string;

beforeAll(async () => {
  container = createTestContainer();
  app = await buildApp({
    env: container.env,
    uow: container.uow,
    repos: container.repos,
    services: container.services,
    appContext: container.appContext,
    logger: container.logger,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  tenant = await createTenant(container, { name: 'Scoped Projects Ltd' });
  projectManager = await addMember(container, tenant, 'PROJECT_MANAGER', [tenant.projectId]);
  if (!projectManager.actor.userId) throw new Error('fixture member has no user id');

  const second = await container.services.projects.createProject(tenant.owner, {
    customerId: tenant.customerId,
    title: 'Confidential unassigned project',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    baseline: { subtotalMinor: 2_000_000, taxMinor: 360_000, totalMinor: 2_360_000 },
    expectedCompletionDate: '2027-01-31',
    defaultApproverContactId: tenant.approverContactId,
  });
  ungrantedProjectId = second.id;

  // Session resolution deliberately derives grants from project_members rather
  // than trusting the in-memory test actor.
  await container.uow.pool.query(
    `INSERT INTO project_members (organization_id, project_id, user_id)
     VALUES ($1, $2, $3)`,
    [tenant.organizationId, tenant.projectId, projectManager.actor.userId],
  );
  const created = await container.uow.transaction((tx) =>
    container.repos.identity.createSession(tx, {
      userId: projectManager.actor.userId!,
      activeOrganizationId: tenant.organizationId,
      ttlHours: 12,
      ipHash: null,
      userAgent: 'project-scope-vitest',
    }),
  );
  session = { cookie: `ew_session=${created.sessionToken}` };

  await createSentChangeOrder(container, tenant, { title: 'Visible scoped change' });
  await createSentChangeOrder(
    container,
    { ...tenant, projectId: ungrantedProjectId, projectNumber: second.projectNumber },
    { title: 'Hidden confidential change' },
  );
});

async function get(path: string) {
  return app.inject({ method: 'GET', url: path, headers: { cookie: session.cookie } });
}

describe('project-scoped collection reads', () => {
  it('filters projects before pagination and filters customer project summaries', async () => {
    const projects = await get('/v1/projects?limit=1');
    expect(projects.statusCode).toBe(200);
    expect(projects.json()).toMatchObject({
      items: [{ id: tenant.projectId }],
      nextCursor: null,
    });

    const customer = await get(`/v1/customers/${tenant.customerId}`);
    expect(customer.statusCode).toBe(200);
    expect(
      (customer.json() as { projects: Array<{ id: string }> }).projects.map((p) => p.id),
    ).toEqual([tenant.projectId]);
  });

  it('scopes dashboard lists and aggregate counts to assigned projects', async () => {
    const response = await get('/v1/dashboard');
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      pendingDecisions: number;
      awaitingDecision: Array<{ projectId: string }>;
    };
    expect(body.pendingDecisions).toBe(1);
    expect(body.awaitingDecision.map((item) => item.projectId)).toEqual([tenant.projectId]);
  });

  it('does not return unassigned projects or changes through search or reports', async () => {
    const search = await get('/v1/search?q=confidential&limit=20');
    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({ projects: [], changes: [] });

    const report = await get('/v1/reports/extra-work?status=ALL');
    expect(report.statusCode).toBe(200);
    const body = report.json() as {
      rows: Array<{ projectId: string; title: string }>;
      totals: { count: number };
    };
    expect(body.totals.count).toBe(1);
    expect(body.rows.map((row) => row.projectId)).toEqual([tenant.projectId]);
    expect(JSON.stringify(body)).not.toContain('Hidden confidential change');
  });
});

describe('project-scoped object lookups', () => {
  it('enqueues project evidence generation with the payload contract the worker consumes', async () => {
    if (!tenant.owner.actor.userId) throw new Error('owner fixture has no user id');
    const ownerSession = await container.uow.transaction((tx) =>
      container.repos.identity.createSession(tx, {
        userId: tenant.owner.actor.userId!,
        activeOrganizationId: tenant.organizationId,
        ttlHours: 12,
        ipHash: null,
        userAgent: 'project-evidence-payload-test',
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/v1/projects/${tenant.projectId}/evidence-pack`,
      headers: {
        cookie: `ew_session=${ownerSession.sessionToken}`,
        'x-csrf-token': ownerSession.csrfToken,
      },
      payload: {},
    });
    expect(response.statusCode).toBe(202);

    const jobs = await claimJobs(container.uow.db, {
      limit: 1,
      leaseSeconds: 60,
      workerId: 'project-evidence-payload-test',
      kinds: [JOB_KINDS.GENERATE_EXPORT],
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({
      exportId: response.json().id,
      organizationId: tenant.organizationId,
    });
  });

  it('refuses file metadata and export documents from an unassigned project', async () => {
    const { fileId, documentId } = await container.uow.transaction(async (tx) => {
      const file = await container.repos.files.register(tx, tenant.owner.tenant, {
        id: randomUUID(),
        projectId: ungrantedProjectId,
        storageKey: `quarantine/${randomUUID()}`,
        filename: 'confidential-plan.pdf',
        declaredMimeType: 'application/pdf',
        byteSize: 123n,
        purpose: 'ATTACHMENT',
        sha256: null,
      });
      const documentId = await container.repos.documents.requestExport(tx, tenant.owner.tenant, {
        projectId: ungrantedProjectId,
        kind: 'PROJECT_EVIDENCE_PACK',
        templateVersion: 'evidence-pack-v1',
      });
      return { fileId: file.id, documentId };
    });

    const file = await get(`/v1/files/${fileId}`);
    expect(file.statusCode).toBe(403);
    expect(JSON.stringify(file.json())).not.toContain('confidential-plan.pdf');

    const document = await get(`/v1/exports/${documentId}`);
    expect(document.statusCode).toBe(403);
    expect(document.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
});

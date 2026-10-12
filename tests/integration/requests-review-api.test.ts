import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import {
  ChangeOrderSchema,
  ChangeOrderSummarySchema,
  ContractHistorySchema,
  DashboardSchema,
  ParseIntakeResponseSchema,
  ProjectSchema,
  ProjectSummarySchema,
  type MembershipRole,
} from '@extrawork/contracts';
import type { RequestContext } from '@extrawork/application';
import type { Container } from '@extrawork/runtime';
import {
  addMember,
  createSentChangeOrder,
  createTenant,
  createTestContainer,
  publicContext,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * Slice B of spec 2026-10-12: requests that route through the designer (D4),
 * request numbers (D8), room and type of work (D9), the Tier 1 B invoiced mark
 * and Tier 1 C paste-to-draft — at the HTTP seam, with real sessions, so
 * grants come from `project_members` exactly as in production.
 */

let container: Container;
let app: FastifyInstance;
let tenant: TenantFixture;
let other: TenantFixture;

interface Session {
  cookie: string;
  csrfToken: string;
}

interface Member {
  ctx: RequestContext;
  userId: string;
  session: Session;
}

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
  tenant = await createTenant(container, { name: 'Studio Vastu' });
  other = await createTenant(container, { name: 'Other Studio' });
});

async function sessionFor(userId: string, organizationId: string): Promise<Session> {
  const created = await container.uow.transaction((tx) =>
    container.repos.identity.createSession(tx, {
      userId,
      activeOrganizationId: organizationId,
      ttlHours: 12,
      ipHash: null,
      userAgent: 'requests-review-vitest',
    }),
  );
  return { cookie: `ew_session=${created.sessionToken}`, csrfToken: created.csrfToken };
}

async function member(
  role: MembershipRole,
  grants: string[] = [tenant.projectId],
  companyName: string | null = null,
): Promise<Member> {
  const ctx = await addMember(container, tenant, role, grants);
  const userId = ctx.actor.userId;
  if (!userId) throw new Error('member fixture has no user');
  for (const projectId of grants) {
    await container.uow.pool.query(
      `INSERT INTO project_members (organization_id, project_id, user_id) VALUES ($1, $2, $3)`,
      [tenant.organizationId, projectId, userId],
    );
  }
  if (companyName) {
    await container.uow.pool.query(
      `UPDATE memberships SET company_name = $1 WHERE organization_id = $2 AND user_id = $3`,
      [companyName, tenant.organizationId, userId],
    );
  }
  return { ctx, userId, session: await sessionFor(userId, tenant.organizationId) };
}

async function ownerSession(fixture: TenantFixture = tenant): Promise<Session> {
  return sessionFor(fixture.ownerUserId, fixture.organizationId);
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  session: Session,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url: path,
    headers: {
      cookie: session.cookie,
      ...(method === 'GET' ? {} : { 'x-csrf-token': session.csrfToken }),
      'idempotency-key': `test-${randomUUID()}`,
      ...headers,
    },
    ...(body === undefined ? {} : { payload: body as object }),
  });
}

async function notifications(kind?: string) {
  const result = await container.uow.pool.query<{
    user_id: string;
    kind: string;
    title: string;
    body: string | null;
    link_path: string | null;
    actor_label: string | null;
  }>(
    `SELECT user_id, kind, title, body, link_path, actor_label FROM notifications
      WHERE organization_id = $1 ${kind ? 'AND kind = $2' : ''} ORDER BY created_at`,
    kind ? [tenant.organizationId, kind] : [tenant.organizationId],
  );
  return result.rows;
}

async function auditTypes(changeOrderId: string): Promise<string[]> {
  const result = await container.uow.pool.query<{ event_type: string }>(
    `SELECT event_type FROM audit_events WHERE aggregate_id = $1 ORDER BY sequence`,
    [changeOrderId],
  );
  return result.rows.map((r) => r.event_type);
}

async function approve(token: string) {
  const ctx = publicContext();
  const opened = await container.services.publicApproval.resolve(token, ctx, undefined);
  if (!opened.session) throw new Error('Expected approval session');
  return container.services.decisions.decide(
    {
      plainToken: token,
      publicSessionToken: opened.session.token,
      input: {
        type: 'APPROVE',
        signerName: tenant.approverName,
        signedDate: new Date().toISOString().slice(0, 10),
        declarationAccepted: true,
      },
      idempotencyKey: randomUUID(),
      ifMatch: opened.dto.etag,
    },
    ctx,
  );
}

async function raiseAsCollaborator(collaborator: Member, body: Record<string, unknown> = {}) {
  const response = await call(
    'POST',
    `/v1/projects/${tenant.projectId}/proposals`,
    collaborator.session,
    {
      description: 'Shift the wash basin 2 feet to the left in the master bathroom',
      reason: 'Homeowner wants space for a cabinet',
      workCategory: 'PLUMBING',
      ...body,
    },
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { changeOrderId: string; number: string; versionId: string };
}

async function getChange(session: Session, id: string) {
  const response = await call('GET', `/v1/change-orders/${id}`, session);
  expect(response.statusCode, response.body).toBe(200);
  const parsed = ChangeOrderSchema.safeParse(response.json());
  expect(parsed.success ? null : parsed.error.issues).toBeNull();
  return { body: parsed.data!, etag: response.headers.etag as string };
}

async function price(session: Session, id: string, etag: string, extra: object = {}) {
  return call(
    'PATCH',
    `/v1/change-orders/${id}/draft`,
    session,
    {
      type: 'ADDITION',
      title: 'Shift wash basin',
      scope: 'Shift the wash basin 2 feet to the left in the master bathroom',
      reason: 'Space for a cabinet',
      room: 'Master bathroom',
      workCategory: 'PLUMBING',
      lineItems: [
        {
          description: 'Plumbing rework',
          quantity: '1',
          unit: 'lot',
          unitPriceMinor: 8_500_00,
          taxRateBps: 1800,
          direction: 1,
        },
      ],
      scheduleDeltaDays: 1,
      approverContactId: tenant.approverContactId,
      assuranceRequired: 'A0',
      ...extra,
    },
    { 'if-match': etag },
  );
}

describe('raising a request for review', () => {
  it('lets a collaborator raise an incomplete request that only the designers hear about', async () => {
    const designer = await member('PROJECT_MANAGER');
    const collaborator = await member('COLLABORATOR', [tenant.projectId], 'Kumar Constructions');

    const created = await raiseAsCollaborator(collaborator, {
      room: 'Master bathroom',
      note: 'Plumber is on site tomorrow',
    });
    // D8: the number carries the project.
    expect(created.number).toBe(`${tenant.projectNumber}-R01`);

    const { body } = await getChange(designer.session, created.changeOrderId);
    expect(body.currentVersion.status).toBe('DRAFT');
    expect(body.currentVersion.room).toBe('Master bathroom');
    expect(body.currentVersion.workCategory).toBe('PLUMBING');
    expect(body.currentVersion.lineItems).toEqual([]);
    expect(body.currentVersion.title).toBe(
      'Shift the wash basin 2 feet to the left in the master bathroom',
    );
    expect(body.currentVersion.submission).toMatchObject({
      origin: 'COLLABORATOR',
      awaitingReview: true,
      reviewedAt: null,
      note: 'Plumber is on site tomorrow',
    });
    expect(body.currentVersion.submission.label).toMatch(/^Member .+ · Kumar Constructions$/);

    // The designers (owner and the granted designer) are told; the raiser is not.
    const sent = await notifications('REQUEST_SUBMITTED');
    expect(sent.map((n) => n.user_id).sort()).toEqual([designer.userId, tenant.ownerUserId].sort());
    expect(sent[0]).toMatchObject({
      link_path: `/app/changes/${created.changeOrderId}`,
      actor_label: body.currentVersion.submission.label,
    });

    expect(await auditTypes(created.changeOrderId)).toEqual([
      'change_order.created.v1',
      'change_order.submitted_for_review.v1',
    ]);

    // The REVIEW bucket has it, the DRAFT bucket does not, and summaries carry provenance.
    const review = await call('GET', '/v1/change-orders?bucket=REVIEW', designer.session);
    const reviewItems = (review.json() as { items: unknown[] }).items;
    expect(reviewItems).toHaveLength(1);
    const summary = ChangeOrderSummarySchema.parse(reviewItems[0]);
    expect(summary).toMatchObject({
      awaitingReview: true,
      origin: 'COLLABORATOR',
      projectNumber: tenant.projectNumber,
      workCategory: 'PLUMBING',
      invoicedAt: null,
    });
    const drafts = await call('GET', '/v1/change-orders?bucket=DRAFT', designer.session);
    expect((drafts.json() as { items: unknown[] }).items).toEqual([]);
    const byType = await call('GET', '/v1/change-orders?workCategory=ELECTRICAL', designer.session);
    expect((byType.json() as { items: unknown[] }).items).toEqual([]);

    const project = await call('GET', `/v1/projects/${tenant.projectId}`, designer.session);
    expect(ProjectSchema.parse(project.json()).awaitingReviewCount).toBe(1);
  });

  it('turns a figure from site into one priced line the designer can rework', async () => {
    const collaborator = await member('COLLABORATOR');
    const created = await raiseAsCollaborator(collaborator, {
      title: 'Basin shift',
      amountMinor: 4_000_00,
      scheduleDeltaDays: 2,
    });
    const { body } = await getChange(await ownerSession(), created.changeOrderId);
    expect(body.currentVersion.lineItems).toMatchObject([
      { description: 'Basin shift', unit: 'lot', unitPriceMinor: 4_000_00, taxRateBps: 0 },
    ]);
    expect(body.currentVersion.totals.totalDeltaMinor).toBe(4_000_00);
  });

  it('refuses collaborators outside their grant, viewers, and other tenants', async () => {
    const second = await container.services.projects.createProject(tenant.owner, {
      customerId: tenant.customerId,
      title: 'Ungranted',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      baseline: { subtotalMinor: 100_00, taxMinor: 0, totalMinor: 100_00 },
      defaultApproverContactId: tenant.approverContactId,
    });
    const collaborator = await member('COLLABORATOR');
    const viewer = await member('VIEWER');
    const body = { description: 'Add a socket near the bed please' };

    const ungranted = await call(
      'POST',
      `/v1/projects/${second.id}/proposals`,
      collaborator.session,
      body,
    );
    expect(ungranted.statusCode).toBe(403);

    const asViewer = await call(
      'POST',
      `/v1/projects/${tenant.projectId}/proposals`,
      viewer.session,
      body,
    );
    expect(asViewer.statusCode).toBe(403);

    const crossTenant = await call(
      'POST',
      `/v1/projects/${tenant.projectId}/proposals`,
      await ownerSession(other),
      body,
    );
    expect(crossTenant.statusCode).toBe(404);
  });

  it('keeps editing, sending and dismissing with the designer', async () => {
    const collaborator = await member('COLLABORATOR');
    const created = await raiseAsCollaborator(collaborator);
    const { etag } = await getChange(collaborator.session, created.changeOrderId);

    expect((await price(collaborator.session, created.changeOrderId, etag)).statusCode).toBe(403);
    const send = await call(
      'POST',
      `/v1/change-orders/${created.changeOrderId}/send`,
      collaborator.session,
      { channel: 'COPY_LINK' },
    );
    expect(send.statusCode).toBe(403);
    const dismiss = await call(
      'POST',
      `/v1/change-orders/${created.changeOrderId}/dismiss`,
      collaborator.session,
      { reason: 'Never mind' },
    );
    expect(dismiss.statusCode).toBe(403);
  });
});

describe('the designer reviews', () => {
  it('prices and sends a proposal, stamping the review and telling the raiser', async () => {
    const designer = await member('PROJECT_MANAGER');
    const collaborator = await member('COLLABORATOR');
    const created = await raiseAsCollaborator(collaborator);

    // An unpriced proposal can be saved but not sent.
    const early = await call(
      'POST',
      `/v1/change-orders/${created.changeOrderId}/send`,
      designer.session,
      { channel: 'COPY_LINK' },
    );
    expect(early.statusCode).toBe(400);

    // Autosave of a still-incomplete proposal is allowed while it awaits review.
    const first = await getChange(designer.session, created.changeOrderId);
    const partial = await price(designer.session, created.changeOrderId, first.etag, {
      type: 'TIME_ONLY',
      lineItems: [],
      scheduleDeltaDays: 0,
    });
    expect(partial.statusCode, partial.body).toBe(200);

    const second = await getChange(designer.session, created.changeOrderId);
    const priced = await price(designer.session, created.changeOrderId, second.etag);
    expect(priced.statusCode, priced.body).toBe(200);

    const sent = await call(
      'POST',
      `/v1/change-orders/${created.changeOrderId}/send`,
      designer.session,
      { channel: 'COPY_LINK' },
    );
    expect(sent.statusCode, sent.body).toBe(201);

    const { body } = await getChange(designer.session, created.changeOrderId);
    expect(body.currentVersion.status).toBe('SENT');
    expect(body.currentVersion.submission.awaitingReview).toBe(false);
    expect(body.currentVersion.submission.reviewedAt).not.toBeNull();

    const version = await container.repos.changeOrders.findVersion(
      container.uow.db,
      tenant.owner.tenant,
      created.versionId,
    );
    expect(version?.reviewedByUserId).toBe(designer.userId);
    // D9: room and type of work are frozen terms.
    const scope = (version?.canonicalSnapshot as { scope: Record<string, unknown> }).scope;
    expect(scope).toMatchObject({ room: 'Master bathroom', workCategory: 'PLUMBING' });

    const told = await notifications('REQUEST_SENT');
    expect(told.map((n) => n.user_id)).toEqual([collaborator.userId]);
  });

  it('dismisses only while the request awaits review, and tells the raiser why', async () => {
    const collaborator = await member('COLLABORATOR');
    const owner = await ownerSession();
    const created = await raiseAsCollaborator(collaborator);

    const dismissed = await call(
      'POST',
      `/v1/change-orders/${created.changeOrderId}/dismiss`,
      owner,
      { reason: 'Already covered by R02' },
    );
    expect(dismissed.statusCode, dismissed.body).toBe(204);

    const { body } = await getChange(owner, created.changeOrderId);
    expect(body.currentVersion.status).toBe('CANCELLED');
    expect(body.currentVersion.submission.awaitingReview).toBe(false);
    expect(await auditTypes(created.changeOrderId)).toEqual(
      expect.arrayContaining(['change_order.cancelled.v1', 'change_order.proposal_dismissed.v1']),
    );
    const told = await notifications('REQUEST_DISMISSED');
    expect(told).toMatchObject([{ user_id: collaborator.userId, body: 'Already covered by R02' }]);

    const again = await call('POST', `/v1/change-orders/${created.changeOrderId}/dismiss`, owner, {
      reason: 'Twice',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'NOT_AWAITING_REVIEW' } });

    // An ordinary draft was never awaiting review.
    const ordinary = await container.services.changeOrders.create(tenant.owner, tenant.projectId, {
      type: 'TIME_ONLY',
      title: 'Own draft',
      scope: 'A draft the designer wrote themselves',
      lineItems: [],
      scheduleDeltaDays: 2,
      approverContactId: tenant.approverContactId,
      assuranceRequired: 'A0',
    });
    const notReview = await call(
      'POST',
      `/v1/change-orders/${ordinary.changeOrderId}/dismiss`,
      owner,
      { reason: 'No' },
    );
    expect(notReview.statusCode).toBe(409);

    const crossTenant = await call(
      'POST',
      `/v1/change-orders/${ordinary.changeOrderId}/dismiss`,
      await ownerSession(other),
      { reason: 'No' },
    );
    expect(crossTenant.statusCode).toBe(404);
  });
});

describe('paste-to-draft', () => {
  it('reads a pasted message, then raises it attributed to a site-team member', async () => {
    const owner = await ownerSession();
    const employee = await container.services.employees.create(tenant.owner, {
      name: 'Ramesh Patil',
      phone: '9876501234',
      allProjects: false,
      projectIds: [tenant.projectId],
      party: 'CONSTRUCTION',
      companyName: 'Kumar Constructions',
      teamRole: 'FOREMAN',
    });
    const outsider = await container.services.employees.create(tenant.owner, {
      name: 'Not On This Job',
      phone: '9876501299',
      allProjects: false,
      projectIds: [],
      party: 'INTERNAL',
      teamRole: 'WORKER',
    });

    const parsed = await call('POST', '/v1/intake/parse', owner, {
      text: 'Add 2 switch points in the master bedroom\nWhy: client asked\nCost: 3,200',
    });
    expect(parsed.statusCode, parsed.body).toBe(200);
    const reading = ParseIntakeResponseSchema.parse(parsed.json());
    expect(reading).toMatchObject({
      description: 'Add 2 switch points in the master bedroom',
      reason: 'client asked',
      amountMinor: 3_200_00,
      room: 'Master bedroom',
      workCategory: 'ELECTRICAL',
      missing: [],
      // The tenant has exactly one project, so it is assumed.
      project: { id: tenant.projectId, projectNumber: tenant.projectNumber },
    });

    const ambiguous = await call('POST', '/v1/intake/parse', owner, {
      text: 'Extra tiles\nCost: 15-20k',
      projectId: tenant.projectId,
    });
    expect(ambiguous.statusCode, ambiguous.body).toBe(200);
    expect(ParseIntakeResponseSchema.parse(ambiguous.json())).toMatchObject({
      amountMinor: null,
      problems: [expect.stringContaining('15-20k')],
    });

    const rejected = await call('POST', `/v1/projects/${tenant.projectId}/proposals`, owner, {
      description: reading.description,
      raisedByEmployeeId: outsider.id,
      pasted: true,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const created = await call('POST', `/v1/projects/${tenant.projectId}/proposals`, owner, {
      description: reading.description,
      reason: reading.reason,
      amountMinor: reading.amountMinor,
      room: reading.room,
      workCategory: reading.workCategory,
      raisedByEmployeeId: employee.id,
      pasted: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    const { changeOrderId, versionId } = created.json() as {
      changeOrderId: string;
      versionId: string;
    };

    const version = await container.repos.changeOrders.findVersion(
      container.uow.db,
      tenant.owner.tenant,
      versionId,
    );
    expect(version).toMatchObject({ origin: 'PASTED', raisedByEmployeeId: employee.id });
    const { body } = await getChange(owner, changeOrderId);
    expect(body.currentVersion.submission.label).toBe('Ramesh Patil · Kumar Constructions');
  });

  it('only matches projects the caller can see, and only designers attribute to the site team', async () => {
    const collaborator = await member('COLLABORATOR', []);
    const parsed = await call('POST', '/v1/intake/parse', collaborator.session, {
      text: 'Add a socket in the kitchen\nCost: 900',
    });
    expect(parsed.statusCode).toBe(200);
    expect(ParseIntakeResponseSchema.parse(parsed.json()).project).toBeNull();

    const granted = await member('COLLABORATOR');
    const employee = await container.services.employees.create(tenant.owner, {
      name: 'Suresh',
      phone: '9876501555',
      allProjects: true,
      projectIds: [],
      party: 'INTERNAL',
      teamRole: 'WORKER',
    });
    const attributed = await call(
      'POST',
      `/v1/projects/${tenant.projectId}/proposals`,
      granted.session,
      { description: 'Add a socket in the kitchen', raisedByEmployeeId: employee.id },
    );
    expect(attributed.statusCode).toBe(403);
  });
});

describe('decisions and the invoiced mark', () => {
  it('tells everyone on the project about a decision, then tracks billing on approved changes', async () => {
    const designer = await member('PROJECT_MANAGER');
    const collaborator = await member('COLLABORATOR');
    const finance = await member('FINANCE', []);
    const owner = await ownerSession();

    const sent = await createSentChangeOrder(container, tenant, { unitPriceMinor: 10_000_00 });
    const id = sent.changeOrder.changeOrderId;

    // Not approved yet: no mark.
    const early = await call('POST', `/v1/change-orders/${id}/invoicing`, owner, {});
    expect(early.statusCode).toBe(409);

    await approve(sent.token);
    const decided = await notifications('DECISION_RECORDED');
    expect(decided.map((n) => n.user_id).sort()).toEqual(
      [tenant.ownerUserId, designer.userId, collaborator.userId].sort(),
    );
    expect(decided[0]?.title).toMatch(/^Approved: /);

    const before = DashboardSchema.parse((await call('GET', '/v1/dashboard', owner)).json());
    expect(before.unbilledApprovedCount).toBe(1);
    expect(before.unbilledApprovedTotalMinor).toBe(11_800_00);

    // Designers cannot mark; accounts can.
    const asDesigner = await call(
      'POST',
      `/v1/change-orders/${id}/invoicing`,
      designer.session,
      {},
    );
    expect(asDesigner.statusCode).toBe(403);
    const marked = await call('POST', `/v1/change-orders/${id}/invoicing`, finance.session, {
      invoiceReference: 'INV-2026-031',
    });
    expect(marked.statusCode, marked.body).toBe(200);
    expect(marked.json()).toMatchObject({ invoiceReference: 'INV-2026-031' });

    const { body } = await getChange(owner, id);
    expect(body.currentVersion.invoicing).toMatchObject({ invoiceReference: 'INV-2026-031' });
    const after = DashboardSchema.parse((await call('GET', '/v1/dashboard', owner)).json());
    expect(after.unbilledApprovedCount).toBe(0);
    expect(after.unbilledApprovedTotalMinor).toBe(0);
    const unbilled = await call('GET', '/v1/change-orders?bucket=UNBILLED', owner);
    expect((unbilled.json() as { items: unknown[] }).items).toEqual([]);

    // The mark is bookkeeping; the terms on the same row stay frozen.
    await expect(
      container.uow.pool.query(`UPDATE change_order_versions SET room = 'Kitchen' WHERE id = $1`, [
        sent.changeOrder.version.id,
      ]),
    ).rejects.toThrow(/frozen/);

    const crossTenant = await call(
      'DELETE',
      `/v1/change-orders/${id}/invoicing`,
      await ownerSession(other),
    );
    expect(crossTenant.statusCode).toBe(404);

    const cleared = await call('DELETE', `/v1/change-orders/${id}/invoicing`, owner);
    expect(cleared.statusCode).toBe(204);
    const again = await call('GET', '/v1/change-orders?bucket=UNBILLED', owner);
    expect((again.json() as { items: unknown[] }).items).toHaveLength(1);

    expect(await auditTypes(id)).toEqual(
      expect.arrayContaining(['change_order.invoiced.v1', 'change_order.invoice_cleared.v1']),
    );
  });
});

describe('project contract history, description and reopen', () => {
  it('lists baseline, amendments and approved changes with a running total', async () => {
    const owner = await ownerSession();
    const addition = await createSentChangeOrder(container, tenant, {
      unitPriceMinor: 10_000_00,
      taxRateBps: 0,
    });
    await approve(addition.token);
    await container.services.projects.amendBaseline(tenant.owner, tenant.projectId, {
      baseline: { subtotalMinor: 1_100_000_00, taxMinor: 0, totalMinor: 1_100_000_00 },
      reason: 'Kitchen scope added to the contract',
    });
    const deduction = await createSentChangeOrder(container, tenant, {
      unitPriceMinor: 2_000_00,
      taxRateBps: 0,
      direction: -1,
    });
    await approve(deduction.token);

    const response = await call('GET', `/v1/projects/${tenant.projectId}/contract-history`, owner);
    expect(response.statusCode, response.body).toBe(200);
    const history = ContractHistorySchema.parse(response.json());
    expect(history.entries.map((e) => [e.kind, e.deltaMinor, e.runningTotalMinor])).toEqual([
      ['BASELINE', 1_180_000_00, 1_180_000_00],
      ['APPROVED_CHANGE', 10_000_00, 1_190_000_00],
      ['BASELINE_AMENDMENT', -80_000_00, 1_110_000_00],
      ['APPROVED_CHANGE', -2_000_00, 1_108_000_00],
    ]);
    expect(history.currentTotalMinor).toBe(1_108_000_00);

    const collaborator = await member('COLLABORATOR');
    expect(
      (await call('GET', `/v1/projects/${tenant.projectId}/contract-history`, collaborator.session))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          'GET',
          `/v1/projects/${tenant.projectId}/contract-history`,
          await ownerSession(other),
        )
      ).statusCode,
    ).toBe(404);
  });

  it('carries a description and closes and reopens for the designer only', async () => {
    const owner = await ownerSession();
    const collaborator = await member('COLLABORATOR');
    const patched = await call('PATCH', `/v1/projects/${tenant.projectId}`, owner, {
      description: '3BHK, warm minimal, client prefers matte finishes',
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const project = ProjectSchema.parse(
      (await call('GET', `/v1/projects/${tenant.projectId}`, owner)).json(),
    );
    expect(project.description).toBe('3BHK, warm minimal, client prefers matte finishes');

    const list = await call('GET', '/v1/projects', owner);
    const summary = ProjectSummarySchema.parse((list.json() as { items: unknown[] }).items[0]);
    expect(summary).toMatchObject({ awaitingReviewCount: 0, pendingChangeCount: 0 });

    const notClosed = await call('POST', `/v1/projects/${tenant.projectId}/reopen`, owner, {});
    expect(notClosed.statusCode).toBe(409);

    expect(
      (
        await call('POST', `/v1/projects/${tenant.projectId}/close`, owner, {
          reason: 'Handed over',
        })
      ).statusCode,
    ).toBe(204);
    const byCollaborator = await call(
      'POST',
      `/v1/projects/${tenant.projectId}/reopen`,
      collaborator.session,
      {},
    );
    expect(byCollaborator.statusCode).toBe(403);
    const crossTenant = await call(
      'POST',
      `/v1/projects/${tenant.projectId}/reopen`,
      await ownerSession(other),
      {},
    );
    expect(crossTenant.statusCode).toBe(404);

    const reopened = await call('POST', `/v1/projects/${tenant.projectId}/reopen`, owner, {
      reason: 'Snag list',
    });
    expect(reopened.statusCode, reopened.body).toBe(204);
    const after = ProjectSchema.parse(
      (await call('GET', `/v1/projects/${tenant.projectId}`, owner)).json(),
    );
    expect(after.status).toBe('ACTIVE');
    expect(after.closedAt).toBeNull();
    const audit = await container.uow.pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE aggregate_id = $1 ORDER BY sequence`,
      [tenant.projectId],
    );
    expect(audit.rows.map((r) => r.event_type)).toEqual(
      expect.arrayContaining(['project.closed.v1', 'project.reopened.v1']),
    );
  });
});

describe('dashboard for a collaborator', () => {
  it('answers with their own queue and no firm money figures', async () => {
    const collaborator = await member('COLLABORATOR');
    const otherCollaborator = await member('COLLABORATOR');
    const mine = await raiseAsCollaborator(collaborator);
    await raiseAsCollaborator(otherCollaborator);
    const sent = await createSentChangeOrder(container, tenant, { unitPriceMinor: 5_000_00 });
    await approve(sent.token);
    await createSentChangeOrder(container, tenant);

    const response = await call('GET', '/v1/dashboard', collaborator.session);
    expect(response.statusCode, response.body).toBe(200);
    const dashboard = DashboardSchema.parse(response.json());
    expect(dashboard).toMatchObject({
      audience: 'COLLABORATOR',
      awaitingReviewCount: 1,
      pendingDecisions: 1,
      unbilledApprovedTotalMinor: 0,
      unbilledApprovedCount: 0,
      approvedValueThisMonthMinor: 0,
      averageHoursToDecision: null,
    });
    expect(dashboard.awaitingReview.map((c) => c.id)).toEqual([mine.changeOrderId]);
    expect(dashboard.recentDecisions).toHaveLength(1);

    const team = DashboardSchema.parse(
      (await call('GET', '/v1/dashboard', await ownerSession())).json(),
    );
    expect(team.audience).toBe('TEAM');
    expect(team.awaitingReviewCount).toBe(2);
    expect(team.unbilledApprovedCount).toBe(1);
  });
});

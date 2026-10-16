import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import {
  PortalChangeRequestResultSchema,
  PortalDownloadSchema,
  PortalLinkCreatedSchema,
  PortalLinkListSchema,
  PortalViewSchema,
} from '@extrawork/contracts';
import { hashOpaqueToken, newId } from '@extrawork/db';
import type { RequestContext } from '@extrawork/application';
import type { Container } from '@extrawork/runtime';
import {
  addMember,
  createDraftChangeOrder,
  createSentChangeOrder,
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * The homeowner portal over HTTP — spec 2026-10-12, D5.
 *
 * What is pinned here is what the homeowner must never see: a proposal still
 * with the designer, a draft revision, a file outside a CLIENT folder, another
 * project's evidence. And that the link behaves like an approval link: shown
 * once, stored only as a hash, refused once revoked or expired, and narrowed
 * to its own tenant.
 */

let container: Container;
let app: FastifyInstance;
let alpha: TenantFixture;
let beta: TenantFixture;

interface Session {
  cookie: string;
  csrfToken: string;
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
  alpha = await createTenant(container, { name: 'Alpha Design Studio' });
  beta = await createTenant(container, { name: 'Beta Interiors' });
});

async function sessionFor(userId: string, organizationId: string): Promise<Session> {
  const created = await container.uow.transaction((tx) =>
    container.repos.identity.createSession(tx, {
      userId,
      activeOrganizationId: organizationId,
      ttlHours: 12,
      ipHash: null,
      userAgent: 'portal-vitest',
    }),
  );
  return { cookie: `ew_session=${created.sessionToken}`, csrfToken: created.csrfToken };
}

async function memberSession(
  tenant: TenantFixture,
  role: 'PROJECT_MANAGER' | 'VIEWER' | 'COLLABORATOR',
  grants: string[],
): Promise<{ ctx: RequestContext; session: Session }> {
  const ctx = await addMember(container, tenant, role, grants);
  const userId = ctx.actor.userId!;
  for (const projectId of grants) {
    await container.uow.pool.query(
      `INSERT INTO project_members (organization_id, project_id, user_id) VALUES ($1, $2, $3)`,
      [tenant.organizationId, projectId, userId],
    );
  }
  return { ctx, session: await sessionFor(userId, tenant.organizationId) };
}

function headers(session: Session | null, mutation: boolean) {
  const h: Record<string, string> = {};
  if (session) h.cookie = session.cookie;
  if (session && mutation) h['x-csrf-token'] = session.csrfToken;
  if (mutation) h['idempotency-key'] = `test-${randomUUID()}`;
  return h;
}

const get = (path: string, session: Session | null = null) =>
  app.inject({ method: 'GET', url: path, headers: headers(session, false) });
const post = (path: string, session: Session | null, body: unknown) =>
  app.inject({ method: 'POST', url: path, headers: headers(session, true), payload: body });
const del = (path: string, session: Session | null) =>
  app.inject({ method: 'DELETE', url: path, headers: headers(session, true) });

function errorOf(response: { json: () => unknown }) {
  return (response.json() as { error?: { code?: string; details?: Record<string, unknown> } })
    .error;
}

async function share(tenant: TenantFixture, body: Record<string, unknown> = {}) {
  const owner = await sessionFor(tenant.ownerUserId, tenant.organizationId);
  const response = await post(`/v1/projects/${tenant.projectId}/portal-links`, owner, body);
  expect(response.statusCode, response.body).toBe(201);
  const created = PortalLinkCreatedSchema.parse(response.json());
  const token = created.portalUrl.slice(created.portalUrl.lastIndexOf('/') + 1);
  return { created, token, owner };
}

async function folderId(tenant: TenantFixture, key: 'PLANS' | 'PHOTOS' | 'BILLS' | 'WHATSAPP') {
  return container.uow.transaction((tx) =>
    container.repos.workspace.systemFolderId(tx, tenant.owner.tenant, tenant.projectId, key),
  );
}

async function addNote(tenant: TenantFixture, folder: string, title: string) {
  return container.uow.transaction((tx) =>
    container.repos.workspace.insertDocument(tx, tenant.owner.tenant, {
      projectId: tenant.projectId,
      folderId: folder,
      kind: 'NOTE',
      title,
      body: `${title} body`,
    }),
  );
}

/** A scanned, promoted file filed into a folder, as the scan job leaves it. */
async function addCleanFile(tenant: TenantFixture, folder: string, filename: string) {
  const file = await container.uow.transaction((tx) =>
    container.repos.files.register(tx, tenant.owner.tenant, {
      projectId: tenant.projectId,
      storageKey: `quarantine/${tenant.organizationId}/${newId()}/${filename}`,
      filename,
      declaredMimeType: 'application/pdf',
      byteSize: 1234n,
      purpose: 'PROJECT_DOCUMENT',
      sha256: null,
    }),
  );
  await container.uow.pool.query(
    `UPDATE file_objects SET scan_status = 'CLEAN', uploaded_at = now(),
            detected_mime_type = 'application/pdf',
            promoted_storage_key = 'source/' || id::text || '.pdf'
      WHERE id = $1`,
    [file.id],
  );
  return container.uow.transaction((tx) =>
    container.repos.workspace.insertDocument(tx, tenant.owner.tenant, {
      projectId: tenant.projectId,
      folderId: folder,
      kind: 'FILE',
      title: filename,
      fileObjectId: file.id,
    }),
  );
}

async function readyEvidenceFor(tenant: TenantFixture, versionId: string, projectId: string) {
  const id = newId();
  await container.uow.pool.query(
    `INSERT INTO generated_documents
       (id, organization_id, project_id, version_id, kind, status, template_version, storage_key,
        generated_at)
     VALUES ($1::uuid, $2, $3, $4, 'EVIDENCE_PDF', 'READY', 'test-1', 'evidence/' || $1::text || '.pdf', now())`,
    [id, tenant.organizationId, projectId, versionId],
  );
  return id;
}

describe('sharing the portal with a homeowner', () => {
  it('returns the link once, stores only its hash, and audits it', async () => {
    const { created, token } = await share(alpha);

    expect(created.portalUrl).toMatch(/\/p\/[A-Za-z0-9_-]{43}$/);
    expect(created.link).toMatchObject({
      contactId: alpha.approverContactId,
      createdVia: 'WEB',
      viewCount: 0,
      revokedAt: null,
    });
    // The fixture's approver phone is +91 98450 00000.
    expect(created.whatsappShareUrl?.startsWith('https://wa.me/919845000000?text=')).toBe(true);
    expect(created.messageText).toContain(created.portalUrl);

    const stored = await container.uow.pool.query<{ token_sha256: Buffer }>(
      'SELECT token_sha256 FROM project_portal_links WHERE id = $1',
      [created.link.id],
    );
    expect(stored.rows[0]?.token_sha256.equals(hashOpaqueToken(token))).toBe(true);

    const audit = await container.uow.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM audit_events WHERE event_type = 'portal.link_created.v1'
         AND organization_id = $1`,
      [alpha.organizationId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0]?.payload)).not.toContain(token);

    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const list = PortalLinkListSchema.parse(
      (await get(`/v1/projects/${alpha.projectId}/portal-links`, owner)).json(),
    );
    expect(list.items.map((l) => l.id)).toEqual([created.link.id]);
  });

  it("refuses a contact who is not the project's customer, even in the same workspace", async () => {
    const other = await container.services.projects.createCustomer(alpha.owner, {
      displayName: 'Another household',
      contacts: [{ name: 'Neighbour', phoneE164: '+919811100000', isDefaultApprover: true }],
    });
    const [neighbour] = await container.repos.customers.listContacts(alpha.owner.tenant, other.id);
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);

    const response = await post(`/v1/projects/${alpha.projectId}/portal-links`, owner, {
      contactId: neighbour!.id,
    });
    expect(response.statusCode).toBe(400);

    // Another workspace's contact is simply not found from here.
    const foreign = await post(`/v1/projects/${alpha.projectId}/portal-links`, owner, {
      contactId: beta.approverContactId,
    });
    expect(foreign.statusCode).toBe(400);
  });

  it('is a designer action: viewers and collaborators cannot share or list', async () => {
    const viewer = await memberSession(alpha, 'VIEWER', [alpha.projectId]);
    const collaborator = await memberSession(alpha, 'COLLABORATOR', [alpha.projectId]);
    for (const { session } of [viewer, collaborator]) {
      expect(
        (await post(`/v1/projects/${alpha.projectId}/portal-links`, session, {})).statusCode,
      ).toBe(403);
      expect((await get(`/v1/projects/${alpha.projectId}/portal-links`, session)).statusCode).toBe(
        403,
      );
    }
    const designer = await memberSession(alpha, 'PROJECT_MANAGER', [alpha.projectId]);
    expect(
      (await post(`/v1/projects/${alpha.projectId}/portal-links`, designer.session, {})).statusCode,
    ).toBe(201);
  });

  it("keeps each workspace's links to itself", async () => {
    const { created } = await share(alpha);
    const betaOwner = await sessionFor(beta.ownerUserId, beta.organizationId);

    expect((await get(`/v1/projects/${alpha.projectId}/portal-links`, betaOwner)).statusCode).toBe(
      404,
    );
    expect((await del(`/v1/portal-links/${created.link.id}`, betaOwner)).statusCode).toBe(404);
    expect(
      (await post(`/v1/projects/${alpha.projectId}/portal-links`, betaOwner, {})).statusCode,
    ).toBe(404);
  });
});

describe('the public portal', () => {
  it('shows sent requests, CLIENT files and client milestones — and nothing else', async () => {
    const sent = await createSentChangeOrder(container, alpha, { title: 'Extra wardrobe' });
    await createDraftChangeOrder(container, alpha, { title: 'Draft the designer is writing' });
    await container.services.changeOrders.createProposal(
      alpha.owner,
      alpha.projectId,
      { description: 'Proposal still with the designer', attachmentIds: [] },
      { origin: 'WEB' },
    );

    const plans = await folderId(alpha, 'PLANS');
    const photos = await folderId(alpha, 'PHOTOS');
    const bills = await folderId(alpha, 'BILLS');
    await addNote(alpha, plans, 'Shared plan note');
    await addNote(alpha, photos, 'Team-only site note');
    await addNote(alpha, bills, 'Internal bill note');
    await addCleanFile(alpha, plans, 'layout.pdf');
    await container.uow.transaction(async (tx) => {
      await container.repos.milestones.insert(tx, alpha.owner.tenant, {
        projectId: alpha.projectId,
        title: 'Handover',
        kind: 'HANDOVER',
        dueDate: '2026-12-20',
        notes: null,
        clientVisible: true,
      });
      await container.repos.milestones.insert(tx, alpha.owner.tenant, {
        projectId: alpha.projectId,
        title: 'Pay the carpenter',
        kind: 'PAYMENT',
        dueDate: '2026-11-20',
        notes: null,
        clientVisible: false,
      });
    });

    const { token } = await share(alpha);
    const response = await get(`/public/v1/portal/${token}`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['x-robots-tag']).toContain('noindex');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.body).not.toContain(token);

    const view = PortalViewSchema.parse(response.json());
    expect(view.organizationName).toBe('Alpha Design Studio');
    expect(view.contactName).toBe(alpha.approverName);
    expect(view.requests.map((r) => r.title)).toEqual(['Extra wardrobe']);
    expect(view.requests[0]).toMatchObject({
      id: sent.changeOrder.changeOrderId,
      status: 'SENT',
      actionable: true,
      evidenceReady: false,
      evidenceDocumentId: null,
    });
    expect(view.documents.map((d) => d.title).sort()).toEqual(['Shared plan note', 'layout.pdf']);
    expect(view.documents.every((d) => d.folderVisibility === 'CLIENT')).toBe(true);
    expect(view.milestones.map((m) => m.title)).toEqual(['Handover']);
    expect(view.contract.history[0]?.kind).toBe('BASELINE');
    expect(view.contract.pendingDeltaMinor).toBe(view.requests[0]?.totalDeltaMinor);
    expect(view.canAskForChange).toBe(true);
  });

  it('counts each view', async () => {
    const { token, created, owner } = await share(alpha);
    await get(`/public/v1/portal/${token}`);
    await get(`/public/v1/portal/${token}`);
    const list = PortalLinkListSchema.parse(
      (await get(`/v1/projects/${alpha.projectId}/portal-links`, owner)).json(),
    );
    const link = list.items.find((l) => l.id === created.link.id);
    expect(link?.viewCount).toBe(2);
    expect(link?.lastViewedAt).not.toBeNull();
  });

  it('stops working when revoked, and says so', async () => {
    const { token, created, owner } = await share(alpha);
    expect((await del(`/v1/portal-links/${created.link.id}`, owner)).statusCode).toBe(204);
    // Idempotent.
    expect((await del(`/v1/portal-links/${created.link.id}`, owner)).statusCode).toBe(204);

    const response = await get(`/public/v1/portal/${token}`);
    expect(response.statusCode).toBe(404);
    expect(errorOf(response)).toMatchObject({
      code: 'PORTAL_LINK_INVALID',
      details: { reason: 'REVOKED' },
    });
    const audits = await container.uow.pool.query(
      `SELECT 1 FROM audit_events WHERE event_type = 'portal.link_revoked.v1'`,
    );
    expect(audits.rows).toHaveLength(1);
  });

  it('refuses an expired link, an unknown one, and one into a closed workspace', async () => {
    const expired = await share(alpha);
    await container.uow.pool.query(
      `UPDATE project_portal_links SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [expired.created.link.id],
    );
    const expiredResponse = await get(`/public/v1/portal/${expired.token}`);
    expect(expiredResponse.statusCode).toBe(404);
    expect(errorOf(expiredResponse)?.details).toMatchObject({ reason: 'EXPIRED' });

    const unknown = await get(`/public/v1/portal/${'A'.repeat(43)}`);
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown)).toMatchObject({ code: 'PORTAL_LINK_INVALID' });

    const closing = await share(beta);
    await container.uow.pool.query(
      `UPDATE organizations SET status = 'CLOSED', closed_at = now(),
              purge_after = now() + interval '30 days', closure_reason = 'test'
        WHERE id = $1`,
      [beta.organizationId],
    );
    expect((await get(`/public/v1/portal/${closing.token}`)).statusCode).toBe(404);
  });

  it('never reaches another project, even in the same workspace', async () => {
    const second = await container.services.projects.createProject(alpha.owner, {
      customerId: alpha.customerId,
      title: 'Second flat',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      baseline: { subtotalMinor: 100_00, taxMinor: 0, totalMinor: 100_00 },
      defaultApproverContactId: alpha.approverContactId,
    });
    const { token } = await share(alpha);
    const secondFixture = { ...alpha, projectId: second.id };
    const plans = await folderId(secondFixture, 'PLANS');
    await addNote(secondFixture, plans, 'Second flat plan');

    const view = PortalViewSchema.parse((await get(`/public/v1/portal/${token}`)).json());
    expect(view.documents.map((d) => d.title)).not.toContain('Second flat plan');
  });
});

describe('portal downloads', () => {
  it('signs a CLEAN client file as an attachment, and nothing outside CLIENT', async () => {
    const plans = await folderId(alpha, 'PLANS');
    const bills = await folderId(alpha, 'BILLS');
    const shared = await addCleanFile(alpha, plans, 'boq.pdf');
    const internal = await addCleanFile(alpha, bills, 'carpenter-bill.pdf');
    const { token } = await share(alpha);

    const ok = await get(`/public/v1/portal/${token}/documents/${shared.id}`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(PortalDownloadSchema.parse(ok.json()).filename).toBe('boq.pdf');

    const refused = await get(`/public/v1/portal/${token}/documents/${internal.id}`);
    expect(refused.statusCode).toBe(404);
    expect(errorOf(refused)?.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it("serves a ready evidence pack of a sent request, but not another project's", async () => {
    const sent = await createSentChangeOrder(container, alpha);
    const versionId = sent.sent.versionId;
    const evidenceId = await readyEvidenceFor(alpha, versionId, alpha.projectId);
    const betaSent = await createSentChangeOrder(container, beta);
    const betaEvidence = await readyEvidenceFor(beta, betaSent.sent.versionId, beta.projectId);
    const { token } = await share(alpha);

    const view = PortalViewSchema.parse((await get(`/public/v1/portal/${token}`)).json());
    expect(view.requests[0]).toMatchObject({ evidenceReady: true, evidenceDocumentId: evidenceId });

    const ok = await get(`/public/v1/portal/${token}/documents/${evidenceId}`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(PortalDownloadSchema.parse(ok.json()).filename).toMatch(/-evidence\.pdf$/);

    expect((await get(`/public/v1/portal/${token}/documents/${betaEvidence}`)).statusCode).toBe(
      404,
    );
  });
});

describe('asking for a change from the portal', () => {
  it('becomes a proposal for the designer, attributed to the contact', async () => {
    const { token } = await share(alpha);
    const response = await post(`/public/v1/portal/${token}/requests`, null, {
      description: 'Can we move the study shelf to the left wall?',
      room: 'Study',
      reason: 'The window side gets too much sun',
    });
    expect(response.statusCode, response.body).toBe(201);
    const result = PortalChangeRequestResultSchema.parse(response.json());
    expect(result.number).toMatch(/-R\d{2}$/);

    const rows = await container.uow.pool.query<{
      origin: string;
      submitted_by_contact_id: string;
      submitted_for_review_at: Date | null;
      status: string;
      room: string;
    }>(
      `SELECT v.origin, v.submitted_by_contact_id, v.submitted_for_review_at, v.status, v.room
         FROM change_order_versions v JOIN change_orders co ON co.id = v.change_order_id
        WHERE co.number = $1 AND co.organization_id = $2`,
      [result.number, alpha.organizationId],
    );
    expect(rows.rows[0]).toMatchObject({
      origin: 'PORTAL',
      submitted_by_contact_id: alpha.approverContactId,
      status: 'DRAFT',
      room: 'Study',
    });
    expect(rows.rows[0]?.submitted_for_review_at).not.toBeNull();

    // The designer hears about it; the homeowner does not see it until it is sent.
    const notes = await container.uow.pool.query(
      `SELECT 1 FROM notifications WHERE organization_id = $1 AND kind = 'REQUEST_SUBMITTED'`,
      [alpha.organizationId],
    );
    expect(notes.rows.length).toBeGreaterThan(0);
    const view = PortalViewSchema.parse((await get(`/public/v1/portal/${token}`)).json());
    expect(view.requests).toHaveLength(0);
  });

  it('refuses on a closed project and a dead link', async () => {
    const { token, created, owner } = await share(alpha);
    await container.uow.pool.query(
      `UPDATE projects SET status = 'CLOSED', closed_at = now() WHERE id = $1`,
      [alpha.projectId],
    );
    const closed = await post(`/public/v1/portal/${token}/requests`, null, {
      description: 'Please add a mirror in the hall',
    });
    expect(closed.statusCode).toBe(409);
    expect(
      PortalViewSchema.parse((await get(`/public/v1/portal/${token}`)).json()).canAskForChange,
    ).toBe(false);

    await del(`/v1/portal-links/${created.link.id}`, owner);
    const dead = await post(`/public/v1/portal/${token}/requests`, null, {
      description: 'Please add a mirror in the hall',
    });
    expect(dead.statusCode).toBe(404);
  });
});

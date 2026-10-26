import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import type { JobRow } from '@extrawork/db';
import type { Container } from '@extrawork/runtime';
import {
  addMember,
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';
import { workerContext } from '../../apps/worker/src/context.js';
import { scanFile } from '../../apps/worker/src/jobs/files.js';
import type { PdfRenderer } from '../../apps/worker/src/pdf/renderer.js';

/**
 * Authorization across every route the three-party pivot added (spec
 * 2026-10-12), in one matrix rather than per slice.
 *
 * Each slice tested its own routes; this asks the same three questions of all
 * of them together, so a route added later without a guard shows up here:
 *
 *   1. Nobody signed in gets 401, never data.
 *   2. Another workspace's owner, holding a valid session and the exact ids,
 *      gets 403 or 404 and changes nothing (D1: no cross-tenant sharing).
 *   3. A collaborator granted a *different* project in the same workspace
 *      gets 403 or 404 too — COLLABORATOR is never org-wide.
 *
 * Plus the RACI rule a collaborator on the right project can still trip:
 * only the designer changes the record (folders, milestones, portal links,
 * invitations, dismissing or invoicing a request), and INTERNAL folders are
 * invisible to them.
 */

const pdfStub: PdfRenderer = {
  render: () => Promise.reject(new Error('file scans must not render PDFs')),
  rendererVersion: () => Promise.resolve('test-renderer'),
  close: () => Promise.resolve(),
};

interface Session {
  cookie: string;
  csrfToken: string;
}

interface Probe {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  payload?: Record<string, unknown>;
}

let container: Container;
let app: FastifyInstance;
let alpha: TenantFixture;
let beta: TenantFixture;
let owner: Session;
let betaOwner: Session;
/** A collaborator granted only `otherProjectId`, never `alpha.projectId`. */
let outsider: Session;
/** A collaborator granted `alpha.projectId`. */
let collaborator: Session;
let collaboratorUserId: string;
let otherProjectId: string;
let ids: {
  folderId: string;
  internalFolderId: string;
  documentId: string;
  internalDocumentId: string;
  milestoneId: string;
  portalLinkId: string;
  invitationId: string;
  proposalId: string;
};

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

async function sessionFor(userId: string, organizationId: string): Promise<Session> {
  const session = await container.uow.transaction((tx) =>
    container.repos.identity.createSession(tx, {
      userId,
      activeOrganizationId: organizationId,
      ttlHours: 12,
      ipHash: null,
      userAgent: 'authz-matrix-vitest',
    }),
  );
  return { cookie: `ew_session=${session.sessionToken}`, csrfToken: session.csrfToken };
}

async function grant(projectId: string, userId: string) {
  await container.uow.pool.query(
    `INSERT INTO project_members (organization_id, project_id, user_id) VALUES ($1, $2, $3)`,
    [alpha.organizationId, projectId, userId],
  );
}

function call(probe: Probe, session: Session | null) {
  return app.inject({
    method: probe.method,
    url: probe.url,
    headers: session
      ? {
          cookie: session.cookie,
          'x-csrf-token': session.csrfToken,
          'idempotency-key': `authz-${randomUUID()}`,
        }
      : {},
    ...(probe.payload === undefined ? {} : { payload: probe.payload }),
  });
}

/** presign → PUT → complete → scan, so downloads probe a real, clean file. */
async function uploadCsv(session: Session, folderId: string, text: string): Promise<string> {
  const bytes = Buffer.from(text, 'utf8');
  const presign = await call200(
    {
      name: 'presign',
      method: 'POST',
      url: '/v1/uploads',
      payload: {
        filename: 'rates.csv',
        contentType: 'text/csv',
        byteSize: bytes.length,
        purpose: 'PROJECT_DOCUMENT',
        projectId: alpha.projectId,
      },
    },
    session,
  );
  const put = await app.inject({
    method: 'PUT',
    url: new URL(presign.uploadUrl as string).pathname,
    headers: { 'content-type': 'text/csv' },
    payload: bytes,
  });
  expect(put.statusCode, put.body).toBe(200);
  const fileObjectId = presign.fileObjectId as string;
  await call200(
    { name: 'complete', method: 'POST', url: '/v1/uploads/complete', payload: { fileObjectId } },
    session,
  );
  const job: JobRow = {
    id: randomUUID(),
    organizationId: alpha.organizationId,
    kind: 'scan_file',
    payload: { fileObjectId, organizationId: alpha.organizationId },
    attemptCount: 1,
    maxAttempts: 6,
    dedupeKey: `scan:${fileObjectId}`,
    createdAt: new Date(),
  };
  await scanFile(job, workerContext(container, pdfStub));
  const document = await call200(
    {
      name: 'file document',
      method: 'POST',
      url: `/v1/projects/${alpha.projectId}/documents`,
      payload: { kind: 'FILE', folderId, fileObjectId },
    },
    session,
  );
  return document.id as string;
}

async function call200(probe: Probe, session: Session) {
  const response = await call(probe, session);
  expect(response.statusCode, `${probe.name}: ${response.body}`).toBeLessThan(300);
  return response.json<Record<string, unknown>>();
}

beforeEach(async () => {
  await truncateAll(container);
  alpha = await createTenant(container, { name: 'Alpha Interiors' });
  beta = await createTenant(container, { name: 'Beta Builders' });
  owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
  betaOwner = await sessionFor(beta.ownerUserId, beta.organizationId);

  const second = await container.services.projects.createProject(alpha.owner, {
    customerId: alpha.customerId,
    title: 'Second villa',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    baseline: { subtotalMinor: 100_000, taxMinor: 18_000, totalMinor: 118_000 },
    defaultApproverContactId: alpha.approverContactId,
  });
  otherProjectId = second.id;

  const outsiderMember = await addMember(container, alpha, 'COLLABORATOR');
  await grant(otherProjectId, outsiderMember.actor.userId!);
  outsider = await sessionFor(outsiderMember.actor.userId!, alpha.organizationId);

  const collaboratorMember = await addMember(container, alpha, 'COLLABORATOR');
  collaboratorUserId = collaboratorMember.actor.userId!;
  await grant(alpha.projectId, collaboratorUserId);
  collaborator = await sessionFor(collaboratorUserId, alpha.organizationId);

  // Everything below is created by the owner through the API, so the ids are
  // real and every probe targets something that exists.
  const project = `/v1/projects/${alpha.projectId}`;
  const folder = await call200(
    {
      name: 'folder',
      method: 'POST',
      url: `${project}/folders`,
      payload: { name: 'Site drawings' },
    },
    owner,
  );
  const internal = await call200(
    {
      name: 'internal folder',
      method: 'POST',
      url: `${project}/folders`,
      payload: { name: 'Margins', visibility: 'INTERNAL' },
    },
    owner,
  );
  const documentId = await uploadCsv(owner, folder.id as string, 'Item,Rate\nMatte tiles,85\n');
  const internalDocumentId = await uploadCsv(
    owner,
    internal.id as string,
    'Item,Margin\nTiles,Our margin 18%\n',
  );
  const milestone = await call200(
    {
      name: 'milestone',
      method: 'POST',
      url: `${project}/milestones`,
      payload: { title: 'Handover', dueDate: '2026-12-15' },
    },
    owner,
  );
  const portalLink = await call200(
    { name: 'portal link', method: 'POST', url: `${project}/portal-links`, payload: {} },
    owner,
  );
  await call200(
    {
      name: 'invite',
      method: 'POST',
      url: `${project}/collaborators`,
      payload: { email: 'contractor@example.test', party: 'CONSTRUCTION' },
    },
    owner,
  );
  const invitation = await container.uow.pool.query<{ id: string }>(
    'SELECT id FROM project_invitations WHERE organization_id = $1',
    [alpha.organizationId],
  );
  const proposal = await call200(
    {
      name: 'proposal',
      method: 'POST',
      url: `/v1/projects/${alpha.projectId}/proposals`,
      payload: { description: 'Two more lights in the master bedroom' },
    },
    collaborator,
  );

  ids = {
    folderId: folder.id as string,
    internalFolderId: internal.id as string,
    documentId,
    internalDocumentId,
    milestoneId: ((milestone.milestone as { id?: string } | undefined)?.id ??
      milestone.id) as string,
    portalLinkId: ((portalLink.link as { id?: string } | undefined)?.id ?? portalLink.id) as string,
    invitationId: invitation.rows[0]?.id as string,
    proposalId: proposal.changeOrderId as string,
  };
  for (const [key, value] of Object.entries(ids)) {
    expect(value, `fixture id ${key}`).toMatch(/^[0-9a-f-]{36}$/);
  }
});

/** Every authenticated route the pivot added that targets alpha's project or its records. */
function projectProbes(): Probe[] {
  const project = `/v1/projects/${alpha.projectId}`;
  return [
    { name: 'list collaborators', method: 'GET', url: `${project}/collaborators` },
    {
      name: 'invite collaborator',
      method: 'POST',
      url: `${project}/collaborators`,
      payload: { email: 'intruder@example.test', party: 'CONSTRUCTION' },
    },
    {
      name: 'remove collaborator',
      method: 'DELETE',
      url: `${project}/collaborators/${collaboratorUserId}`,
    },
    { name: 'revoke invitation', method: 'DELETE', url: `/v1/invitations/${ids.invitationId}` },
    { name: 'workspace', method: 'GET', url: `${project}/workspace` },
    {
      name: 'create folder',
      method: 'POST',
      url: `${project}/folders`,
      payload: { name: 'Intruder folder' },
    },
    {
      name: 'rename folder',
      method: 'PATCH',
      url: `/v1/folders/${ids.folderId}`,
      payload: { name: 'Renamed' },
    },
    { name: 'delete folder', method: 'DELETE', url: `/v1/folders/${ids.folderId}` },
    {
      name: 'add note',
      method: 'POST',
      url: `${project}/documents`,
      payload: { kind: 'NOTE', folderId: ids.folderId, body: 'Intruder note' },
    },
    {
      name: 'edit document',
      method: 'PATCH',
      url: `/v1/documents/${ids.documentId}`,
      payload: { title: 'Changed' },
    },
    { name: 'delete document', method: 'DELETE', url: `/v1/documents/${ids.documentId}` },
    { name: 'download document', method: 'GET', url: `/v1/documents/${ids.documentId}/download` },
    { name: 'list milestones', method: 'GET', url: `${project}/milestones` },
    {
      name: 'create milestone',
      method: 'POST',
      url: `${project}/milestones`,
      payload: { title: 'Intruder', dueDate: '2026-12-20' },
    },
    {
      name: 'edit milestone',
      method: 'PATCH',
      url: `/v1/milestones/${ids.milestoneId}`,
      payload: { title: 'Changed' },
    },
    { name: 'delete milestone', method: 'DELETE', url: `/v1/milestones/${ids.milestoneId}` },
    { name: 'list portal links', method: 'GET', url: `${project}/portal-links` },
    { name: 'create portal link', method: 'POST', url: `${project}/portal-links`, payload: {} },
    { name: 'revoke portal link', method: 'DELETE', url: `/v1/portal-links/${ids.portalLinkId}` },
    {
      name: 'raise proposal',
      method: 'POST',
      url: `${project}/proposals`,
      payload: { description: 'Intruder request for extra work' },
    },
    {
      name: 'dismiss proposal',
      method: 'POST',
      url: `/v1/change-orders/${ids.proposalId}/dismiss`,
      payload: { reason: 'Not needed' },
    },
    {
      name: 'mark invoiced',
      method: 'POST',
      url: `/v1/change-orders/${ids.proposalId}/invoicing`,
      payload: {},
    },
    {
      name: 'clear invoiced',
      method: 'DELETE',
      url: `/v1/change-orders/${ids.proposalId}/invoicing`,
    },
    { name: 'contract history', method: 'GET', url: `${project}/contract-history` },
    { name: 'close project', method: 'POST', url: `${project}/close`, payload: {} },
    { name: 'reopen project', method: 'POST', url: `${project}/reopen`, payload: {} },
  ];
}

/** Rows a successful intrusion would have changed. */
async function snapshot(): Promise<string> {
  const { rows } = await container.uow.pool.query<{ snapshot: string }>(
    `SELECT concat_ws('|',
       (SELECT string_agg(id::text || name || visibility::text, ',' ORDER BY id) FROM project_folders WHERE organization_id = $1),
       (SELECT string_agg(id::text || title || coalesce(deleted_at::text, '-'), ',' ORDER BY id) FROM project_documents WHERE organization_id = $1),
       (SELECT string_agg(id::text || title, ',' ORDER BY id) FROM project_milestones WHERE organization_id = $1),
       (SELECT string_agg(id::text || coalesce(revoked_at::text, '-'), ',' ORDER BY id) FROM project_portal_links WHERE organization_id = $1),
       (SELECT string_agg(id::text || coalesce(revoked_at::text, '-'), ',' ORDER BY id) FROM project_invitations WHERE organization_id = $1),
       (SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM project_members WHERE organization_id = $1),
       (SELECT count(*)::text FROM change_orders WHERE organization_id = $1),
       (SELECT string_agg(id::text || status::text || coalesce(reviewed_at::text, '-') || coalesce(invoiced_at::text, '-'), ',' ORDER BY id)
          FROM change_order_versions WHERE organization_id = $1),
       (SELECT string_agg(id::text || status::text, ',' ORDER BY id) FROM projects WHERE organization_id = $1)
     ) AS snapshot`,
    [alpha.organizationId],
  );
  return rows[0]?.snapshot ?? '';
}

describe('every three-party route refuses', () => {
  it('a caller who is not signed in', async () => {
    for (const probe of projectProbes()) {
      const response = await call(probe, null);
      expect(response.statusCode, probe.name).toBe(401);
    }
    for (const url of [
      '/v1/notifications',
      '/v1/notifications/summary',
      '/v1/notifications/preferences',
      '/v1/calendar',
      '/v1/calendar/feed',
      '/v1/invitations/pending',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
  });

  it("another workspace's owner holding the exact ids, and changes nothing", async () => {
    const before = await snapshot();
    for (const probe of projectProbes()) {
      const response = await call(probe, betaOwner);
      expect([403, 404], `${probe.name} → ${response.statusCode} ${response.body}`).toContain(
        response.statusCode,
      );
      expect(response.body, probe.name).not.toContain('Matte tiles');
    }
    expect(await snapshot()).toBe(before);
  });

  it('a collaborator granted a different project in the same workspace', async () => {
    const before = await snapshot();
    for (const probe of projectProbes()) {
      const response = await call(probe, outsider);
      expect([403, 404], `${probe.name} → ${response.statusCode} ${response.body}`).toContain(
        response.statusCode,
      );
      expect(response.body, probe.name).not.toContain('Matte tiles');
    }
    expect(await snapshot()).toBe(before);
  });
});

describe('a collaborator on the project', () => {
  const DESIGNER_ONLY = new Set([
    'invite collaborator',
    'remove collaborator',
    'revoke invitation',
    'create folder',
    'rename folder',
    'delete folder',
    'edit document',
    'delete document',
    'create milestone',
    'edit milestone',
    'delete milestone',
    'list portal links',
    'create portal link',
    'revoke portal link',
    'dismiss proposal',
    'mark invoiced',
    'clear invoiced',
    'close project',
    'reopen project',
  ]);

  it('cannot change the record: designer-only actions are refused', async () => {
    const before = await snapshot();
    for (const probe of projectProbes().filter((p) => DESIGNER_ONLY.has(p.name))) {
      const response = await call(probe, collaborator);
      expect([403, 404], `${probe.name} → ${response.statusCode} ${response.body}`).toContain(
        response.statusCode,
      );
    }
    expect(await snapshot()).toBe(before);
  });

  it('can read the project, add a note and raise a request', async () => {
    for (const probe of projectProbes().filter(
      (p) => !DESIGNER_ONLY.has(p.name) && p.name !== 'contract history',
    )) {
      const response = await call(probe, collaborator);
      expect(response.statusCode, `${probe.name}: ${response.body}`).toBeLessThan(300);
    }
  });

  it('never sees an INTERNAL folder or what is in it', async () => {
    const view = await call(
      { name: 'workspace', method: 'GET', url: `/v1/projects/${alpha.projectId}/workspace` },
      collaborator,
    );
    expect(view.statusCode).toBe(200);
    expect(view.body).not.toContain(ids.internalFolderId);
    expect(view.body).not.toContain(ids.internalDocumentId);

    for (const probe of [
      {
        name: 'download internal',
        method: 'GET' as const,
        url: `/v1/documents/${ids.internalDocumentId}/download`,
      },
      {
        name: 'note into internal',
        method: 'POST' as const,
        url: `/v1/projects/${alpha.projectId}/documents`,
        payload: { kind: 'NOTE', folderId: ids.internalFolderId, body: 'Planted' },
      },
    ]) {
      const response = await call(probe, collaborator);
      expect([403, 404], `${probe.name} → ${response.statusCode}`).toContain(response.statusCode);
      expect(response.body).not.toContain('Margin');
    }
  });
});

describe('row-level security covers every tenant table', () => {
  /**
   * Readable before a tenant is known, by design (migration 0019): resolving a
   * session reads `memberships`. `purged_organizations` is the operator's
   * tombstone of workspaces already erased (migration 0018) and belongs to no
   * live tenant. Anything else carrying an `organization_id` must have RLS
   * enabled, forced and a policy — a new table that forgets it is readable
   * across tenants by any role the database does not exempt.
   */
  const EXEMPT = new Set(['memberships', 'purged_organizations']);

  it('forces RLS, with a policy, on every table that has an organization_id', async () => {
    const { rows } = await container.uow.pool.query<{
      relname: string;
      enabled: boolean;
      forced: boolean;
      policies: string;
    }>(
      `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
              (SELECT count(*) FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname)::text AS policies
         FROM pg_class c
         JOIN pg_attribute a
           ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
        WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace`,
    );
    const unprotected = rows
      .filter((r) => !EXEMPT.has(r.relname))
      .filter((r) => !r.enabled || !r.forced || r.policies === '0')
      .map((r) => r.relname);
    expect(unprotected).toEqual([]);
    // The pivot's tables are among those checked, not silently skipped.
    expect(rows.map((r) => r.relname)).toEqual(
      expect.arrayContaining([
        'project_folders',
        'project_documents',
        'project_milestones',
        'project_portal_links',
        'project_invitations',
        'notifications',
        'notification_preferences',
        'calendar_feed_tokens',
      ]),
    );
  });

  it('keeps WhatsApp conversations to the system scope only', async () => {
    const { rows } = await container.uow.pool.query<{ qual: string }>(
      `SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_conversations'`,
    );
    expect(rows).toHaveLength(1);
    // Cross-tenant routing state: no tenant scope may read it, only '*'.
    expect(rows[0]?.qual).not.toMatch(/\(organization_id\)::text/);
    expect(rows[0]?.qual).toContain("'*'");
  });
});

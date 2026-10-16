import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import {
  DocumentDownloadSchema,
  ProjectDocumentSchema,
  ProjectWorkspaceSchema,
  type ProjectDocumentDto,
  type ProjectWorkspaceDto,
} from '@extrawork/contracts';
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
 * The project as a shared folder — spec 2026-10-12, D10–D12, over HTTP.
 *
 * Three people on one project: the owner (designer firm), a granted designer
 * (PROJECT_MANAGER) and a collaborator from a construction firm. A second
 * workspace exists so cross-tenant probes have somewhere to cross into.
 */

interface Session {
  cookie: string;
  csrfToken: string;
}

const pdfStub: PdfRenderer = {
  render: () => Promise.reject(new Error('file scans must not render PDFs')),
  rendererVersion: () => Promise.resolve('test-renderer'),
  close: () => Promise.resolve(),
};

let container: Container;
let app: FastifyInstance;
let alpha: TenantFixture;
let beta: TenantFixture;
let owner: Session;
let designer: Session;
let designerUserId: string;
let collaborator: Session;
let collaboratorUserId: string;
let betaOwner: Session;
let otherProjectId: string;

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
      userAgent: 'workspace-vitest',
    }),
  );
  return { cookie: `ew_session=${session.sessionToken}`, csrfToken: session.csrfToken };
}

async function grant(organizationId: string, projectId: string, userId: string) {
  await container.uow.pool.query(
    `INSERT INTO project_members (organization_id, project_id, user_id) VALUES ($1, $2, $3)`,
    [organizationId, projectId, userId],
  );
}

beforeEach(async () => {
  await truncateAll(container);
  alpha = await createTenant(container, { name: 'Alpha Interiors' });
  beta = await createTenant(container, { name: 'Beta Builders' });
  owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
  betaOwner = await sessionFor(beta.ownerUserId, beta.organizationId);

  const pm = await addMember(container, alpha, 'PROJECT_MANAGER');
  designerUserId = pm.actor.userId!;
  await grant(alpha.organizationId, alpha.projectId, designerUserId);
  designer = await sessionFor(designerUserId, alpha.organizationId);

  const collab = await addMember(container, alpha, 'COLLABORATOR');
  collaboratorUserId = collab.actor.userId!;
  await grant(alpha.organizationId, alpha.projectId, collaboratorUserId);
  collaborator = await sessionFor(collaboratorUserId, alpha.organizationId);

  const second = await container.services.projects.createProject(alpha.owner, {
    customerId: alpha.customerId,
    title: 'Second villa',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    baseline: { subtotalMinor: 100_000, taxMinor: 18_000, totalMinor: 118_000 },
    defaultApproverContactId: alpha.approverContactId,
  });
  otherProjectId = second.id;
});

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  url: string,
  session: Session | null,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: session
      ? {
          cookie: session.cookie,
          'x-csrf-token': session.csrfToken,
          'idempotency-key': `ws-${randomUUID()}`,
        }
      : {},
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function workspace(session: Session, projectId = alpha.projectId) {
  const response = await call('GET', `/v1/projects/${projectId}/workspace`, session);
  expect(response.statusCode).toBe(200);
  return ProjectWorkspaceSchema.parse(response.json()) as ProjectWorkspaceDto;
}

function folderId(view: ProjectWorkspaceDto, systemKey: string): string {
  const folder = view.folders.find((f) => f.systemKey === systemKey);
  if (!folder) throw new Error(`no ${systemKey} folder`);
  return folder.id;
}

async function notificationsFor(userId: string) {
  const result = await container.uow.pool.query<{ kind: string; title: string; link_path: string }>(
    `SELECT kind, title, link_path FROM notifications WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return result.rows;
}

/** presign → PUT → complete → scan, as the browser and worker would. */
async function uploadProjectFile(
  session: Session,
  input: { filename: string; contentType: string; bytes: Buffer; projectId?: string },
): Promise<string> {
  const presign = await call('POST', '/v1/uploads', session, {
    filename: input.filename,
    contentType: input.contentType,
    byteSize: input.bytes.length,
    purpose: 'PROJECT_DOCUMENT',
    projectId: input.projectId ?? alpha.projectId,
  });
  expect(presign.statusCode).toBe(201);
  const { fileObjectId, uploadUrl } = presign.json() as { fileObjectId: string; uploadUrl: string };
  const put = await app.inject({
    method: 'PUT',
    url: new URL(uploadUrl).pathname,
    headers: { 'content-type': input.contentType },
    payload: input.bytes,
  });
  expect(put.statusCode, put.body).toBe(200);
  const complete = await call('POST', '/v1/uploads/complete', session, { fileObjectId });
  expect(complete.statusCode).toBe(200);
  return fileObjectId;
}

async function scan(fileObjectId: string) {
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
}

describe('workspace view', () => {
  it('creates the default folders lazily and shows the firm every folder', async () => {
    const view = await workspace(owner);
    expect(view.folders.map((f) => f.systemKey)).toEqual([
      'PLANS',
      'CONTRACTS',
      'PHOTOS',
      'BILLS',
      'WHATSAPP',
    ]);
    expect(view.canManageFolders).toBe(true);
    expect(view.canUpload).toBe(true);
    expect(view.storage.quotaBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(view.approvals).toEqual({ requestCount: 0, decidedCount: 0 });
    // Reading again does not duplicate anything.
    expect((await workspace(owner)).folders).toHaveLength(5);
  });

  it('never shows a collaborator the INTERNAL folder, and does not let them manage', async () => {
    const view = await workspace(collaborator);
    expect(view.folders.map((f) => f.systemKey)).not.toContain('BILLS');
    expect(view.folders.every((f) => f.visibility !== 'INTERNAL')).toBe(true);
    expect(view.canManageFolders).toBe(false);
    expect(view.canUpload).toBe(true);
  });

  it('refuses a collaborator a project they are not granted', async () => {
    const response = await call('GET', `/v1/projects/${otherProjectId}/workspace`, collaborator);
    expect(response.statusCode).toBe(403);
  });

  it('isolates tenants: another workspace cannot read this project', async () => {
    const response = await call('GET', `/v1/projects/${alpha.projectId}/workspace`, betaOwner);
    expect(response.statusCode).toBe(404);
  });
});

describe('links and notes', () => {
  it('adds a Drive link, notifies everyone else on the project, and audits it', async () => {
    const view = await workspace(owner);
    const response = await call('POST', `/v1/projects/${alpha.projectId}/documents`, owner, {
      kind: 'LINK',
      folderId: folderId(view, 'PLANS'),
      url: 'https://drive.google.com/drive/folders/abc123',
    });
    expect(response.statusCode).toBe(201);
    const document = ProjectDocumentSchema.parse(response.json()) as ProjectDocumentDto;
    expect(document).toMatchObject({
      kind: 'LINK',
      title: 'Google Drive link',
      linkProvider: 'GOOGLE_DRIVE',
      source: 'WEB',
      canManage: true,
    });

    expect(await notificationsFor(collaboratorUserId)).toEqual([
      expect.objectContaining({
        kind: 'DOCUMENT_ADDED',
        link_path: `/app/projects/${alpha.projectId}/files`,
      }),
    ]);
    expect(await notificationsFor(designerUserId)).toHaveLength(1);
    expect(await notificationsFor(alpha.ownerUserId)).toHaveLength(0);

    const audit = await container.uow.pool.query<{ event_type: string; aggregate_type: string }>(
      `SELECT event_type, aggregate_type FROM audit_events
       WHERE aggregate_id = $1 AND event_type = 'project.document_added.v1'`,
      [alpha.projectId],
    );
    expect(audit.rows).toEqual([
      { event_type: 'project.document_added.v1', aggregate_type: 'project' },
    ]);
  });

  it('refuses a link that is not https', async () => {
    const view = await workspace(owner);
    const response = await call('POST', `/v1/projects/${alpha.projectId}/documents`, owner, {
      kind: 'LINK',
      folderId: folderId(view, 'PLANS'),
      url: 'http://example.com/plan.pdf',
    });
    expect(response.statusCode).toBe(400);
  });

  it('tells only designers about an INTERNAL note', async () => {
    const view = await workspace(owner);
    const response = await call('POST', `/v1/projects/${alpha.projectId}/documents`, owner, {
      kind: 'NOTE',
      folderId: folderId(view, 'BILLS'),
      body: 'Tile supplier invoice due Friday\nPay by NEFT',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ title: 'Tile supplier invoice due Friday' });
    expect(await notificationsFor(designerUserId)).toEqual([
      expect.objectContaining({ kind: 'NOTE_ADDED' }),
    ]);
    expect(await notificationsFor(collaboratorUserId)).toEqual([]);
  });
});

describe('collaborator scoping', () => {
  it('lets a collaborator add to shared folders but never reach INTERNAL ones', async () => {
    const ownerView = await workspace(owner);
    const internal = await call('POST', `/v1/projects/${alpha.projectId}/documents`, owner, {
      kind: 'NOTE',
      folderId: folderId(ownerView, 'BILLS'),
      body: 'Margin on electricals: 18%',
    });
    const internalId = (internal.json() as { id: string }).id;

    const added = await call('POST', `/v1/projects/${alpha.projectId}/documents`, collaborator, {
      kind: 'NOTE',
      folderId: folderId(ownerView, 'PHOTOS'),
      body: 'Slab cast on level 2',
    });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ canManage: false, addedByLabel: expect.any(String) });

    const intoInternal = await call(
      'POST',
      `/v1/projects/${alpha.projectId}/documents`,
      collaborator,
      { kind: 'NOTE', folderId: folderId(ownerView, 'BILLS'), body: 'peek' },
    );
    expect(intoInternal.statusCode).toBe(404);
    expect(intoInternal.json()).toMatchObject({ error: { code: 'FOLDER_NOT_FOUND' } });

    // Direct access to an INTERNAL document is a 404, never a 403 that confirms it.
    for (const response of [
      await call('GET', `/v1/documents/${internalId}/download`, collaborator),
      await call('PATCH', `/v1/documents/${internalId}`, collaborator, { title: 'x' }),
      await call('DELETE', `/v1/documents/${internalId}`, collaborator),
      await call('PATCH', `/v1/folders/${folderId(ownerView, 'BILLS')}`, collaborator, {
        name: 'x',
      }),
    ]) {
      expect(response.statusCode).toBe(404);
    }

    const view = await workspace(collaborator);
    expect(JSON.stringify(view)).not.toContain('Margin on electricals');
  });

  it('does not let a collaborator rename, move, delete or manage folders', async () => {
    const view = await workspace(owner);
    const note = await call('POST', `/v1/projects/${alpha.projectId}/documents`, owner, {
      kind: 'NOTE',
      folderId: folderId(view, 'PLANS'),
      body: 'Revised kitchen plan coming',
    });
    const noteId = (note.json() as { id: string }).id;

    expect(
      (await call('PATCH', `/v1/documents/${noteId}`, collaborator, { title: 'x' })).statusCode,
    ).toBe(403);
    expect((await call('DELETE', `/v1/documents/${noteId}`, collaborator)).statusCode).toBe(403);
    expect(
      (
        await call('POST', `/v1/projects/${alpha.projectId}/folders`, collaborator, {
          name: 'Mine',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/v1/folders/${folderId(view, 'PLANS')}`, collaborator, { name: 'x' }))
        .statusCode,
    ).toBe(403);
  });
});

describe('folder management', () => {
  it('creates, renames and protects folders', async () => {
    const view = await workspace(designer);
    const created = await call('POST', `/v1/projects/${alpha.projectId}/folders`, designer, {
      name: 'Electrical',
      visibility: 'PROJECT',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Electrical', systemKey: null, position: 50 });

    const duplicate = await call('POST', `/v1/projects/${alpha.projectId}/folders`, designer, {
      name: '  electrical ',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: 'FOLDER_NAME_TAKEN' } });

    const renamed = await call('PATCH', `/v1/folders/${folderId(view, 'PLANS')}`, designer, {
      name: 'Drawings',
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'Drawings', systemKey: 'PLANS' });

    const deleteDefault = await call('DELETE', `/v1/folders/${folderId(view, 'PHOTOS')}`, designer);
    expect(deleteDefault.statusCode).toBe(409);
    expect(deleteDefault.json()).toMatchObject({ error: { code: 'FOLDER_PROTECTED' } });

    const hideWhatsApp = await call(
      'PATCH',
      `/v1/folders/${folderId(view, 'WHATSAPP')}`,
      designer,
      {
        visibility: 'INTERNAL',
      },
    );
    expect(hideWhatsApp.statusCode).toBe(409);
    const hidePhotos = await call('PATCH', `/v1/folders/${folderId(view, 'PHOTOS')}`, designer, {
      visibility: 'INTERNAL',
    });
    expect(hidePhotos.statusCode).toBe(200);

    // Renamed defaults are matched by key, never recreated beside the rename.
    const after = await workspace(owner);
    expect(after.folders.filter((f) => f.systemKey === 'PLANS')).toHaveLength(1);
    expect(after.folders).toHaveLength(6);
  });

  it('refuses to delete a folder with files, and deletes it once emptied', async () => {
    const created = await call('POST', `/v1/projects/${alpha.projectId}/folders`, owner, {
      name: 'Temporary',
    });
    const id = (created.json() as { id: string }).id;
    const note = await call('POST', `/v1/projects/${alpha.projectId}/documents`, owner, {
      kind: 'NOTE',
      folderId: id,
      body: 'short-lived',
    });
    const noteId = (note.json() as { id: string }).id;

    const blocked = await call('DELETE', `/v1/folders/${id}`, owner);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: 'FOLDER_NOT_EMPTY' } });

    expect((await call('DELETE', `/v1/documents/${noteId}`, owner)).statusCode).toBe(204);
    expect((await call('DELETE', `/v1/folders/${id}`, owner)).statusCode).toBe(204);
    const removal = await container.uow.pool.query(
      `SELECT 1 FROM audit_events WHERE aggregate_id = $1 AND event_type = 'project.document_removed.v1'`,
      [alpha.projectId],
    );
    expect(removal.rowCount).toBe(1);
  });

  it('moves a document only within its own project', async () => {
    const view = await workspace(owner);
    const other = await workspace(owner, otherProjectId);
    const note = await call('POST', `/v1/projects/${alpha.projectId}/documents`, owner, {
      kind: 'NOTE',
      folderId: folderId(view, 'PLANS'),
      body: 'Move me',
    });
    const noteId = (note.json() as { id: string }).id;

    const moved = await call('PATCH', `/v1/documents/${noteId}`, owner, {
      folderId: folderId(view, 'CONTRACTS'),
      notes: 'Belongs with the quote',
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      folderId: folderId(view, 'CONTRACTS'),
      notes: 'Belongs with the quote',
    });

    const across = await call('PATCH', `/v1/documents/${noteId}`, owner, {
      folderId: folderId(other, 'CONTRACTS'),
    });
    expect(across.statusCode).toBe(404);
  });
});

describe('files', () => {
  const csv = Buffer.from('Item,Qty,Rate\nTiles,40,85\n', 'utf8');

  it('uploads a CSV as a collaborator, files it, and downloads it as an attachment', async () => {
    const view = await workspace(collaborator);
    const fileObjectId = await uploadProjectFile(collaborator, {
      filename: 'boq.csv',
      contentType: 'text/csv',
      bytes: csv,
    });

    // Added before the scan finishes: listed, but not yet downloadable.
    const added = await call('POST', `/v1/projects/${alpha.projectId}/documents`, collaborator, {
      kind: 'FILE',
      folderId: folderId(view, 'PLANS'),
      fileObjectId,
    });
    expect(added.statusCode).toBe(201);
    const document = ProjectDocumentSchema.parse(added.json());
    expect(document).toMatchObject({
      title: 'boq.csv',
      file: { mimeType: 'text/csv', scanStatus: 'PENDING', previewable: false },
    });
    const early = await call('GET', `/v1/documents/${document.id}/download`, collaborator);
    expect(early.statusCode).toBe(409);

    await scan(fileObjectId);
    const download = await call('GET', `/v1/documents/${document.id}/download`, collaborator);
    expect(download.statusCode).toBe(200);
    const body = DocumentDownloadSchema.parse(download.json());
    expect(body.filename).toBe('boq.csv');

    const served = await app.inject({
      method: 'GET',
      url: new URL(body.downloadUrl).pathname + new URL(body.downloadUrl).search,
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-disposition']).toMatch(/^attachment;/);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-type']).toBe('application/octet-stream');
    expect(served.rawPayload.equals(csv)).toBe(true);

    const view2 = await workspace(owner);
    expect(view2.storage.usedBytes).toBe(csv.length);
  });

  it('rejects a legacy .xls in the scan with the save-as message', async () => {
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(256, 0),
    ]);
    const fileObjectId = await uploadProjectFile(owner, {
      filename: 'boq.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: ole,
    });
    await scan(fileObjectId);
    const file = await container.repos.files.requireById(alpha.owner.tenant, fileObjectId);
    expect(file.scanStatus).toBe('REJECTED');
    expect(file.scanDetail).toContain('Save it as .xlsx or .docx');

    const view = await workspace(owner);
    const added = await call('POST', `/v1/projects/${alpha.projectId}/documents`, owner, {
      kind: 'FILE',
      folderId: folderId(view, 'PLANS'),
      fileObjectId,
    });
    expect(added.statusCode).toBe(422);
  });

  it('files only a project-document upload of this project', async () => {
    const view = await workspace(owner);
    const elsewhere = await uploadProjectFile(owner, {
      filename: 'other.csv',
      contentType: 'text/csv',
      bytes: csv,
      projectId: otherProjectId,
    });
    const response = await call('POST', `/v1/projects/${alpha.projectId}/documents`, owner, {
      kind: 'FILE',
      folderId: folderId(view, 'PLANS'),
      fileObjectId: elsewhere,
    });
    expect(response.statusCode).toBe(404);
  });

  it('requires a project for project documents and keeps change attachments evidence-shaped', async () => {
    const noProject = await call('POST', '/v1/uploads', owner, {
      filename: 'plan.dwg',
      contentType: 'application/acad',
      byteSize: 1000,
      purpose: 'PROJECT_DOCUMENT',
    });
    expect(noProject.statusCode).toBe(400);

    const dwgOnRequest = await call('POST', '/v1/uploads', owner, {
      filename: 'plan.dwg',
      contentType: 'application/acad',
      byteSize: 1000,
      purpose: 'CHANGE_ATTACHMENT',
      projectId: alpha.projectId,
    });
    expect(dwgOnRequest.statusCode).toBe(415);

    const ungranted = await call('POST', '/v1/uploads', collaborator, {
      filename: 'plan.dwg',
      contentType: 'application/acad',
      byteSize: 1000,
      purpose: 'PROJECT_DOCUMENT',
      projectId: otherProjectId,
    });
    expect(ungranted.statusCode).toBe(403);
  });

  it('refuses an upload that would exceed the workspace quota', async () => {
    await container.uow.pool.query(
      `UPDATE organizations SET storage_quota_bytes = 1000 WHERE id = $1`,
      [alpha.organizationId],
    );
    const response = await call('POST', '/v1/uploads', owner, {
      filename: 'plan.pdf',
      contentType: 'application/pdf',
      byteSize: 1001,
      purpose: 'PROJECT_DOCUMENT',
      projectId: alpha.projectId,
    });
    expect(response.statusCode).toBe(507);
    expect(response.json()).toMatchObject({ error: { code: 'STORAGE_QUOTA_EXCEEDED' } });
  });
});

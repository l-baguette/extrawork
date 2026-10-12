import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import {
  CurrentUserSchema,
  InvitationCreatedSchema,
  InvitationPreviewSchema,
  JOB_KINDS,
  MembershipSchema,
  PendingInvitationListSchema,
  ProjectCollaboratorsSchema,
} from '@extrawork/contracts';
import { hashOpaqueToken, type JobRow } from '@extrawork/db';
import type { MessageGateway } from '@extrawork/integrations';
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
import type { WorkerContext } from '../../apps/worker/src/context.js';
import { sendInvitation } from '../../apps/worker/src/jobs/invitations.js';

/**
 * Collaborators and invitations over HTTP — spec 2026-10-12, D1 and D2.
 *
 * The routes that matter most here are the ones an invitee reaches before they
 * belong to the workspace: the public preview and the two accept routes. They
 * resolve the session without an organization, so these tests drive them with
 * sessions that have none, the way a contractor with no firm on ExtraWork
 * arrives.
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
  beta = await createTenant(container, { name: 'Beta Builders' });
});

async function sessionFor(userId: string, organizationId: string | null): Promise<Session> {
  const created = await container.uow.transaction((tx) =>
    container.repos.identity.createSession(tx, {
      userId,
      activeOrganizationId: organizationId,
      ttlHours: 12,
      ipHash: null,
      userAgent: 'collaboration-vitest',
    }),
  );
  return { cookie: `ew_session=${created.sessionToken}`, csrfToken: created.csrfToken };
}

let userCounter = 0;
/** A person with an account and no workspace: the contractor with no firm on ExtraWork. */
async function newUser(email?: string): Promise<{ id: string; email: string }> {
  userCounter += 1;
  const address = email ?? `contractor-${userCounter}-${randomUUID().slice(0, 6)}@example.test`;
  const user = await container.uow.transaction((tx) =>
    container.repos.identity.upsertUser(tx, {
      provider: 'local',
      subject: `local|collab-${randomUUID()}`,
      email: address,
      displayName: `Contractor ${userCounter}`,
    }),
  );
  return { id: user.id, email: address };
}

/** A staff member with a real session and, for non-org-wide roles, a stored grant. */
async function staffSession(
  tenant: TenantFixture,
  role: 'PROJECT_MANAGER' | 'VIEWER' | 'FINANCE',
  grants: string[] = [],
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

async function get(path: string, session: Session | null) {
  return app.inject({ method: 'GET', url: path, headers: headers(session, false) });
}
async function post(path: string, session: Session | null, body: unknown) {
  return app.inject({ method: 'POST', url: path, headers: headers(session, true), payload: body });
}
async function del(path: string, session: Session | null) {
  return app.inject({ method: 'DELETE', url: path, headers: headers(session, true) });
}

async function invite(
  session: Session,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ invitationId: string; token: string; inviteUrl: string }> {
  const response = await post(`/v1/projects/${projectId}/collaborators`, session, body);
  expect(response.statusCode, response.body).toBe(201);
  const parsed = InvitationCreatedSchema.parse(response.json());
  const token = parsed.inviteUrl.slice(parsed.inviteUrl.lastIndexOf('/') + 1);
  return { invitationId: parsed.invitation.id, token, inviteUrl: parsed.inviteUrl };
}

function errorCode(response: { json: () => unknown }): string | undefined {
  return (response.json() as { error?: { code?: string } }).error?.code;
}

describe('inviting a collaborator', () => {
  it('returns the link once, stores only its hash and queues a sealed email', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const response = await post(`/v1/projects/${alpha.projectId}/collaborators`, owner, {
      email: 'Ravi.Builder@Example.TEST',
      displayName: 'Ravi',
      party: 'CONSTRUCTION',
      companyName: 'Ravi Constructions',
    });
    expect(response.statusCode, response.body).toBe(201);
    const body = InvitationCreatedSchema.parse(response.json());
    expect(body.invitation).toMatchObject({
      email: 'ravi.builder@example.test',
      party: 'CONSTRUCTION',
      status: 'PENDING',
      companyName: 'Ravi Constructions',
    });
    expect(body.inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(body.whatsappShareUrl.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(body.whatsappShareUrl)).toContain(body.inviteUrl);
    expect(body.addedToSiteTeam).toBe(false);

    const token = body.inviteUrl.slice(body.inviteUrl.lastIndexOf('/') + 1);
    const stored = await container.uow.pool.query<{ token_sha256: Buffer }>(
      `SELECT token_sha256 FROM project_invitations WHERE id = $1`,
      [body.invitation.id],
    );
    expect(stored.rows[0]?.token_sha256.equals(hashOpaqueToken(token))).toBe(true);

    const jobs = await container.uow.pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM job_queue WHERE kind = $1`,
      [JOB_KINDS.SEND_INVITATION],
    );
    expect(jobs.rows).toHaveLength(1);
    const payload = jobs.rows[0]!.payload;
    expect(payload.invitationId).toBe(body.invitation.id);
    // The job carries ciphertext, never the usable link.
    expect(JSON.stringify(payload)).not.toContain(token);
    expect(typeof payload.inviteUrlCiphertext).toBe('string');
  });

  it('refreshes a live invitation instead of creating a second one', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const first = await invite(owner, alpha.projectId, {
      email: 'again@example.test',
      party: 'CONSULTANT',
    });
    const second = await invite(owner, alpha.projectId, {
      email: 'again@example.test',
      party: 'ARCHITECT',
    });
    expect(second.invitationId).toBe(first.invitationId);
    expect(second.token).not.toBe(first.token);

    // Only the newest link works.
    expect((await get(`/public/v1/invitations/${first.token}`, null)).statusCode).toBe(404);
    const preview = await get(`/public/v1/invitations/${second.token}`, null);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ party: 'ARCHITECT', status: 'PENDING' });
  });

  it('refuses to invite someone who already sees the project', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const ownerEmail = (await container.repos.identity.findUserById(alpha.ownerUserId))!
      .emailNormalized;
    const response = await post(`/v1/projects/${alpha.projectId}/collaborators`, owner, {
      email: ownerEmail,
      party: 'OTHER',
    });
    expect(response.statusCode).toBe(409);
    expect(errorCode(response)).toBe('ALREADY_COLLABORATING');
  });

  it('adds a WhatsApp number to the site team for this project only, and reuses it', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const second = await container.services.projects.createProject(alpha.owner, {
      customerId: alpha.customerId,
      title: 'Second flat',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      baseline: { subtotalMinor: 100_000, taxMinor: 18_000, totalMinor: 118_000 },
      expectedCompletionDate: '2027-03-31',
      defaultApproverContactId: alpha.approverContactId,
    });

    const response = await post(`/v1/projects/${alpha.projectId}/collaborators`, owner, {
      email: 'foreman@example.test',
      displayName: 'Suresh',
      party: 'CONSTRUCTION',
      companyName: 'Suresh & Sons',
      phone: '98765 11223',
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ addedToSiteTeam: true });

    const employees = await container.repos.employees.list(alpha.owner.tenant);
    expect(employees).toHaveLength(1);
    expect(employees[0]).toMatchObject({
      name: 'Suresh',
      phoneE164: '+919876511223',
      party: 'CONSTRUCTION',
      companyName: 'Suresh & Sons',
      teamRole: 'CONTRACTOR',
      allProjects: false,
      projectIds: [alpha.projectId],
    });

    // The same number on a second project: one roster row, two assignments.
    await invite(owner, second.id, {
      email: 'foreman@example.test',
      party: 'CONSTRUCTION',
      phone: '+91 98765 11223',
    });
    const after = await container.repos.employees.list(alpha.owner.tenant);
    expect(after).toHaveLength(1);
    expect([...after[0]!.projectIds].sort()).toEqual([alpha.projectId, second.id].sort());
  });

  it('never adds the homeowner to the site team', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const response = await post(`/v1/projects/${alpha.projectId}/collaborators`, owner, {
      email: 'home@example.test',
      party: 'HOMEOWNER',
      phone: '9876511224',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ addedToSiteTeam: false });
    expect(await container.repos.employees.list(alpha.owner.tenant)).toHaveLength(0);
  });

  it('lets a designer with a grant invite, and refuses viewers and collaborators', async () => {
    const designer = await staffSession(alpha, 'PROJECT_MANAGER', [alpha.projectId]);
    await invite(designer.session, alpha.projectId, { email: 'pm@example.test', party: 'OTHER' });

    const viewer = await staffSession(alpha, 'VIEWER', [alpha.projectId]);
    const refused = await post(`/v1/projects/${alpha.projectId}/collaborators`, viewer.session, {
      email: 'nope@example.test',
      party: 'OTHER',
    });
    expect(refused.statusCode).toBe(403);

    // A viewer still sees who is on the project, but not invitation addresses.
    const listed = await get(`/v1/projects/${alpha.projectId}/collaborators`, viewer.session);
    expect(listed.statusCode).toBe(200);
    const body = ProjectCollaboratorsSchema.parse(listed.json());
    expect(body.invitations).toEqual([]);
    expect(body.people.map((p) => p.userId)).toContain(alpha.ownerUserId);
  });

  it('keeps one tenant out of another tenant’s project people and invitations', async () => {
    const alphaOwner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const { invitationId } = await invite(alphaOwner, alpha.projectId, {
      email: 'x@example.test',
      party: 'OTHER',
    });

    const betaOwner = await sessionFor(beta.ownerUserId, beta.organizationId);
    const listed = await get(`/v1/projects/${alpha.projectId}/collaborators`, betaOwner);
    expect(listed.statusCode).toBe(404);
    const invited = await post(`/v1/projects/${alpha.projectId}/collaborators`, betaOwner, {
      email: 'y@example.test',
      party: 'OTHER',
    });
    expect(invited.statusCode).toBe(404);
    const revoked = await del(`/v1/invitations/${invitationId}`, betaOwner);
    expect(revoked.statusCode).toBe(404);

    const still = await container.repos.collaboration.findById(alpha.owner.tenant, invitationId);
    expect(still?.status).toBe('PENDING');
  });
});

describe('the invitee’s side', () => {
  it('previews publicly with a masked address and refuses a malformed token', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const { token } = await invite(owner, alpha.projectId, {
      email: 'preview.person@example.test',
      party: 'ARCHITECT',
    });

    const response = await get(`/public/v1/invitations/${token}`, null);
    expect(response.statusCode).toBe(200);
    const preview = InvitationPreviewSchema.parse(response.json());
    expect(preview).toMatchObject({
      organizationName: 'Alpha Design Studio',
      projectNumber: alpha.projectNumber,
      party: 'ARCHITECT',
      status: 'PENDING',
    });
    expect(preview.emailMasked).not.toContain('preview.person');
    expect(response.headers['x-robots-tag']).toContain('noindex');

    expect((await get('/public/v1/invitations/short', null)).statusCode).toBe(404);
  });

  it('accepts for a person with no workspace and moves their session into the host', async () => {
    const contractor = await newUser();
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const { token } = await invite(owner, alpha.projectId, {
      email: contractor.email,
      party: 'CONSTRUCTION',
      companyName: 'Kumar Builders',
    });

    const session = await sessionFor(contractor.id, null);
    // CSRF is enforced even though requireAuth is not used.
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: { cookie: session.cookie },
      payload: { token },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(errorCode(noCsrf)).toBe('CSRF_FAILED');

    const accepted = await post('/v1/invitations/accept', session, { token });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({
      organizationId: alpha.organizationId,
      projectId: alpha.projectId,
    });

    const me = CurrentUserSchema.parse((await get('/v1/auth/me', session)).json());
    expect(me.activeOrganizationId).toBe(alpha.organizationId);
    expect(me.memberships).toEqual([
      expect.objectContaining({
        organizationId: alpha.organizationId,
        role: 'COLLABORATOR',
        collaboratorParty: 'CONSTRUCTION',
      }),
    ]);

    // The owner hears about it, linked to the Team tab; the joiner does not.
    const notes = await container.uow.pool.query<{ user_id: string; link_path: string }>(
      `SELECT user_id, link_path FROM notifications WHERE kind = 'COLLABORATOR_JOINED'`,
    );
    expect(notes.rows.map((n) => n.user_id)).toEqual([alpha.ownerUserId]);
    expect(notes.rows[0]?.link_path).toBe(`/app/projects/${alpha.projectId}/team`);

    // A second click by the same person is harmless.
    const again = await post('/v1/invitations/accept', session, { token });
    expect(again.statusCode).toBe(200);

    // The owner now sees them on the project, with their party and company.
    const people = ProjectCollaboratorsSchema.parse(
      (await get(`/v1/projects/${alpha.projectId}/collaborators`, owner)).json(),
    );
    expect(people.people.find((p) => p.userId === contractor.id)).toMatchObject({
      role: 'COLLABORATOR',
      party: 'CONSTRUCTION',
      companyName: 'Kumar Builders',
      orgWide: false,
    });
    expect(people.invitations[0]).toMatchObject({ status: 'ACCEPTED' });
  });

  it('refuses a signed-in person whose address is not the invited one', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const { token } = await invite(owner, alpha.projectId, {
      email: 'intended@example.test',
      party: 'OTHER',
    });
    const stranger = await newUser();
    const response = await post('/v1/invitations/accept', await sessionFor(stranger.id, null), {
      token,
    });
    expect(response.statusCode).toBe(403);
    expect(errorCode(response)).toBe('INVITATION_EMAIL_MISMATCH');
    const memberships = await container.repos.identity.listMemberships(stranger.id);
    expect(memberships).toEqual([]);
  });

  it('reports expired and revoked invitations plainly', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const person = await newUser();
    const session = await sessionFor(person.id, null);

    const expired = await invite(owner, alpha.projectId, { email: person.email, party: 'OTHER' });
    await container.uow.pool.query(
      `UPDATE project_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [expired.invitationId],
    );
    const preview = await get(`/public/v1/invitations/${expired.token}`, null);
    expect(preview.json()).toMatchObject({ status: 'EXPIRED' });
    const late = await post('/v1/invitations/accept', session, { token: expired.token });
    expect(late.statusCode).toBe(410);
    expect(errorCode(late)).toBe('INVITATION_EXPIRED');

    // Expiry frees the slot: the designer can invite the same person again,
    // then withdraw it.
    const fresh = await invite(owner, alpha.projectId, { email: person.email, party: 'OTHER' });
    expect(fresh.invitationId).not.toBe(expired.invitationId);
    expect((await del(`/v1/invitations/${fresh.invitationId}`, owner)).statusCode).toBe(204);
    expect((await get(`/public/v1/invitations/${fresh.token}`, null)).json()).toMatchObject({
      status: 'REVOKED',
    });
    const withdrawn = await post('/v1/invitations/accept', session, { token: fresh.token });
    expect(withdrawn.statusCode).toBe(404);
    // Revoking twice finds nothing live.
    expect((await del(`/v1/invitations/${fresh.invitationId}`, owner)).statusCode).toBe(404);
  });

  it('lists pending invitations by the session’s address and accepts one in-app', async () => {
    const person = await newUser();
    const alphaOwner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const betaOwner = await sessionFor(beta.ownerUserId, beta.organizationId);
    await invite(alphaOwner, alpha.projectId, { email: person.email, party: 'CONSTRUCTION' });
    await invite(betaOwner, beta.projectId, { email: person.email, party: 'CONSTRUCTION' });
    await invite(alphaOwner, alpha.projectId, {
      email: 'someone-else@example.test',
      party: 'OTHER',
    });

    const session = await sessionFor(person.id, null);
    const listed = await get('/v1/invitations/pending', session);
    expect(listed.statusCode).toBe(200);
    const items = PendingInvitationListSchema.parse(listed.json()).items;
    expect(items.map((i) => i.organizationName).sort()).toEqual([
      'Alpha Design Studio',
      'Beta Builders',
    ]);

    // Someone else's invitation id resolves to nothing for this person.
    const others = await container.uow.pool.query<{ id: string }>(
      `SELECT id FROM project_invitations WHERE email_normalized = 'someone-else@example.test'`,
    );
    const foreign = await post('/v1/invitations/accept-pending', session, {
      invitationId: others.rows[0]!.id,
    });
    expect(foreign.statusCode).toBe(404);

    const target = items.find((i) => i.organizationName === 'Beta Builders')!;
    const accepted = await post('/v1/invitations/accept-pending', session, {
      invitationId: target.id,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({ organizationId: beta.organizationId });

    const remaining = PendingInvitationListSchema.parse(
      (await get('/v1/invitations/pending', session)).json(),
    ).items;
    expect(remaining.map((i) => i.organizationName)).toEqual(['Alpha Design Studio']);

    expect((await get('/v1/invitations/pending', null)).statusCode).toBe(401);
  });

  it('keeps an existing staff member’s role when they accept a project invitation', async () => {
    const viewer = await staffSession(alpha, 'VIEWER');
    const viewerUser = await container.repos.identity.findUserById(viewer.ctx.actor.userId!);
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const { token } = await invite(owner, alpha.projectId, {
      email: viewerUser!.emailNormalized,
      party: 'CONSULTANT',
    });
    const accepted = await post('/v1/invitations/accept', viewer.session, { token });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const membership = await container.repos.identity.getMembership(
      alpha.organizationId,
      viewer.ctx.actor.userId!,
    );
    expect(membership?.role).toBe('VIEWER');
    const project = await get(`/v1/projects/${alpha.projectId}`, viewer.session);
    expect(project.statusCode).toBe(200);
  });
});

describe('what a collaborator can see', () => {
  let collaborator: Session;
  let collaboratorId: string;
  let hiddenProjectId: string;

  beforeEach(async () => {
    const hidden = await container.services.projects.createProject(alpha.owner, {
      customerId: alpha.customerId,
      title: 'Confidential other flat',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      baseline: { subtotalMinor: 100_000, taxMinor: 18_000, totalMinor: 118_000 },
      expectedCompletionDate: '2027-03-31',
      defaultApproverContactId: alpha.approverContactId,
    });
    hiddenProjectId = hidden.id;
    await createSentChangeOrder(container, alpha, { title: 'Visible shared change' });
    await createSentChangeOrder(
      container,
      { ...alpha, projectId: hidden.id, projectNumber: hidden.projectNumber },
      { title: 'Hidden confidential change' },
    );

    const person = await newUser();
    collaboratorId = person.id;
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const { token } = await invite(owner, alpha.projectId, {
      email: person.email,
      party: 'CONSTRUCTION',
    });
    collaborator = await sessionFor(person.id, null);
    const accepted = await post('/v1/invitations/accept', collaborator, { token });
    expect(accepted.statusCode, accepted.body).toBe(200);
  });

  it('sees the granted project, its register and its requests', async () => {
    const projects = await get('/v1/projects', collaborator);
    expect(projects.statusCode).toBe(200);
    expect((projects.json() as { items: Array<{ id: string }> }).items.map((p) => p.id)).toEqual([
      alpha.projectId,
    ]);

    expect((await get(`/v1/projects/${alpha.projectId}`, collaborator)).statusCode).toBe(200);

    const register = await get(`/v1/projects/${alpha.projectId}/change-register`, collaborator);
    expect(register.statusCode).toBe(200);
    expect(register.body).toContain('Visible shared change');

    const changes = await get(`/v1/change-orders?projectId=${alpha.projectId}`, collaborator);
    expect(changes.statusCode).toBe(200);
    expect((changes.json() as { items: unknown[] }).items).toHaveLength(1);

    const all = await get('/v1/change-orders', collaborator);
    expect(all.statusCode).toBe(200);
    expect(all.body).not.toContain('Hidden confidential change');
  });

  it('cannot see another project of the same workspace', async () => {
    const response = await get(`/v1/projects/${hiddenProjectId}`, collaborator);
    expect([403, 404]).toContain(response.statusCode);
    expect(response.body).not.toContain('Confidential other flat');

    const register = await get(`/v1/projects/${hiddenProjectId}/change-register`, collaborator);
    expect([403, 404]).toContain(register.statusCode);

    const changes = await get(`/v1/change-orders?projectId=${hiddenProjectId}`, collaborator);
    expect(changes.statusCode).toBe(200);
    expect((changes.json() as { items: unknown[] }).items).toEqual([]);
  });

  it('is refused the firm’s customers, roster, reports, members and request creation', async () => {
    for (const path of [
      '/v1/customers',
      '/v1/employees',
      '/v1/reports/extra-work',
      '/v1/memberships',
    ]) {
      const response = await get(path, collaborator);
      expect(response.statusCode, path).toBe(403);
    }
    // A well-formed body, so the refusal is the authorization rule and not validation.
    const create = await post(`/v1/projects/${alpha.projectId}/change-orders`, collaborator, {
      type: 'ADDITION',
      title: 'Sneaky direct change',
      scope: 'A collaborator trying to create a request directly instead of proposing it.',
      reason: 'Not allowed',
      lineItems: [
        {
          description: 'Work item',
          quantity: '1.000',
          unit: 'lot',
          unitPriceMinor: 10_000,
          taxRateBps: 1800,
          direction: 1,
        },
      ],
      scheduleDeltaDays: 0,
      approverContactId: alpha.approverContactId,
      assuranceRequired: 'A0',
    });
    expect(create.statusCode).toBe(403);
  });

  it('cannot invite or remove people', async () => {
    const invited = await post(`/v1/projects/${alpha.projectId}/collaborators`, collaborator, {
      email: 'friend@example.test',
      party: 'OTHER',
    });
    expect(invited.statusCode).toBe(403);
    const removed = await del(
      `/v1/projects/${alpha.projectId}/collaborators/${alpha.ownerUserId}`,
      collaborator,
    );
    expect(removed.statusCode).toBe(403);
  });

  it('loses the workspace and its session with the last project removed', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const removed = await del(
      `/v1/projects/${alpha.projectId}/collaborators/${collaboratorId}`,
      owner,
    );
    expect(removed.statusCode, removed.body).toBe(204);

    const membership = await container.repos.identity.getMembership(
      alpha.organizationId,
      collaboratorId,
    );
    expect(membership?.status).toBe('REVOKED');
    const after = await get('/v1/projects', collaborator);
    expect(after.statusCode).toBe(401);

    const events = await container.uow.pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE organization_id = $1 ORDER BY occurred_at`,
      [alpha.organizationId],
    );
    const types = events.rows.map((e) => e.event_type);
    expect(types).toEqual(
      expect.arrayContaining([
        'collaborator.invited.v1',
        'collaborator.joined.v1',
        'collaborator.removed.v1',
      ]),
    );
  });

  it('keeps the membership while another project is still shared', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const person = await container.repos.identity.findUserById(collaboratorId);
    const { token } = await invite(owner, hiddenProjectId, {
      email: person!.emailNormalized,
      party: 'CONSTRUCTION',
    });
    expect((await post('/v1/invitations/accept', collaborator, { token })).statusCode).toBe(200);

    const removed = await del(
      `/v1/projects/${alpha.projectId}/collaborators/${collaboratorId}`,
      owner,
    );
    expect(removed.statusCode).toBe(204);
    const membership = await container.repos.identity.getMembership(
      alpha.organizationId,
      collaboratorId,
    );
    expect(membership?.status).toBe('ACTIVE');
    const projects = await get('/v1/projects', collaborator);
    expect((projects.json() as { items: Array<{ id: string }> }).items.map((p) => p.id)).toEqual([
      hiddenProjectId,
    ]);
  });

  it('will not remove org-wide staff from a single project', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const finance = await staffSession(alpha, 'FINANCE');
    const response = await del(
      `/v1/projects/${alpha.projectId}/collaborators/${finance.ctx.actor.userId}`,
      owner,
    );
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { message: string } }).error.message).toMatch(/role/);
  });
});

describe('the invitation email job', () => {
  function workerContext(send: MessageGateway['send'], canDeliver = true): WorkerContext {
    const email: MessageGateway = { channel: 'email', canDeliver, send, verifyAndParse: () => [] };
    return {
      env: container.env,
      db: container.uow.db,
      repos: container.repos,
      services: container.services,
      app: {
        ...container.appContext,
        integrations: { ...container.appContext.integrations, email },
      },
      logger: container.logger,
      pdf: {} as WorkerContext['pdf'],
    };
  }

  async function queuedJob(): Promise<JobRow> {
    const rows = await container.uow.pool.query<{
      id: string;
      organization_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, organization_id, payload FROM job_queue WHERE kind = $1 ORDER BY created_at DESC LIMIT 1`,
      [JOB_KINDS.SEND_INVITATION],
    );
    const row = rows.rows[0]!;
    return {
      id: row.id,
      organizationId: row.organization_id,
      kind: JOB_KINDS.SEND_INVITATION,
      payload: row.payload,
      attemptCount: 1,
      maxAttempts: 6,
      dedupeKey: null,
      createdAt: new Date(),
    };
  }

  it('emails the current link and goes quiet once it is superseded', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const first = await invite(owner, alpha.projectId, {
      email: 'mail@example.test',
      party: 'ARCHITECT',
      message: 'See you on site Monday.',
    });
    const firstJob = await queuedJob();

    const send = vi
      .fn<MessageGateway['send']>()
      .mockResolvedValue({ provider: 'test', providerMessageId: 'x', status: 'SENT' });
    await sendInvitation(firstJob, workerContext(send));
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]![0];
    expect(message.to).toMatchObject({ email: 'mail@example.test' });
    expect(message.body).toContain(first.inviteUrl);
    expect(message.body).toContain('See you on site Monday.');

    // Re-inviting mints a new link; the old job must not send the dead one.
    await invite(owner, alpha.projectId, { email: 'mail@example.test', party: 'ARCHITECT' });
    send.mockClear();
    await sendInvitation(firstJob, workerContext(send));
    expect(send).not.toHaveBeenCalled();

    // A revoked invitation is not emailed either.
    const latest = await queuedJob();
    await del(`/v1/invitations/${first.invitationId}`, owner);
    await sendInvitation(latest, workerContext(send));
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a job whose sealed link was made for another invitation', async () => {
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    await invite(owner, alpha.projectId, { email: 'a@example.test', party: 'OTHER' });
    const jobA = await queuedJob();
    const b = await invite(owner, alpha.projectId, { email: 'b@example.test', party: 'OTHER' });
    const send = vi
      .fn<MessageGateway['send']>()
      .mockResolvedValue({ provider: 'test', providerMessageId: 'x', status: 'SENT' });
    const swapped = { ...jobA, payload: { ...jobA.payload, invitationId: b.invitationId } };
    await expect(sendInvitation(swapped, workerContext(send))).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('onboarding and the member list', () => {
  it('records the business type when a firm is set up', async () => {
    const person = await newUser();
    const session = await sessionFor(person.id, null);
    const created = await post('/v1/organizations', session, {
      displayName: 'Kaveri Interiors',
      businessType: 'DESIGN_FIRM',
    });
    expect(created.statusCode, created.body).toBe(201);
    const current = await get('/v1/organizations/current', session);
    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      displayName: 'Kaveri Interiors',
      businessType: 'DESIGN_FIRM',
      requestRouting: 'DESIGNER_REVIEW',
      subscription: { planCode: 'BETA' },
    });
  });

  it('lists collaborators with their party and company for the owner', async () => {
    const person = await newUser();
    const owner = await sessionFor(alpha.ownerUserId, alpha.organizationId);
    const { token } = await invite(owner, alpha.projectId, {
      email: person.email,
      party: 'CONSULTANT',
      companyName: 'Structural Associates',
    });
    await post('/v1/invitations/accept', await sessionFor(person.id, null), { token });

    const response = await get('/v1/memberships', owner);
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: Array<Record<string, unknown>> }).items;
    expect(items.find((m) => m.userId === person.id)).toMatchObject({
      role: 'COLLABORATOR',
      collaboratorParty: 'CONSULTANT',
      companyName: 'Structural Associates',
      status: 'ACTIVE',
      projects: [
        { id: alpha.projectId, title: expect.any(String), projectNumber: alpha.projectNumber },
      ],
    });
    expect(MembershipSchema.array().safeParse(items).success).toBe(true);
    // Staff carry no project list: their role is their reach.
    expect(items.find((m) => m.userId === alpha.ownerUserId)).not.toHaveProperty('projects');
  });
});

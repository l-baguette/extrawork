import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import {
  CalendarFeedSchema,
  CalendarSchema,
  MilestoneSchema,
  type CalendarEventDto,
} from '@extrawork/contracts';
import type { Container } from '@extrawork/runtime';
import {
  addMember,
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * Milestones, the collated calendar, the private ICS feed and due reminders —
 * spec 2026-10-12, D14, over HTTP and through the worker's sweep.
 *
 * The fixture project's expected completion is 2026-12-31 (Asia/Kolkata).
 */

interface Session {
  cookie: string;
  csrfToken: string;
}

let container: Container;
let app: FastifyInstance;
let alpha: TenantFixture;
let beta: TenantFixture;
let owner: Session;
let collaborator: Session;
let collaboratorUserId: string;
let designerUserId: string;
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
      userAgent: 'timeline-vitest',
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
    expectedCompletionDate: '2026-11-20',
    defaultApproverContactId: alpha.approverContactId,
  });
  otherProjectId = second.id;
});

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
          'idempotency-key': `tl-${randomUUID()}`,
        }
      : {},
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function addMilestone(projectId: string, title: string, dueDate: string) {
  const response = await call('POST', `/v1/projects/${projectId}/milestones`, owner, {
    title,
    kind: 'SITE_VISIT',
    dueDate,
  });
  expect(response.statusCode, response.body).toBe(201);
  return MilestoneSchema.parse(response.json());
}

async function calendar(session: Session, query = 'from=2026-10-01&to=2027-01-31') {
  const response = await call('GET', `/v1/calendar?${query}`, session);
  expect(response.statusCode, response.body).toBe(200);
  return CalendarSchema.parse(response.json()).events as CalendarEventDto[];
}

describe('milestones', () => {
  it('lets designers manage milestones and everyone on the project read them', async () => {
    const created = await addMilestone(alpha.projectId, 'Electrical first fix', '2026-11-05');
    expect(created).toMatchObject({ kind: 'SITE_VISIT', completedAt: null, clientVisible: true });

    const listed = await call('GET', `/v1/projects/${alpha.projectId}/milestones`, collaborator);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({ items: [expect.anything()], canManage: false });
    expect(
      (await call('GET', `/v1/projects/${alpha.projectId}/milestones`, owner)).json(),
    ).toMatchObject({ canManage: true });

    const done = await call('PATCH', `/v1/milestones/${created.id}`, owner, { completed: true });
    expect(done.statusCode).toBe(200);
    expect(MilestoneSchema.parse(done.json()).completedAt).not.toBeNull();
    const reopened = await call('PATCH', `/v1/milestones/${created.id}`, owner, {
      completed: false,
      dueDate: '2026-11-07',
    });
    expect(reopened.json()).toMatchObject({ completedAt: null, dueDate: '2026-11-07' });

    expect((await call('DELETE', `/v1/milestones/${created.id}`, owner)).statusCode).toBe(204);
    const after = await call('GET', `/v1/projects/${alpha.projectId}/milestones`, owner);
    expect((after.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('does not let a collaborator add, edit or delete milestones', async () => {
    const milestone = await addMilestone(alpha.projectId, 'Tiling', '2026-11-10');
    const create = await call('POST', `/v1/projects/${alpha.projectId}/milestones`, collaborator, {
      title: 'Mine',
      dueDate: '2026-11-11',
    });
    expect(create.statusCode).toBe(403);
    expect(
      (await call('PATCH', `/v1/milestones/${milestone.id}`, collaborator, { completed: true }))
        .statusCode,
    ).toBe(403);
    expect((await call('DELETE', `/v1/milestones/${milestone.id}`, collaborator)).statusCode).toBe(
      403,
    );
  });

  it('hides milestones of ungranted projects and other workspaces', async () => {
    const elsewhere = await addMilestone(otherProjectId, 'Not yours', '2026-11-12');
    expect(
      (await call('GET', `/v1/projects/${otherProjectId}/milestones`, collaborator)).statusCode,
    ).toBe(403);
    // A milestone the actor cannot reach is a 404, never a 403 that confirms it.
    expect(
      (await call('PATCH', `/v1/milestones/${elsewhere.id}`, collaborator, { title: 'x' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/v1/projects/${alpha.projectId}/milestones`, betaOwner)).statusCode,
    ).toBe(404);
    expect(
      (await call('PATCH', `/v1/milestones/${elsewhere.id}`, betaOwner, { title: 'x' })).statusCode,
    ).toBe(404);
  });
});

describe('calendar', () => {
  it('collates dates across the projects the actor can see, with stable ids', async () => {
    const milestone = await addMilestone(alpha.projectId, 'Kitchen install', '2026-12-01');
    await addMilestone(otherProjectId, 'Second villa handover prep', '2026-11-15');

    const ownerEvents = await calendar(owner);
    expect(ownerEvents.map((e) => e.id)).toEqual(
      expect.arrayContaining([
        `milestone:${milestone.id}`,
        `project-completion:${alpha.projectId}`,
        `project-completion:${otherProjectId}`,
      ]),
    );
    // Sorted by date.
    const dates = ownerEvents.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
    // Asking twice gives the same ids.
    expect((await calendar(owner)).map((e) => e.id)).toEqual(ownerEvents.map((e) => e.id));

    const collaboratorEvents = await calendar(collaborator);
    expect(collaboratorEvents.every((e) => e.projectId === alpha.projectId)).toBe(true);
    expect(collaboratorEvents.map((e) => e.id)).toContain(`milestone:${milestone.id}`);

    const filtered = await calendar(
      owner,
      `from=2026-10-01&to=2027-01-31&projectId=${otherProjectId}`,
    );
    expect(filtered.every((e) => e.projectId === otherProjectId)).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);

    const ungranted = await call(
      'GET',
      `/v1/calendar?from=2026-10-01&to=2027-01-31&projectId=${otherProjectId}`,
      collaborator,
    );
    expect(ungranted.statusCode).toBe(403);

    expect(await calendar(betaOwner)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ projectId: alpha.projectId })]),
    );
  });

  it('refuses a window longer than 400 days or reversed', async () => {
    expect(
      (await call('GET', '/v1/calendar?from=2026-01-01&to=2027-06-01', owner)).statusCode,
    ).toBe(400);
    expect(
      (await call('GET', '/v1/calendar?from=2026-02-01&to=2026-01-01', owner)).statusCode,
    ).toBe(400);
  });
});

describe('private calendar feed', () => {
  async function createFeed(session: Session): Promise<string> {
    const response = await call('POST', '/v1/calendar/feed', session);
    expect(response.statusCode, response.body).toBe(201);
    const feed = CalendarFeedSchema.parse(response.json());
    expect(feed.active).toBe(true);
    return new URL(feed.feedUrl!).pathname;
  }

  it('serves an ICS feed for the current grants, with and without .ics', async () => {
    const milestone = await addMilestone(alpha.projectId, 'Painting; final coat', '2026-12-10');
    const path = await createFeed(collaborator);
    expect(path).toMatch(/^\/public\/v1\/calendar\/[A-Za-z0-9_-]+\.ics$/);

    const state = await call('GET', '/v1/calendar/feed', collaborator);
    expect(state.json()).toMatchObject({ active: true, feedUrl: null });

    const served = await app.inject({ method: 'GET', url: path });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(served.headers['cache-control']).toBe('private, max-age=300');
    expect(served.body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(served.body).toContain(`UID:milestone:${milestone.id}@extrawork`);
    expect(served.body).toContain('Painting\\; final coat');
    expect(served.body).toContain('DTSTART;VALUE=DATE:20261210');
    // The other project is not granted to this collaborator.
    expect(served.body).not.toContain(otherProjectId);

    const bare = await app.inject({ method: 'GET', url: path.replace(/\.ics$/, '') });
    expect(bare.statusCode).toBe(200);
  });

  it('stops serving a rotated, revoked or orphaned feed', async () => {
    const first = await createFeed(owner);
    const second = await createFeed(owner);
    expect((await app.inject({ method: 'GET', url: first })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: second })).statusCode).toBe(200);

    expect((await call('DELETE', '/v1/calendar/feed', owner)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: second })).statusCode).toBe(404);
    expect((await call('GET', '/v1/calendar/feed', owner)).json()).toMatchObject({
      active: false,
    });

    // A removed member's calendar app gets nothing on its next refresh.
    const collaboratorFeed = await createFeed(collaborator);
    await container.uow.pool.query(
      `UPDATE memberships SET status = 'REVOKED' WHERE organization_id = $1 AND user_id = $2`,
      [alpha.organizationId, collaboratorUserId],
    );
    expect((await app.inject({ method: 'GET', url: collaboratorFeed })).statusCode).toBe(404);

    expect(
      (await app.inject({ method: 'GET', url: '/public/v1/calendar/not-a-token.ics' })).statusCode,
    ).toBe(404);
  });
});

describe('due reminders', () => {
  async function dueNotifications(userId: string) {
    const result = await container.uow.pool.query<{ kind: string; dedupe_key: string }>(
      `SELECT kind, dedupe_key FROM notifications
       WHERE user_id = $1 AND kind IN ('MILESTONE_DUE', 'COMPLETION_DUE')
       ORDER BY dedupe_key`,
      [userId],
    );
    return result.rows;
  }

  // 09:30 IST on 29 December: the project completes in two days.
  const now = new Date('2026-12-29T04:00:00Z');

  // The other workspace's fixture project also completes on the 31st; move it
  // out of the window so the counts below are this workspace's alone.
  beforeEach(async () => {
    await container.uow.pool.query(
      `UPDATE projects SET expected_completion_date = '2027-06-30' WHERE id = $1`,
      [beta.projectId],
    );
  });

  it('reminds each person once per item and date, honouring their preferences', async () => {
    const milestone = await addMilestone(alpha.projectId, 'Snag walk', '2026-12-30');
    // The designer only wants reminders on the day; the collaborator wants none.
    await container.uow.pool.query(
      `INSERT INTO notification_preferences (organization_id, user_id, reminder_lead_days)
       VALUES ($1, $2, 0)`,
      [alpha.organizationId, designerUserId],
    );
    await container.uow.pool.query(
      `INSERT INTO notification_preferences (organization_id, user_id, completion_reminders)
       VALUES ($1, $2, false)`,
      [alpha.organizationId, collaboratorUserId],
    );

    const first = await container.services.timeline.sendDueReminders(now);
    expect(first).toBe(2);
    expect(await dueNotifications(alpha.ownerUserId)).toEqual([
      { kind: 'COMPLETION_DUE', dedupe_key: `due:completion:${alpha.projectId}:2026-12-31` },
      { kind: 'MILESTONE_DUE', dedupe_key: `due:milestone:${milestone.id}:2026-12-30` },
    ]);
    expect(await dueNotifications(designerUserId)).toEqual([]);
    expect(await dueNotifications(collaboratorUserId)).toEqual([]);

    // A second sweep the same day — a retry, another replica — writes nothing.
    expect(await container.services.timeline.sendDueReminders(now)).toBe(0);
    expect(await dueNotifications(alpha.ownerUserId)).toHaveLength(2);
    const emailJobs = await container.uow.pool.query(
      `SELECT 1 FROM job_queue WHERE kind = 'send_notification_email' AND organization_id = $1`,
      [alpha.organizationId],
    );
    expect(emailJobs.rowCount).toBe(2);

    // On the day itself, the designer's zero-day lead now applies; the owner
    // already has this milestone's reminder for this date.
    const onTheDay = new Date('2026-12-30T04:00:00Z');
    expect(await container.services.timeline.sendDueReminders(onTheDay)).toBe(1);
    expect(await dueNotifications(designerUserId)).toEqual([
      { kind: 'MILESTONE_DUE', dedupe_key: `due:milestone:${milestone.id}:2026-12-30` },
    ]);

    // Moving the date is a new reminder; completing it stops them.
    await call('PATCH', `/v1/milestones/${milestone.id}`, owner, { dueDate: '2026-12-31' });
    expect(await container.services.timeline.sendDueReminders(onTheDay)).toBe(1);
    await call('PATCH', `/v1/milestones/${milestone.id}`, owner, { completed: true });
    const later = new Date('2026-12-31T04:00:00Z');
    const afterCompletion = await container.services.timeline.sendDueReminders(later);
    // Only the designer's completion-day reminder is new; the milestone is done.
    expect(afterCompletion).toBe(1);
    expect(await dueNotifications(designerUserId)).toContainEqual({
      kind: 'COMPLETION_DUE',
      dedupe_key: `due:completion:${alpha.projectId}:2026-12-31`,
    });
  });

  it('does not remind about a closed project', async () => {
    await container.uow.pool.query(`UPDATE projects SET status = 'CLOSED' WHERE id = $1`, [
      alpha.projectId,
    ]);
    await container.uow.pool.query(`UPDATE projects SET status = 'CLOSED' WHERE id = $1`, [
      otherProjectId,
    ]);
    expect(await container.services.timeline.sendDueReminders(now)).toBe(0);
  });
});

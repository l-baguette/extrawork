import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import {
  CustomerSummarySchema,
  EmployeeSchema,
  InboundMessageSchema,
  RequestTemplateSchema,
} from '@extrawork/contracts';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * The HTTP seam: what the API actually puts on the wire.
 *
 * Every other suite stops at the service layer, which is why two real bugs
 * shipped past 316 passing tests — a page that read `customer.contacts` from a
 * list endpoint that never sends contacts, and a mutation that never sent the
 * CSRF header the API requires. Neither is visible from below the route.
 *
 * So these assert responses against the published Zod contracts rather than
 * against hand-written expectations. A response that stops matching its schema
 * fails here, which is exactly the drift the web app trips over.
 */

let container: Container;
let app: FastifyInstance;
let alpha: TenantFixture;
let beta: TenantFixture;

/** Cookie + CSRF pair for a signed-in owner, as the browser would hold them. */
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
  alpha = await createTenant(container, { name: 'Alpha Interiors' });
  beta = await createTenant(container, { name: 'Beta Builders' });
});

async function signIn(tenant: TenantFixture): Promise<Session> {
  const session = await container.uow.transaction((tx) =>
    container.repos.identity.createSession(tx, {
      userId: tenant.ownerUserId,
      activeOrganizationId: tenant.organizationId,
      ttlHours: 12,
      ipHash: null,
      userAgent: 'vitest',
    }),
  );
  return { cookie: `ew_session=${session.sessionToken}`, csrfToken: session.csrfToken };
}

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `98${String(76500000 + phoneCounter).slice(0, 8)}`;
}

async function post(path: string, session: Session, body: unknown) {
  return app.inject({
    method: 'POST',
    url: path,
    headers: {
      cookie: session.cookie,
      'x-csrf-token': session.csrfToken,
      'idempotency-key': `test-${Math.random().toString(36).slice(2)}-key`,
    },
    payload: body,
  });
}

describe('employee routes', () => {
  it('creates an employee and returns a body matching EmployeeSchema', async () => {
    const session = await signIn(alpha);
    const response = await post('/v1/employees', session, {
      name: 'Ramesh Patil',
      phone: nextPhone(),
      allProjects: true,
      projectIds: [],
      maxRequestMinor: 2_000_000,
    });

    expect(response.statusCode).toBe(201);
    // The contract is the assertion. A field the route forgets, renames or
    // sends with the wrong type fails here rather than in the browser.
    const parsed = EmployeeSchema.safeParse(response.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it('normalises a phone number typed the way an owner types it', async () => {
    const session = await signIn(alpha);
    const response = await post('/v1/employees', session, {
      name: 'Suresh Kadam',
      phone: '98765 43210',
      allProjects: true,
      projectIds: [],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      phoneE164: '+919876543210',
      phoneMasked: '+91******3210',
    });
  });

  it('lists employees in a body matching the schema', async () => {
    const session = await signIn(alpha);
    await post('/v1/employees', session, {
      name: 'Ramesh Patil',
      phone: nextPhone(),
      allProjects: true,
      projectIds: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/employees',
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: unknown[] }).items;
    expect(items).toHaveLength(1);
    expect(EmployeeSchema.safeParse(items[0]).success).toBe(true);
  });

  it('rejects a number already registered anywhere', async () => {
    const session = await signIn(alpha);
    const phone = nextPhone();
    await post('/v1/employees', session, {
      name: 'First',
      phone,
      allProjects: true,
      projectIds: [],
    });

    const betaSession = await signIn(beta);
    const response = await post('/v1/employees', betaSession, {
      name: 'Second',
      phone,
      allProjects: true,
      projectIds: [],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'EMPLOYEE_PHONE_TAKEN' } });
  });

  it('does not expose another tenant’s employee over HTTP', async () => {
    const session = await signIn(alpha);
    const created = await post('/v1/employees', session, {
      name: 'Ramesh Patil',
      phone: nextPhone(),
      allProjects: true,
      projectIds: [],
    });
    const employeeId = (created.json() as { id: string }).id;

    const betaSession = await signIn(beta);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/employees/${employeeId}`,
      headers: { cookie: betaSession.cookie },
    });

    // NOT_FOUND rather than FORBIDDEN: a 403 would confirm the id exists.
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'EMPLOYEE_NOT_FOUND' } });
  });
});

/**
 * The CSRF contract, from the browser's side.
 *
 * The API requires `x-csrf-token` on every cookie-authenticated mutation, and
 * for months nothing in the authenticated web app sent it — every create and
 * edit failed with a message that reads like a session problem. These pin both
 * halves so the pairing cannot silently come apart again.
 */
describe('CSRF on authenticated mutations', () => {
  it('refuses a mutation with no CSRF header', async () => {
    const session = await signIn(alpha);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: { cookie: session.cookie, 'idempotency-key': 'no-csrf-key-1' },
      payload: { name: 'Nobody', phone: nextPhone(), allProjects: true, projectIds: [] },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'CSRF_FAILED' } });
  });

  it('refuses a mutation whose CSRF header belongs to another session', async () => {
    const session = await signIn(alpha);
    const other = await signIn(beta);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: {
        cookie: session.cookie,
        'x-csrf-token': other.csrfToken,
        'idempotency-key': 'wrong-csrf-key-1',
      },
      payload: { name: 'Nobody', phone: nextPhone(), allProjects: true, projectIds: [] },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'CSRF_FAILED' } });
  });

  it('does not require CSRF on a read', async () => {
    const session = await signIn(alpha);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/employees',
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('request template routes', () => {
  it('returns a template matching RequestTemplateSchema', async () => {
    const session = await signIn(alpha);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/settings/request-template',
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    const parsed = RequestTemplateSchema.safeParse(response.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it('bumps the version on edit', async () => {
    const session = await signIn(alpha);
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/settings/request-template',
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrfToken },
      payload: { heading: 'Extra work approval' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ heading: 'Extra work approval', templateVersion: 2 });
  });
});

describe('request log routes', () => {
  it('returns an empty page in the documented shape', async () => {
    const session = await signIn(alpha);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/requests?limit=20',
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
  });

  it('returns rows matching InboundMessageSchema, with the phone masked', async () => {
    const session = await signIn(alpha);
    const created = await post('/v1/employees', session, {
      name: 'Ramesh Patil',
      phone: nextPhone(),
      allProjects: true,
      projectIds: [],
    });
    const employeeId = (created.json() as { id: string }).id;

    const { row } = await container.uow.transaction((tx) =>
      container.repos.inboundMessages.record(tx, {
        providerMessageId: `wamid.api.${Math.random().toString(36).slice(2)}`,
        fromPhoneE164: '+919876543210',
        body: 'Project: Tower 4\nWhat: Two power points\nCost: 15800',
      }),
    );
    await container.uow.transaction((tx) =>
      container.repos.inboundMessages.markProcessed(tx, row.id, {
        status: 'ACCEPTED',
        organizationId: alpha.organizationId,
        employeeId,
        projectId: alpha.projectId,
        replyText: 'Sent to the customer for approval.',
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/v1/requests?limit=20',
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: unknown[] }).items;
    expect(items).toHaveLength(1);

    const parsed = InboundMessageSchema.safeParse(items[0]);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(items[0]).toMatchObject({
      status: 'ACCEPTED',
      employeeName: 'Ramesh Patil',
      fromPhoneMasked: '+91******3210',
      replyText: 'Sent to the customer for approval.',
    });
    // The full number is a contact detail, not something the log hands out.
    expect(JSON.stringify(items[0])).not.toContain('+919876543210');
  });
});

/**
 * Regression for the customer directory crash: the list endpoint returns a
 * summary with one approver, never the full `contacts` array. A page that types
 * the response as a whole customer crashes on `contacts.find`.
 */
describe('customer list shape', () => {
  it('matches CustomerSummarySchema and carries the approver', async () => {
    const session = await signIn(alpha);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/customers?limit=100',
      headers: { cookie: session.cookie },
    });

    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: unknown[] }).items;
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      const parsed = CustomerSummarySchema.safeParse(item);
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
      // The directory needs a name to show; the fixture records an approver.
      expect((item as { approver: unknown }).approver).not.toBeNull();
      // And it must NOT pretend to be the full customer resource.
      expect(item).not.toHaveProperty('contacts');
    }
  });
});

/** Regression for the owner-facing new-project form's new-customer branch. */
describe('new customer and project flow', () => {
  it('accepts a human-formatted Indian phone and returns the approver needed by the project', async () => {
    const session = await signIn(alpha);
    const customerResponse = await post('/v1/customers', session, {
      displayName: 'Sharma Residence',
      contacts: [
        {
          name: 'Neha Sharma',
          phoneE164: '98765 43210',
          isDefaultApprover: true,
        },
      ],
    });

    expect(customerResponse.statusCode).toBe(201);
    const customer = customerResponse.json() as {
      id: string;
      defaultApproverContactId: string | null;
    };
    expect(customer.defaultApproverContactId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/v1/customers/${customer.id}`,
      headers: { cookie: session.cookie },
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      contacts: [{ id: customer.defaultApproverContactId, phoneE164: '+919876543210' }],
    });

    const projectResponse = await post('/v1/projects', session, {
      customerId: customer.id,
      title: 'Sharma Residence Fit-out',
      siteAddress: { city: 'Mumbai', country: 'IN' },
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      baseline: { subtotalMinor: 1_000_000, taxMinor: 180_000, totalMinor: 1_180_000 },
      expectedCompletionDate: '2026-12-31',
      defaultApproverContactId: customer.defaultApproverContactId,
    });

    expect(projectResponse.statusCode).toBe(201);
    expect(projectResponse.json()).toMatchObject({ revisedTotalMinor: 1_180_000 });
  });
});

describe('API discovery', () => {
  it('explains the API root instead of returning a misleading not-found error', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'extrawork-api',
      message: expect.stringContaining('API is running'),
    });
  });
});

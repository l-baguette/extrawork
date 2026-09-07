import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import { ACCOUNT_DELETION_GRACE_DAYS, OrganizationSchema } from '@extrawork/contracts';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * Self-serve account closure (report §9.8).
 *
 * The properties worth pinning are the ones a person's data protection rights
 * turn on: that closing is reversible for the whole grace window, that it
 * downgrades the account to read-only rather than hiding it, and that it cannot
 * be triggered by anyone but the owner or by a mis-click.
 */

let container: Container;
let app: FastifyInstance;
let alpha: TenantFixture;

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
});

async function signIn(tenant: TenantFixture, userId?: string): Promise<Session> {
  const session = await container.uow.transaction((tx) =>
    container.repos.identity.createSession(tx, {
      userId: userId ?? tenant.ownerUserId,
      activeOrganizationId: tenant.organizationId,
      ttlHours: 12,
      ipHash: null,
      userAgent: 'vitest',
    }),
  );
  return { cookie: `ew_session=${session.sessionToken}`, csrfToken: session.csrfToken };
}

function request(
  method: 'POST' | 'DELETE' | 'GET',
  path: string,
  session: Session,
  body?: unknown,
) {
  return app.inject({
    method,
    url: path,
    headers: {
      cookie: session.cookie,
      'x-csrf-token': session.csrfToken,
      'idempotency-key': `test-${Math.random().toString(36).slice(2)}-key`,
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}

describe('account closure', () => {
  it('closes on a matching confirmation and arms the purge for the grace window', async () => {
    const session = await signIn(alpha);

    const before = Date.now();
    const response = await request('POST', '/v1/organizations/closure', session, {
      confirmName: 'Alpha Interiors',
      reason: 'Finished the project.',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('CLOSED');
    expect(body.graceDays).toBe(ACCOUNT_DELETION_GRACE_DAYS);

    // The promise the privacy policy makes is a date, so assert the date.
    const graceMs = ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;
    const purgeAfter = new Date(body.purgeAfter).getTime();
    expect(purgeAfter).toBeGreaterThanOrEqual(before + graceMs - 5_000);
    expect(purgeAfter).toBeLessThanOrEqual(Date.now() + graceMs + 5_000);
  });

  it('refuses a confirmation that does not match the business name', async () => {
    const session = await signIn(alpha);
    const response = await request('POST', '/v1/organizations/closure', session, {
      confirmName: 'alpha interiorz',
    });

    expect(response.statusCode).toBe(400);
    const organization = await container.repos.organizations.findById({
      organizationId: alpha.organizationId,
      userId: alpha.ownerUserId,
      role: 'OWNER',
      requestId: 'test',
    });
    expect(organization?.status).toBe('ACTIVE');
  });

  it('keeps a closed account readable and exportable but refuses new writes', async () => {
    const session = await signIn(alpha);
    await request('POST', '/v1/organizations/closure', session, { confirmName: 'Alpha Interiors' });

    // Reads continue: the runbook requires an export to stay available right up
    // to the purge, and withholding it would be its own compliance failure.
    const read = await request('GET', '/v1/organizations/current', session);
    expect(read.statusCode).toBe(200);
    const organization = OrganizationSchema.parse(read.json());
    expect(organization.status).toBe('CLOSED');
    expect(organization.closedAt).not.toBeNull();
    expect(organization.purgeAfter).not.toBeNull();

    // Writes stop.
    const write = await request('POST', '/v1/customers', session, {
      displayName: 'Someone New',
      contacts: [],
    });
    expect(write.statusCode).toBe(402);
  });

  it('reopens a closed account and clears the purge date', async () => {
    const session = await signIn(alpha);
    await request('POST', '/v1/organizations/closure', session, { confirmName: 'Alpha Interiors' });

    const reopen = await request('DELETE', '/v1/organizations/closure', session);
    expect(reopen.statusCode).toBe(204);

    const read = await request('GET', '/v1/organizations/current', session);
    const organization = OrganizationSchema.parse(read.json());
    expect(organization.status).toBe('ACTIVE');
    expect(organization.closedAt).toBeNull();
    expect(organization.purgeAfter).toBeNull();

    // And writing works again, which is the point of a recovery window.
    const write = await request('POST', '/v1/customers', session, {
      displayName: 'Someone New',
      contacts: [],
    });
    expect(write.statusCode).toBe(201);
  });

  it('records the request and the cancellation in the audit trail', async () => {
    const session = await signIn(alpha);
    await request('POST', '/v1/organizations/closure', session, { confirmName: 'Alpha Interiors' });
    await request('DELETE', '/v1/organizations/closure', session);

    // Read straight from the table: the audit writer is append-only and
    // deliberately exposes no read path to application code.
    const { rows } = await container.uow.pool.query<{ event_type: string }>(
      'SELECT event_type FROM audit_events WHERE aggregate_id = $1',
      [alpha.organizationId],
    );
    const types = rows.map((row) => row.event_type);
    expect(types).toContain('organization.closure_requested.v1');
    expect(types).toContain('organization.closure_cancelled.v1');
  });

  it('does not let a non-owner close the account', async () => {
    const adminUserId = await container.uow.transaction(async (tx) => {
      const user = await container.repos.identity.upsertUser(tx, {
        provider: 'local',
        subject: 'local:closure-admin',
        email: 'admin@alpha.example',
        displayName: 'Alpha Admin',
      });
      await container.repos.organizations.addMembership(tx, {
        organizationId: alpha.organizationId,
        userId: user.id,
        role: 'ADMIN',
      });
      return user.id;
    });

    const session = await signIn(alpha, adminUserId);
    const response = await request('POST', '/v1/organizations/closure', session, {
      confirmName: 'Alpha Interiors',
    });

    expect(response.statusCode).toBe(403);
  });
});

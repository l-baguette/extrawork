import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  publicContext,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * The WhatsApp intake path, end to end against real PostgreSQL.
 *
 * The rules being pinned here are the ones that make the channel safe to hand
 * to a person standing on a building site: it never guesses a price, never
 * guesses a project, never exceeds the ceiling the owner set, and never lets a
 * redelivered message bill a customer twice. Each one is a decision that would
 * otherwise be re-litigated by whoever touches this next.
 */

let container: Container;
let alpha: TenantFixture;
let beta: TenantFixture;

beforeAll(() => {
  container = createTestContainer({ env: { WHATSAPP_DRIVER: 'simulator' } });
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  alpha = await createTenant(container, { name: 'Alpha Interiors' });
  beta = await createTenant(container, { name: 'Beta Builders' });
});

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+9198${String(11_000_000 + phoneCounter).slice(0, 8)}`;
}

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `wamid.intake.${messageCounter}.${Math.random().toString(36).slice(2, 8)}`;
}

async function addEmployee(
  tenant: TenantFixture,
  overrides: Partial<{
    phoneE164: string;
    maxRequestMinor: bigint | null;
    allProjects: boolean;
  }> = {},
) {
  return container.uow.transaction((tx) =>
    container.repos.employees.create(tx, tenant.owner.tenant, {
      name: 'Ramesh Patil',
      phoneE164: overrides.phoneE164 ?? nextPhone(),
      roleNote: null,
      allProjects: overrides.allProjects ?? true,
      maxRequestMinor: overrides.maxRequestMinor ?? null,
      projectIds: [],
    }),
  );
}

function send(fromPhoneE164: string, body: string, providerMessageId?: string) {
  return container.services.intake.handleInbound({
    providerMessageId: providerMessageId ?? nextMessageId(),
    fromPhoneE164,
    body,
  });
}

const GOOD_MESSAGE = [
  'What: Two extra power points in the kitchen',
  'Why: Client changed the appliance layout',
  'Cost: 15800',
  'Days: 2',
].join('\n');

describe('a registered employee raises a request', () => {
  it('creates a sent change order and returns the customer link', async () => {
    const employee = await addEmployee(alpha);
    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);

    expect(outcome.status).toBe('ACCEPTED');
    expect(outcome.changeOrderId).not.toBeNull();
    expect(outcome.approvalUrl).toMatch(/\/r\/[A-Za-z0-9_-]+$/);
    expect(outcome.reply).toContain('Sent to');
    // The employee must not start work on the strength of having sent a message.
    expect(outcome.reply).toContain('Do not start this work');
  });

  it('prices it through the money engine, exactly', async () => {
    const employee = await addEmployee(alpha);
    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);

    const version = await container.repos.changeOrders.getCurrentVersion(
      alpha.owner.tenant,
      outcome.changeOrderId as string,
    );
    expect(version?.totalDeltaMinor).toBe(1_580_000n);
    expect(version?.scheduleDeltaDays).toBe(2);
    expect(version?.status).toBe('SENT');
  });

  it('records the origin and the person who raised it', async () => {
    const employee = await addEmployee(alpha);
    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);

    const { rows } = await container.uow.pool.query<{
      origin: string;
      raised_by_employee_id: string;
      created_by_user_id: string | null;
    }>(
      `SELECT v.origin, v.raised_by_employee_id, co.created_by_user_id
         FROM change_order_versions v
         JOIN change_orders co ON co.id = v.change_order_id
        WHERE v.change_order_id = $1`,
      [outcome.changeOrderId],
    );

    expect(rows[0]?.origin).toBe('WHATSAPP');
    expect(rows[0]?.raised_by_employee_id).toBe(employee.id);
    // Nobody signed in, so no user is named. The employee id above is the
    // honest record of who raised it.
    expect(rows[0]?.created_by_user_id).toBeNull();
  });

  it('logs the message, the parse and the reply', async () => {
    const employee = await addEmployee(alpha);
    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);

    const logged = await container.repos.inboundMessages.requireById(
      alpha.owner.tenant,
      outcome.inboundMessageId,
    );
    expect(logged.status).toBe('ACCEPTED');
    expect(logged.employeeId).toBe(employee.id);
    expect(logged.changeOrderId).toBe(outcome.changeOrderId);
    expect(logged.replyText).toBe(outcome.reply);
    expect(logged.parsed).toMatchObject({ amountMinor: '1580000', days: 2 });
  });
});

describe('the channel refuses to guess', () => {
  it('asks rather than picking a number from a range', async () => {
    const employee = await addEmployee(alpha);
    const outcome = await send(
      employee.phoneE164,
      'What: Two extra power points in the kitchen\nCost: 15-20k',
    );

    expect(outcome.status).toBe('REJECTED_UNPARSEABLE');
    expect(outcome.reply).toContain('15-20k');
    expect(outcome.changeOrderId).toBeNull();
  });

  it('asks which project when the name matches more than one', async () => {
    const employee = await addEmployee(alpha);
    // A second active project makes the bare message ambiguous.
    await container.uow.transaction((tx) =>
      container.repos.projects.create(tx, alpha.owner.tenant, {
        customerId: alpha.customerId,
        projectNumber: 'P-OTHER',
        title: 'Second site fit-out',
        siteAddress: null,
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        baselineSubtotalMinor: 1_000_000n,
        baselineTaxMinor: 0n,
        baselineTotalMinor: 1_000_000n,
        startDate: null,
        expectedCompletionDate: null,
        defaultApproverContactId: alpha.approverContactId,
        baselineDocumentFileId: null,
      }),
    );

    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);
    expect(outcome.status).toBe('REJECTED_NOT_AUTHORIZED');
    expect(outcome.changeOrderId).toBeNull();
  });
});

describe('policy the owner set', () => {
  it('refuses a request above the employee’s ceiling and says the real numbers', async () => {
    const employee = await addEmployee(alpha, { maxRequestMinor: 1_000_000n });
    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);

    expect(outcome.status).toBe('REJECTED_POLICY');
    expect(outcome.reply).toContain('₹15,800.00');
    expect(outcome.reply).toContain('₹10,000.00');
    expect(outcome.changeOrderId).toBeNull();
  });

  it('accepts a request exactly at the ceiling', async () => {
    const employee = await addEmployee(alpha, { maxRequestMinor: 1_580_000n });
    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);
    expect(outcome.status).toBe('ACCEPTED');
  });
});

describe('senders the system does not know', () => {
  it('rejects an unregistered number without naming any organization', async () => {
    const outcome = await send(nextPhone(), GOOD_MESSAGE);

    expect(outcome.status).toBe('REJECTED_UNKNOWN_SENDER');
    expect(outcome.changeOrderId).toBeNull();
    expect(outcome.reply).not.toContain('Alpha Interiors');
    expect(outcome.reply).not.toContain('Beta Builders');
  });

  it('still records the attempt, unattributed to any tenant', async () => {
    const phone = nextPhone();
    const outcome = await send(phone, GOOD_MESSAGE);

    // Invisible to every tenant, because it belongs to none of them.
    expect(
      await container.repos.inboundMessages.findById(alpha.owner.tenant, outcome.inboundMessageId),
    ).toBeNull();
    expect(
      await container.repos.inboundMessages.findById(beta.owner.tenant, outcome.inboundMessageId),
    ).toBeNull();

    // But an operator can still see that someone texted in.
    const unattributed = await container.repos.inboundMessages.listUnattributed();
    expect(unattributed.map((m) => m.id)).toContain(outcome.inboundMessageId);
  });

  it('rejects a suspended employee', async () => {
    const employee = await addEmployee(alpha);
    await container.uow.transaction((tx) =>
      container.repos.employees.update(tx, alpha.owner.tenant, employee.id, {
        status: 'SUSPENDED',
      }),
    );

    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);
    expect(outcome.status).toBe('REJECTED_UNKNOWN_SENDER');
  });
});

describe('redelivery', () => {
  it('does not create a second request for the same provider message', async () => {
    const employee = await addEmployee(alpha);
    const id = nextMessageId();

    const first = await send(employee.phoneE164, GOOD_MESSAGE, id);
    const second = await send(employee.phoneE164, GOOD_MESSAGE, id);

    expect(first.status).toBe('ACCEPTED');
    expect(second.duplicate).toBe(true);
    expect(second.changeOrderId).toBe(first.changeOrderId);

    const { rows } = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM change_orders WHERE organization_id = $1',
      [alpha.organizationId],
    );
    expect(rows[0]?.count).toBe('1');
  });
});

/**
 * The loop back to the contractor's own people.
 *
 * The reply an employee gets when they raise a request says "I will message you
 * the moment they respond". Nothing enforced that promise until the decision
 * enqueued this job, so these pin the queueing — the delivery itself is the
 * worker's, and covered by its own gateway.
 */
describe('a decision notifies the team', () => {
  async function raiseAndDecide(type: 'APPROVE' | 'DECLINE') {
    const employee = await addEmployee(alpha);
    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);
    expect(outcome.status).toBe('ACCEPTED');

    const token = (outcome.approvalUrl as string).split('/r/')[1] as string;
    const ctx = publicContext();
    const resolved = await container.services.publicApproval.resolve(token, ctx, undefined);
    if (!resolved.session) throw new Error('expected a public session');

    await container.services.decisions.decide(
      {
        plainToken: token,
        publicSessionToken: resolved.session.token,
        input: { type, signerName: alpha.approverName, declarationAccepted: true },
        idempotencyKey: randomUUID(),
        ifMatch: resolved.dto.etag,
      },
      ctx,
    );
    return { employee, outcome };
  }

  it('queues a team notification atomically with an approval', async () => {
    const { outcome } = await raiseAndDecide('APPROVE');

    const { rows } = await container.uow.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM job_queue
        WHERE kind = 'notify_team_decision' AND organization_id = $1`,
      [alpha.organizationId],
    );
    expect(rows[0]?.count).toBe('1');
    expect(outcome.changeOrderId).not.toBeNull();
  });

  it('queues one on a decline too — the employee must be told not to proceed', async () => {
    await raiseAndDecide('DECLINE');

    const { rows } = await container.uow.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM job_queue
        WHERE kind = 'notify_team_decision' AND organization_id = $1`,
      [alpha.organizationId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('records who raised it, so the notification has someone to reach', async () => {
    const { employee, outcome } = await raiseAndDecide('APPROVE');

    const { rows } = await container.uow.pool.query<{ id: string }>(
      `SELECT v.id FROM change_order_versions v
        WHERE v.change_order_id = $1 AND v.raised_by_employee_id = $2 AND v.origin = 'WHATSAPP'`,
      [outcome.changeOrderId, employee.id],
    );
    expect(rows).toHaveLength(1);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@extrawork/contracts';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  publicContext,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/** The suite asserts against the same day the server will see. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The WhatsApp intake path, end to end against real PostgreSQL.
 *
 * The rules being pinned here are the ones that make the channel safe to hand
 * to a person standing on a building site: it never guesses a price, never
 * guesses a project, never exceeds the ceiling the owner set, and never lets a
 * redelivered message bill a customer twice. Each one is a decision that would
 * otherwise be re-litigated by whoever touches this next.
 *
 * This file pins the direct path, so its workspace uses `AUTO_SEND` (spec
 * 2026-10-12, D3). The default `DESIGNER_REVIEW` routing and the rest of the
 * channel — asking, content, corrections — are in `whatsapp-channel.test.ts`.
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
  await container.uow.pool.query(
    `UPDATE organizations SET request_routing = 'AUTO_SEND' WHERE id = $1`,
    [alpha.organizationId],
  );
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

  it('includes an approved WhatsApp change in reports without an employee account', async () => {
    const employee = await addEmployee(alpha);
    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);

    // The public decision service owns this transition in production. This
    // test pins the reporting seam directly: once that version is approved,
    // its accountless WhatsApp origin must not make it disappear from reports.
    await container.uow.pool.query(
      `UPDATE change_order_versions
          SET status = 'APPROVED', decided_at = now()
        WHERE change_order_id = $1`,
      [outcome.changeOrderId],
    );

    const report = await container.repos.reporting.extraWorkReport(alpha.owner.tenant, {
      status: 'APPROVED',
    });

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      changeOrderId: outcome.changeOrderId,
      status: 'APPROVED',
      createdBy: employee.name,
    });
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
  // Spec 2026-10-12, D3/D6: under AUTO_SEND an incomplete request now goes to
  // the designer as a proposal instead of being rejected. Still no guess: the
  // version carries no price, nothing reaches the homeowner, and the reply
  // names the figure it could not read.
  it('hands an unreadable amount to the designer rather than picking a number', async () => {
    const employee = await addEmployee(alpha);
    const outcome = await send(
      employee.phoneE164,
      'What: Two extra power points in the kitchen\nCost: 15-20k',
    );

    expect(outcome.status).toBe('ACCEPTED');
    expect(outcome.reply).toContain('15-20k');
    expect(outcome.approvalUrl).toBeNull();
    const version = await container.repos.changeOrders.getCurrentVersion(
      alpha.owner.tenant,
      outcome.changeOrderId as string,
    );
    expect(version?.status).toBe('DRAFT');
    expect(version?.submittedForReviewAt).not.toBeNull();
    expect(version?.totalDeltaMinor).toBe(0n);
  });

  // Spec 2026-10-12, WhatsApp rules §3: the message is held and the sender
  // asked once, instead of being rejected.
  it('holds the message and asks which project when there is more than one', async () => {
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
    expect(outcome.status).toBe('AWAITING_CHOICE');
    expect(outcome.reply).toContain('Which project');
    expect(outcome.changeOrderId).toBeNull();
    expect(outcome.organizationId).toBeNull();
  });
});

describe('policy the owner set', () => {
  // Spec 2026-10-12, D3: above the ceiling, the request goes to the designer
  // instead of being refused. The ceiling still decides that it does not go
  // straight to the homeowner, and the reply still says the real numbers.
  it('sends a request above the employee’s ceiling to the designer, not the homeowner', async () => {
    const employee = await addEmployee(alpha, { maxRequestMinor: 1_000_000n });
    const outcome = await send(employee.phoneE164, GOOD_MESSAGE);

    expect(outcome.status).toBe('ACCEPTED');
    expect(outcome.reply).toContain('₹15,800.00');
    expect(outcome.reply).toContain('₹10,000.00');
    expect(outcome.approvalUrl).toBeNull();
    const version = await container.repos.changeOrders.getCurrentVersion(
      alpha.owner.tenant,
      outcome.changeOrderId as string,
    );
    expect(version?.status).toBe('DRAFT');
    expect(version?.submittedForReviewAt).not.toBeNull();
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

  it('resumes after a transient send failure without creating a second request', async () => {
    const employee = await addEmployee(alpha);
    const id = nextMessageId();
    vi.spyOn(container.services.send, 'send').mockRejectedValueOnce(
      new AppError('PROVIDER_UNAVAILABLE'),
    );

    await expect(send(employee.phoneE164, GOOD_MESSAGE, id)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });

    const checkpoint = await container.uow.pool.query<{
      id: string;
      status: string;
      change_order_id: string | null;
      processed_at: Date | null;
    }>(
      `SELECT id, status, change_order_id, processed_at
         FROM inbound_messages
        WHERE provider = 'whatsapp' AND provider_message_id = $1`,
      [id],
    );
    expect(checkpoint.rows[0]).toMatchObject({
      status: 'RECEIVED',
      processed_at: null,
    });
    expect(checkpoint.rows[0]?.change_order_id).not.toBeNull();

    const resumed = await send(employee.phoneE164, GOOD_MESSAGE, id);
    expect(resumed.status).toBe('ACCEPTED');
    expect(resumed.changeOrderId).toBe(checkpoint.rows[0]?.change_order_id);

    const { rows } = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM change_orders WHERE organization_id = $1',
      [alpha.organizationId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('allows only one concurrent processor for a redelivered message', async () => {
    const employee = await addEmployee(alpha);
    const id = nextMessageId();
    let releaseCreate!: () => void;
    let creationCheckpointed!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const checkpointed = new Promise<void>((resolve) => {
      creationCheckpointed = resolve;
    });
    const originalCreate = container.services.changeOrders.create.bind(
      container.services.changeOrders,
    );
    vi.spyOn(container.services.changeOrders, 'create').mockImplementationOnce(
      async (ctx, projectId, input, hooks) => {
        const created = await originalCreate(ctx, projectId, input, hooks);
        creationCheckpointed();
        await held;
        return created;
      },
    );

    const first = send(employee.phoneE164, GOOD_MESSAGE, id);
    await checkpointed;
    await expect(send(employee.phoneE164, GOOD_MESSAGE, id)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS',
    });
    releaseCreate();
    await expect(first).resolves.toMatchObject({ status: 'ACCEPTED' });

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
        input: {
          type,
          signerName: alpha.approverName,
          signedDate: today(),
          declarationAccepted: true,
        },
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

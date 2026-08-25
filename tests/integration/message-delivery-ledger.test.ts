import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { JOB_KINDS } from '@extrawork/contracts';
import { claimJobs, type JobRow } from '@extrawork/db';
import type { MessageGateway } from '@extrawork/integrations';
import type { Container } from '@extrawork/runtime';
import {
  createSentChangeOrder,
  createTenant,
  createTestContainer,
  publicContext,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';
import type { WorkerContext } from '../../apps/worker/src/context.js';
import {
  notifyTeamDecision,
  sendDecisionReceipt,
  sendMessageDelivery,
} from '../../apps/worker/src/jobs/messaging.js';

let container: Container;
let tenant: TenantFixture;

beforeAll(() => {
  container = createTestContainer();
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  tenant = await createTenant(container);
});

function gateway(channel: string, send: MessageGateway['send'], canDeliver = true): MessageGateway {
  return {
    channel,
    canDeliver,
    send,
    verifyAndParse: () => [],
  };
}

function workerContext(whatsapp: MessageGateway, email: MessageGateway): WorkerContext {
  return {
    env: container.env,
    db: container.uow.db,
    repos: container.repos,
    services: container.services,
    app: {
      ...container.appContext,
      integrations: {
        ...container.appContext.integrations,
        whatsapp,
        email,
      },
    },
    logger: container.logger,
    pdf: {} as WorkerContext['pdf'],
  };
}

function job(kind: JobRow['kind'], payload: Record<string, unknown>, attemptCount = 1): JobRow {
  return {
    id: randomUUID(),
    organizationId: tenant.organizationId,
    kind,
    payload,
    attemptCount,
    maxAttempts: 6,
    dedupeKey: null,
    createdAt: new Date(),
  };
}

async function approveChange(): Promise<{ decisionId: string; versionId: string }> {
  const sent = await createSentChangeOrder(container, tenant);
  const ctx = publicContext();
  const opened = await container.services.publicApproval.resolve(sent.token, ctx, undefined);
  if (!opened.session) throw new Error('Expected approval session');
  const receipt = await container.services.decisions.decide(
    {
      plainToken: sent.token,
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
  return { decisionId: receipt.decisionId, versionId: sent.changeOrder.version.id };
}

async function planCustomerReceipt(ctx: WorkerContext) {
  const approved = await approveChange();
  await sendDecisionReceipt(job(JOB_KINDS.SEND_DECISION_RECEIPT, approved), ctx);
  return approved;
}

describe('durable per-recipient message delivery', () => {
  it('fans customer channels out atomically and idempotently', async () => {
    const whatsappSend = vi.fn<MessageGateway['send']>();
    const emailSend = vi.fn<MessageGateway['send']>();
    const ctx = workerContext(
      gateway('WHATSAPP_CLOUD_API', whatsappSend),
      gateway('EMAIL', emailSend),
    );
    const approved = await planCustomerReceipt(ctx);

    // A parent retry must resolve the same two ledger rows, not create two more.
    await sendDecisionReceipt(job(JOB_KINDS.SEND_DECISION_RECEIPT, approved, 2), ctx);

    const messages = await container.uow.db.execute<{
      channel: string;
      status: string;
      recipient_kind: string;
      delivery_attempt_count: number;
    }>(sql`
      SELECT channel, status, recipient_kind, delivery_attempt_count
      FROM messages
      WHERE decision_id = ${approved.decisionId}::uuid
        AND purpose = 'DECISION_RECEIPT'
      ORDER BY channel
    `);
    expect(messages.rows).toEqual([
      {
        channel: 'EMAIL',
        status: 'PENDING',
        recipient_kind: 'CUSTOMER',
        delivery_attempt_count: 0,
      },
      {
        channel: 'WHATSAPP_CLOUD_API',
        status: 'PENDING',
        recipient_kind: 'CUSTOMER',
        delivery_attempt_count: 0,
      },
    ]);

    const children = await container.uow.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM job_queue
      WHERE kind = ${JOB_KINDS.SEND_MESSAGE_DELIVERY}
    `);
    expect(Number(children.rows[0]?.count)).toBe(2);
    expect(whatsappSend).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('retries only the failed recipient after partial provider success', async () => {
    const whatsappSend = vi.fn<MessageGateway['send']>().mockResolvedValue({
      provider: 'whatsapp-test',
      providerMessageId: 'wamid-one',
      status: 'ACCEPTED',
    });
    const emailSend = vi
      .fn<MessageGateway['send']>()
      .mockRejectedValueOnce(new Error('temporary SMTP failure'))
      .mockResolvedValue({
        provider: 'email-test',
        providerMessageId: 'mail-one',
        status: 'SENT',
      });
    const ctx = workerContext(
      gateway('WHATSAPP_CLOUD_API', whatsappSend),
      gateway('EMAIL', emailSend),
    );
    await planCustomerReceipt(ctx);

    const children = await claimJobs(container.uow.db, {
      limit: 10,
      leaseSeconds: 300,
      workerId: 'delivery-ledger-test',
      kinds: [JOB_KINDS.SEND_MESSAGE_DELIVERY],
    });
    expect(children).toHaveLength(2);
    const rows = await container.uow.db.execute<{ id: string; channel: string }>(sql`
      SELECT id, channel FROM messages WHERE purpose = 'DECISION_RECEIPT'
    `);
    const channelById = new Map(rows.rows.map((row) => [row.id, row.channel]));
    const whatsappJob = children.find(
      (entry) => channelById.get(String(entry.payload.messageId)) === 'WHATSAPP_CLOUD_API',
    );
    const emailJob = children.find(
      (entry) => channelById.get(String(entry.payload.messageId)) === 'EMAIL',
    );
    if (!whatsappJob || !emailJob) throw new Error('Expected one child job per channel');

    await sendMessageDelivery(whatsappJob, ctx);
    await expect(sendMessageDelivery(emailJob, ctx)).rejects.toThrow('temporary SMTP failure');

    const failed = await container.repos.messages.findDelivery(
      container.uow.db,
      tenant.owner.tenant,
      String(emailJob.payload.messageId),
    );
    expect(failed?.status).toBe('FAILED');
    expect(failed?.deliveryAttemptCount).toBe(1);

    await sendMessageDelivery({ ...emailJob, attemptCount: 2 }, ctx);
    // Replaying the already successful child is a no-op.
    await sendMessageDelivery({ ...whatsappJob, attemptCount: 2 }, ctx);

    expect(whatsappSend).toHaveBeenCalledTimes(1);
    expect(emailSend).toHaveBeenCalledTimes(2);
    const completed = await container.uow.db.execute<{
      channel: string;
      status: string;
      delivery_attempt_count: number;
      provider_message_id: string | null;
    }>(sql`
      SELECT channel, status, delivery_attempt_count, provider_message_id
      FROM messages
      WHERE purpose = 'DECISION_RECEIPT'
      ORDER BY channel
    `);
    expect(completed.rows).toEqual([
      {
        channel: 'EMAIL',
        status: 'SENT',
        delivery_attempt_count: 2,
        provider_message_id: 'mail-one',
      },
      {
        channel: 'WHATSAPP_CLOUD_API',
        status: 'ACCEPTED',
        delivery_attempt_count: 1,
        provider_message_id: 'wamid-one',
      },
    ]);
  });

  it('persists a team recipient before making the provider call', async () => {
    await container.uow.transaction((tx) =>
      container.repos.organizations.update(tx, tenant.owner.tenant, {
        contactPhone: '+919876500001',
      }),
    );
    const whatsappSend = vi.fn<MessageGateway['send']>().mockResolvedValue({
      provider: 'whatsapp-test',
      providerMessageId: 'team-wamid-one',
      status: 'ACCEPTED',
    });
    const ctx = workerContext(
      gateway('WHATSAPP_CLOUD_API', whatsappSend),
      gateway('EMAIL', vi.fn<MessageGateway['send']>()),
    );
    const approved = await approveChange();

    await notifyTeamDecision(job(JOB_KINDS.NOTIFY_TEAM_DECISION, approved), ctx);
    expect(whatsappSend).not.toHaveBeenCalled();

    const rows = await container.uow.db.execute<{
      id: string;
      purpose: string;
      status: string;
      recipient_kind: string;
      recipient_address: string;
    }>(sql`
      SELECT id, purpose, status, recipient_kind, recipient_address
      FROM messages
      WHERE decision_id = ${approved.decisionId}::uuid
        AND purpose = 'TEAM_DECISION'
    `);
    expect(rows.rows).toEqual([
      {
        id: expect.any(String),
        purpose: 'TEAM_DECISION',
        status: 'PENDING',
        recipient_kind: 'OWNER',
        recipient_address: '+919876500001',
      },
    ]);

    await sendMessageDelivery(
      job(JOB_KINDS.SEND_MESSAGE_DELIVERY, { messageId: rows.rows[0]?.id }),
      ctx,
    );
    expect(whatsappSend).toHaveBeenCalledTimes(1);
    expect(whatsappSend.mock.calls[0]?.[0]).toMatchObject({
      to: { phoneE164: '+919876500001' },
      purpose: 'DECISION_RECEIPT',
    });
  });

  it('recovers an expired lease without allowing stale failure to overwrite success', async () => {
    const ctx = workerContext(
      gateway('WHATSAPP_CLOUD_API', vi.fn<MessageGateway['send']>()),
      gateway('EMAIL', vi.fn<MessageGateway['send']>()),
    );
    const approved = await planCustomerReceipt(ctx);
    const row = await container.uow.db.execute<{ id: string }>(sql`
      SELECT id FROM messages
      WHERE decision_id = ${approved.decisionId}::uuid AND channel = 'EMAIL'
    `);
    const messageId = row.rows[0]?.id;
    if (!messageId) throw new Error('Expected email delivery');

    const first = await container.repos.messages.claimDelivery(
      container.uow.db,
      tenant.owner.tenant,
      messageId,
      'lease-one',
      300,
    );
    expect(first?.status).toBe('SENDING');
    await expect(
      container.repos.messages.claimDelivery(
        container.uow.db,
        tenant.owner.tenant,
        messageId,
        'lease-two',
        300,
      ),
    ).resolves.toBeNull();

    await container.uow.db.execute(sql`
      UPDATE messages SET delivery_leased_until = now() - interval '1 second'
      WHERE id = ${messageId}::uuid
    `);
    const reclaimed = await container.repos.messages.claimDelivery(
      container.uow.db,
      tenant.owner.tenant,
      messageId,
      'lease-two',
      300,
    );
    expect(reclaimed?.deliveryAttemptCount).toBe(2);
    expect(
      await container.repos.messages.markDeliveryFailed(
        container.uow.db,
        tenant.owner.tenant,
        messageId,
        'lease-one',
        'STALE_FAILURE',
        'must not win',
      ),
    ).toBe(false);

    expect(
      await container.repos.messages.markDeliverySent(
        container.uow.db,
        tenant.owner.tenant,
        messageId,
        {
          channel: 'EMAIL',
          status: 'SENT',
          provider: 'email-test',
          providerMessageId: 'stable-mail-id',
        },
      ),
    ).toBe(true);
    expect(
      await container.repos.messages.markDeliveryFailed(
        container.uow.db,
        tenant.owner.tenant,
        messageId,
        'lease-two',
        'LATE_FAILURE',
        'must not overwrite sent',
      ),
    ).toBe(false);

    const final = await container.repos.messages.findDelivery(
      container.uow.db,
      tenant.owner.tenant,
      messageId,
    );
    expect(final?.status).toBe('SENT');
    expect(final?.providerMessageId).toBe('stable-mail-id');
    expect(final?.errorCode).toBeNull();
  });
});

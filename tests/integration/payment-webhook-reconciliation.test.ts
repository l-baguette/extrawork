import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import { JOB_KINDS } from '@extrawork/contracts';
import { claimJobs } from '@extrawork/db';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';
import { workerContext } from '../../apps/worker/src/context.js';
import { normalizeWebhook } from '../../apps/worker/src/jobs/webhooks.js';
import type { PdfRenderer } from '../../apps/worker/src/pdf/renderer.js';

const KEY_ID = 'rzp_test_extrawork';
const WEBHOOK_SECRET = 'test-razorpay-webhook-secret';

const pdfStub: PdfRenderer = {
  render: () => Promise.reject(new Error('payment reconciliation must not render a PDF')),
  rendererVersion: () => Promise.resolve('test-renderer'),
  close: () => Promise.resolve(),
};

let container: Container;
let app: FastifyInstance;
let tenant: TenantFixture;

beforeAll(async () => {
  container = createTestContainer({
    env: {
      PAYMENTS_DRIVER: 'razorpay',
      RAZORPAY_KEY_ID: KEY_ID,
      RAZORPAY_KEY_SECRET: 'test-key-secret',
      RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    },
  });
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
  await app?.close();
  await container?.close();
});

beforeEach(async () => {
  await truncateAll(container);
  tenant = await createTenant(container, { name: 'Payment Reconciliation Co' });
});

async function createIntent(orderId: string, amountMinor = 25_000): Promise<string> {
  const id = randomUUID();
  await container.uow.pool.query(
    `INSERT INTO payment_intents
       (id, organization_id, amount_minor, currency, status, provider, provider_order_id)
     VALUES ($1, $2, $3, 'INR', 'PENDING', 'razorpay', $4)`,
    [id, tenant.organizationId, amountMinor, orderId],
  );
  return id;
}

function paymentEvent(input: {
  orderId: string;
  paymentId?: string;
  event?: string;
  amountMinor?: number;
  currency?: string;
}): string {
  return JSON.stringify({
    event: input.event ?? 'payment.captured',
    created_at: 1_787_000_000,
    payload: {
      payment: {
        entity: {
          id: input.paymentId ?? 'pay_test_1',
          order_id: input.orderId,
          amount: input.amountMinor ?? 25_000,
          currency: input.currency ?? 'INR',
        },
      },
    },
  });
}

async function postWebhook(body: string, eventId: string): Promise<void> {
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/v1/razorpay',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': eventId,
    },
    payload: body,
  });
  expect(response.statusCode).toBe(200);
}

async function claimNormalizeJob() {
  const jobs = await claimJobs(container.uow.db, {
    limit: 1,
    leaseSeconds: 60,
    workerId: 'payment-test',
    kinds: [JOB_KINDS.NORMALIZE_WEBHOOK],
  });
  const job = jobs[0];
  if (!job) throw new Error('payment webhook did not enqueue a normalisation job');
  return job;
}

describe('Razorpay webhook reconciliation', () => {
  it('marks a matching intent paid and records the provider payment id', async () => {
    const intentId = await createIntent('order_match');
    await postWebhook(paymentEvent({ orderId: 'order_match' }), 'event-paid');
    await normalizeWebhook(await claimNormalizeJob(), workerContext(container, pdfStub));

    const result = await container.uow.pool.query<{
      status: string;
      provider_payment_id: string | null;
    }>('SELECT status, provider_payment_id FROM payment_intents WHERE id = $1', [intentId]);
    expect(result.rows[0]).toMatchObject({ status: 'PAID', provider_payment_id: 'pay_test_1' });

    const audit = await container.uow.pool.query<{ event_type: string }>(
      'SELECT event_type FROM audit_events WHERE aggregate_id = $1',
      [intentId],
    );
    expect(audit.rows.map((row) => row.event_type)).toContain('payment.status_changed.v1');
  });

  it('does not accept an amount mismatch and records the integrity failure', async () => {
    const intentId = await createIntent('order_mismatch');
    await postWebhook(
      paymentEvent({ orderId: 'order_mismatch', amountMinor: 24_999 }),
      'event-mismatch',
    );
    const job = await claimNormalizeJob();
    await normalizeWebhook(job, workerContext(container, pdfStub));

    const intent = await container.uow.pool.query<{ status: string }>(
      'SELECT status FROM payment_intents WHERE id = $1',
      [intentId],
    );
    expect(intent.rows[0]?.status).toBe('PENDING');
    const inbox = await container.repos.webhooks.findById(
      container.uow.db,
      job.payload.webhookInboxId as string,
    );
    expect(inbox?.processedAt).not.toBeNull();
    expect(inbox?.processError).toContain('Amount mismatch');
  });

  it('preserves PAID when a late failed event arrives', async () => {
    const intentId = await createIntent('order_late');
    await postWebhook(paymentEvent({ orderId: 'order_late' }), 'event-paid-first');
    await normalizeWebhook(await claimNormalizeJob(), workerContext(container, pdfStub));

    await postWebhook(
      paymentEvent({ orderId: 'order_late', event: 'payment.failed' }),
      'event-failed-late',
    );
    await normalizeWebhook(await claimNormalizeJob(), workerContext(container, pdfStub));

    const intent = await container.uow.pool.query<{ status: string }>(
      'SELECT status FROM payment_intents WHERE id = $1',
      [intentId],
    );
    expect(intent.rows[0]?.status).toBe('PAID');
  });

  it('leaves an unknown order unprocessed so a creation race can retry', async () => {
    await postWebhook(paymentEvent({ orderId: 'order_not_created_yet' }), 'event-early');
    const job = await claimNormalizeJob();
    await expect(normalizeWebhook(job, workerContext(container, pdfStub))).rejects.toThrow(
      'Payment intent not found',
    );

    const inbox = await container.repos.webhooks.findById(
      container.uow.db,
      job.payload.webhookInboxId as string,
    );
    expect(inbox?.processedAt).toBeNull();
    expect(inbox?.processError).toContain('Payment intent not found');
  });
});

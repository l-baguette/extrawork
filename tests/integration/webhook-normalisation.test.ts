import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import { JOB_KINDS } from '@extrawork/contracts';
import { claimJobs } from '@extrawork/db';
import type { Container } from '@extrawork/runtime';
import {
  createDraftChangeOrder,
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';
import { workerContext } from '../../apps/worker/src/context.js';
import { normalizeWebhook } from '../../apps/worker/src/jobs/webhooks.js';
import type { PdfRenderer } from '../../apps/worker/src/pdf/renderer.js';

/**
 * The webhook seam: provider POST -> `webhook_inbox` -> NORMALIZE_WEBHOOK ->
 * `messages.status`.
 *
 * Both halves of this seam were broken at once and nothing caught it, because
 * every suite stopped at one side of the job queue. The API enqueued
 * `{ webhookInboxId }` while the handler read `payload.webhookId`, so every job
 * looked up `undefined`, found no row and died as WEBHOOK_MISSING. Fixing only
 * that exposed the second half: the gateway stores one inbox row per status
 * with the bare status object as its raw payload, while the normaliser read
 * only the full `entry[].changes[].value.statuses[]` envelope — so it mapped
 * zero statuses and still left the message where it was.
 *
 * Both are invisible from either side alone, so this test crosses the queue: it
 * posts a genuinely signed Meta receipt at the HTTP boundary, runs the job the
 * API actually enqueued, and asserts on the message the worker actually moved.
 */

let container: Container;
let app: FastifyInstance;
let tenant: TenantFixture;

const APP_SECRET = 'test-meta-app-secret';
const PHONE_NUMBER_ID = '111111111111111';

/** Normalisation must never need the renderer; a call here is a design error. */
const pdfStub: PdfRenderer = {
  render: () => Promise.reject(new Error('webhook normalisation must not render a PDF')),
  rendererVersion: () => Promise.resolve('test-renderer'),
  close: () => Promise.resolve(),
};

beforeAll(async () => {
  container = createTestContainer({
    env: {
      // The native-share default parses no webhooks at all, so the Cloud API
      // gateway is the only driver under which this seam exists.
      WHATSAPP_DRIVER: 'cloud-api',
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: 'test-access-token',
      WHATSAPP_APP_SECRET: APP_SECRET,
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
  await app.close();
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  tenant = await createTenant(container, { name: 'Webhook Interiors' });
});

/** A Meta delivery receipt, in the envelope the Cloud API actually posts. */
function deliveryReceipt(providerMessageId: string, status: string, timestamp: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '222222222222222',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550001111',
                phone_number_id: PHONE_NUMBER_ID,
              },
              statuses: [
                {
                  id: providerMessageId,
                  status,
                  timestamp,
                  recipient_id: '919876500001',
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

/** Signs the exact bytes, the way Meta does and the way the route verifies. */
async function postReceipt(body: string) {
  const signature = createHmac('sha256', APP_SECRET)
    .update(Buffer.from(body, 'utf8'))
    .digest('hex');
  return app.inject({
    method: 'POST',
    url: '/webhooks/v1/meta/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    payload: body,
  });
}

/**
 * A sent request whose message row is waiting on a provider receipt.
 *
 * Sending on `WHATSAPP` records the row against the gateway that will carry it
 * and leaves it PENDING; the Cloud API send then yields ACCEPTED and the
 * provider's `wamid`, which is what a delivery receipt later refers to.
 */
async function sentMessageAwaitingReceipt(providerMessageId: string): Promise<string> {
  const draft = await createDraftChangeOrder(container, tenant);
  await container.services.send.send(tenant.owner, draft.changeOrderId, { channel: 'WHATSAPP' });

  const version = await container.repos.changeOrders.getCurrentVersion(
    tenant.owner.tenant,
    draft.changeOrderId,
  );
  if (!version) throw new Error('send did not freeze a version');

  const messages = await container.repos.messages.listForVersion(tenant.owner.tenant, version.id);
  const request = messages.find((m) => m.purpose === 'REQUEST');
  if (!request) throw new Error('send did not record a request message');

  await container.uow.pool.query(
    `UPDATE messages
        SET status = 'ACCEPTED', provider = 'whatsapp-cloud',
            provider_account_id = $1, provider_message_id = $2
      WHERE id = $3`,
    [PHONE_NUMBER_ID, providerMessageId, request.id],
  );
  return request.id;
}

/** Claims the job the API enqueued, exactly as the worker's runner would. */
async function claimNormalizeJob() {
  const jobs = await claimJobs(container.uow.db, {
    limit: 1,
    leaseSeconds: 60,
    workerId: 'vitest',
    kinds: [JOB_KINDS.NORMALIZE_WEBHOOK],
  });
  const job = jobs[0];
  if (!job) throw new Error('the webhook POST enqueued no NORMALIZE_WEBHOOK job');
  return job;
}

describe('meta delivery-status webhooks', () => {
  it('advances the message and marks the inbox row processed', async () => {
    const wamid = 'wamid.HBgMOTE5ODc2NTAwMDAxFQIAERgSMEE5RDU2N0U5MjM0NTY3ODkA';
    const messageId = await sentMessageAwaitingReceipt(wamid);

    const response = await postReceipt(deliveryReceipt(wamid, 'delivered', '1755400000'));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: 1 });

    const job = await claimNormalizeJob();
    await normalizeWebhook(job, workerContext(container, pdfStub));

    // The point of the whole seam: internal state moved.
    const message = await container.repos.messages.findByProviderMessageId(
      container.uow.db,
      'whatsapp-cloud',
      PHONE_NUMBER_ID,
      wamid,
    );
    expect(message?.id).toBe(messageId);
    expect(message?.status).toBe('DELIVERED');

    // And the raw event is closed out, so it is neither retried nor re-applied.
    const inbox = await container.repos.webhooks.findById(
      container.uow.db,
      job.payload.webhookInboxId as string,
    );
    expect(inbox?.processedAt).not.toBeNull();
  });

  it('enqueues the job under the payload key the handler reads', async () => {
    // The original defect, asserted directly: the two sides of the queue named
    // the same id differently, and `findById(undefined)` failed every job.
    // An end-to-end pass can hide a rename on both sides; this cannot.
    const wamid = 'wamid.KEYNAME';
    await sentMessageAwaitingReceipt(wamid);
    await postReceipt(deliveryReceipt(wamid, 'sent', '1755400001'));

    const job = await claimNormalizeJob();
    expect(Object.keys(job.payload)).toEqual(['webhookInboxId']);
    expect(typeof job.payload.webhookInboxId).toBe('string');
  });

  it('records a late status as history without regressing the message', async () => {
    // Report §10.3: an out-of-order receipt is preserved but must not move
    // state backwards.
    const wamid = 'wamid.OUTOFORDER';
    await sentMessageAwaitingReceipt(wamid);

    await postReceipt(deliveryReceipt(wamid, 'read', '1755400010'));
    await normalizeWebhook(await claimNormalizeJob(), workerContext(container, pdfStub));

    await postReceipt(deliveryReceipt(wamid, 'sent', '1755400002'));
    await normalizeWebhook(await claimNormalizeJob(), workerContext(container, pdfStub));

    const message = await container.repos.messages.findByProviderMessageId(
      container.uow.db,
      'whatsapp-cloud',
      PHONE_NUMBER_ID,
      wamid,
    );
    expect(message?.status).toBe('READ');

    // Both receipts are still on the record, including the one that was ignored.
    const events = await container.uow.pool.query<{ status: string }>(
      'SELECT status FROM message_events WHERE message_id = $1 ORDER BY received_at',
      [message?.id],
    );
    expect(events.rows.map((r) => r.status)).toEqual(['READ', 'SENT']);
  });

  it('keeps a failed inbox row retryable and clears the error after success', async () => {
    const wamid = 'wamid.RETRYABLE';
    await sentMessageAwaitingReceipt(wamid);
    await postReceipt(deliveryReceipt(wamid, 'delivered', '1755400020'));
    const job = await claimNormalizeJob();
    const webhookInboxId = job.payload.webhookInboxId as string;

    const originalFind = container.repos.messages.findByProviderMessageId.bind(
      container.repos.messages,
    );
    container.repos.messages.findByProviderMessageId = async () => {
      throw new Error('temporary database read failure');
    };
    try {
      await expect(normalizeWebhook(job, workerContext(container, pdfStub))).rejects.toThrow(
        'temporary database read failure',
      );
    } finally {
      container.repos.messages.findByProviderMessageId = originalFind;
    }

    const failed = await container.uow.pool.query<{
      processed_at: Date | null;
      process_error: string | null;
    }>('SELECT processed_at, process_error FROM webhook_inbox WHERE id = $1', [webhookInboxId]);
    expect(failed.rows[0]?.processed_at).toBeNull();
    expect(failed.rows[0]?.process_error).toContain('temporary database read failure');

    await normalizeWebhook(job, workerContext(container, pdfStub));

    const recovered = await container.uow.pool.query<{
      processed_at: Date | null;
      process_error: string | null;
    }>('SELECT processed_at, process_error FROM webhook_inbox WHERE id = $1', [webhookInboxId]);
    expect(recovered.rows[0]?.processed_at).toBeInstanceOf(Date);
    expect(recovered.rows[0]?.process_error).toBeNull();
    const message = await originalFind(container.uow.db, 'whatsapp-cloud', PHONE_NUMBER_ID, wamid);
    expect(message?.status).toBe('DELIVERED');
  });
});

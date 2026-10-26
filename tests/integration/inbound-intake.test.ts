import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import { JOB_KINDS } from '@extrawork/contracts';
import { claimJobs } from '@extrawork/db';
import type { FetchedMedia, OutboundMessage, ProviderMessageRef } from '@extrawork/integrations';
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

/**
 * A site employee texts the business number and a customer ends up with an
 * approval link — over the real Cloud API path rather than the simulator.
 *
 * The simulator proved intake works when something hands it a parsed message.
 * What it could not prove is the half that only exists on the real provider:
 * the message arriving as a signed webhook, the reply having to be *sent*
 * rather than returned in an HTTP response, and attachments needing an
 * authenticated fetch before they can be quarantined.
 *
 * The security rule pinned here is the one with no second chance: media is
 * fetched only after the sender resolves to a known employee. Without it,
 * anyone who knows the business number can make this worker download and store
 * whatever they like.
 */

let container: Container;
let app: FastifyInstance;
let tenant: TenantFixture;

const APP_SECRET = 'test-meta-app-secret';
const PHONE_NUMBER_ID = '111111111111111';

/** What the gateway was asked to send, and what media it was asked to fetch. */
let sent: OutboundMessage[] = [];
let fetchedMediaIds: string[] = [];

const pdfStub: PdfRenderer = {
  render: () => Promise.reject(new Error('intake must not render a PDF')),
  rendererVersion: () => Promise.resolve('test-renderer'),
  close: () => Promise.resolve(),
};

const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

beforeAll(async () => {
  container = createTestContainer({
    env: {
      WHATSAPP_DRIVER: 'cloud-api',
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: 'test-access-token',
      WHATSAPP_APP_SECRET: APP_SECRET,
    },
  });

  // The gateway is real — its parsing and signature checks are under test. Only
  // the two calls that would reach Meta's network are replaced.
  const gateway = container.appContext.integrations.whatsapp;
  gateway.send = async (command: OutboundMessage): Promise<ProviderMessageRef> => {
    sent.push(command);
    return {
      provider: 'whatsapp-cloud',
      providerMessageId: `wamid.OUT${sent.length}`,
      status: 'SENT',
    };
  };

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
  sent = [];
  fetchedMediaIds = [];
  container.appContext.integrations.whatsapp.fetchMedia = async (
    mediaId: string,
  ): Promise<FetchedMedia> => {
    fetchedMediaIds.push(mediaId);
    return { bytes: PHOTO, mimeType: 'image/jpeg', byteSize: PHOTO.byteLength };
  };
  tenant = await createTenant(container, { name: 'Inbound Interiors' });
});

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+9198${String(20_000_000 + phoneCounter).slice(0, 8)}`;
}

function addEmployee(phoneE164: string) {
  return container.uow.transaction((tx) =>
    container.repos.employees.create(tx, tenant.owner.tenant, {
      name: 'Ramesh Patil',
      phoneE164,
      roleNote: null,
      allProjects: true,
      maxRequestMinor: null,
      projectIds: [],
    }),
  );
}

function inboundPayload(input: {
  from: string;
  messageId: string;
  body?: string;
  mediaId?: string;
}): string {
  const message: Record<string, unknown> = {
    id: input.messageId,
    // As Meta sends it: digits, no plus.
    from: input.from.replace('+', ''),
    timestamp: '1755400000',
    type: input.mediaId ? 'image' : 'text',
  };
  if (input.mediaId) {
    message.image = { id: input.mediaId, mime_type: 'image/jpeg', caption: input.body ?? '' };
  } else {
    message.text = { body: input.body ?? '' };
  }

  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              messages: [message],
            },
          },
        ],
      },
    ],
  });
}

async function postInbound(body: string) {
  const signature = createHmac('sha256', APP_SECRET)
    .update(Buffer.from(body, 'utf8'))
    .digest('hex');
  return app.inject({
    method: 'POST',
    url: '/webhooks/v1/meta/whatsapp',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` },
    payload: body,
  });
}

/** Runs the job the API enqueued, exactly as the worker's runner would. */
async function runQueuedWebhookJob(): Promise<void> {
  const jobs = await claimJobs(container.uow.db, {
    limit: 1,
    leaseSeconds: 60,
    workerId: 'vitest',
    kinds: [JOB_KINDS.NORMALIZE_WEBHOOK],
  });
  const job = jobs[0];
  if (!job) throw new Error('the inbound POST enqueued no NORMALIZE_WEBHOOK job');
  await normalizeWebhook(job, workerContext(container, pdfStub));
}

/**
 * No project named, which is the common case: the tenant fixture has exactly
 * one, so `matchProject` resolves it as ASSUMED rather than asking. That is the
 * single biggest friction saving in the whole flow and worth exercising here.
 */
const GOOD_MESSAGE = [
  'What: Two extra power points in the kitchen',
  'Why: Client changed the appliance layout',
  'Cost: 15800',
  'Days: 2',
].join('\n');

describe('inbound WhatsApp messages reach intake', () => {
  it('turns a signed message into a change request and replies to the employee', async () => {
    const phone = nextPhone();
    await addEmployee(phone);

    const response = await postInbound(
      inboundPayload({ from: phone, messageId: 'wamid.IN001', body: GOOD_MESSAGE }),
    );
    expect(response.statusCode).toBe(200);

    await runQueuedWebhookJob();

    const inbound = await container.uow.db.execute<{
      status: string;
      change_order_id: string | null;
    }>(
      sql`SELECT status, change_order_id FROM inbound_messages WHERE provider_message_id = 'wamid.IN001'`,
    );
    expect(inbound.rows[0]?.status).toBe('ACCEPTED');
    expect(inbound.rows[0]?.change_order_id).not.toBeNull();

    // The adapter's classification is persisted, so the worker branches on it
    // rather than re-deriving the answer from the shape of the raw JSON.
    const stored = await container.uow.db.execute<{ kind: string | null }>(
      sql`SELECT kind FROM webhook_inbox WHERE provider_event_id = 'wamid.IN001'`,
    );
    expect(stored.rows[0]?.kind).toBe('INBOUND_MESSAGE');

    // The employee is told what happened. Over real WhatsApp there is no HTTP
    // response carrying this, so an explicit send is the only thing that makes
    // the intake reply reach anyone.
    const reply = sent.find((m) => m.purpose === 'INTAKE_REPLY');
    expect(reply).toBeDefined();
    expect(reply?.to.phoneE164).toBe(phone);
    expect(reply?.body.length).toBeGreaterThan(0);
  });

  it('replies to an unknown sender without creating anything', async () => {
    const response = await postInbound(
      inboundPayload({ from: nextPhone(), messageId: 'wamid.IN002', body: GOOD_MESSAGE }),
    );
    expect(response.statusCode).toBe(200);

    await runQueuedWebhookJob();

    const inbound = await container.uow.db.execute<{ status: string }>(
      sql`SELECT status FROM inbound_messages WHERE provider_message_id = 'wamid.IN002'`,
    );
    expect(inbound.rows[0]?.status).toBe('REJECTED_UNKNOWN_SENDER');
    // Silence is never the answer, even to a stranger.
    expect(sent.some((m) => m.purpose === 'INTAKE_REPLY')).toBe(true);
  });

  it('never fetches media from an unrecognised sender', async () => {
    await postInbound(
      inboundPayload({
        from: nextPhone(),
        messageId: 'wamid.IN003',
        body: GOOD_MESSAGE,
        mediaId: 'media-from-a-stranger',
      }),
    );
    await runQueuedWebhookJob();

    // The whole point: an unknown number must not be able to make the worker
    // pull bytes. Not "downloaded then discarded" — never requested at all.
    expect(fetchedMediaIds).toEqual([]);
    const files = await container.uow.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM file_objects`,
    );
    expect(files.rows[0]?.count).toBe('0');
  });

  it('quarantines an attachment from a known employee and queues its scan', async () => {
    const phone = nextPhone();
    await addEmployee(phone);

    await postInbound(
      inboundPayload({
        from: phone,
        messageId: 'wamid.IN004',
        body: GOOD_MESSAGE,
        mediaId: 'media-1',
      }),
    );
    await runQueuedWebhookJob();

    expect(fetchedMediaIds).toEqual(['media-1']);

    const file = await container.uow.db.execute<{
      id: string;
      storage_key: string;
      scan_status: string;
      purpose: string;
    }>(sql`SELECT id, storage_key, scan_status, purpose FROM file_objects LIMIT 1`);
    const row = file.rows[0];
    expect(row).toBeDefined();
    // It lands in quarantine like every other upload, and stays unusable until
    // the shared scan job clears it.
    expect(row?.storage_key).toContain('quarantine/');
    expect(row?.scan_status).toBe('PENDING');
    // Spec 2026-10-12, D6: the message became a proposal for the designer, so
    // the photo is that proposal's evidence (it was an unattached INTAKE_MEDIA
    // file before the channel knew where it belonged).
    expect(row?.purpose).toBe('CHANGE_ATTACHMENT');
    const attached = await container.uow.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM version_attachments WHERE file_object_id = ${row?.id}::uuid`,
    );
    expect(attached.rows[0]?.count).toBe('1');

    const link = await container.uow.db.execute<{ provider_media_id: string }>(
      sql`SELECT provider_media_id FROM inbound_message_media`,
    );
    expect(link.rows[0]?.provider_media_id).toBe('media-1');

    const scans = await container.uow.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM job_queue WHERE kind = ${JOB_KINDS.SCAN_FILE}`,
    );
    expect(scans.rows[0]?.count).toBe('1');
  });

  it('does not fetch the same attachment twice when the job is retried', async () => {
    const phone = nextPhone();
    await addEmployee(phone);

    await postInbound(
      inboundPayload({
        from: phone,
        messageId: 'wamid.IN005',
        body: GOOD_MESSAGE,
        mediaId: 'media-2',
      }),
    );

    // Two runs of the same job — a lease expiry or a crash after the download.
    await runQueuedWebhookJob();
    const jobs = await claimJobs(container.uow.db, {
      limit: 1,
      leaseSeconds: 60,
      workerId: 'vitest-retry',
      kinds: [JOB_KINDS.NORMALIZE_WEBHOOK],
    });
    if (jobs[0]) await normalizeWebhook(jobs[0], workerContext(container, pdfStub));

    expect(fetchedMediaIds).toEqual(['media-2']);
    const files = await container.uow.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM file_objects`,
    );
    expect(files.rows[0]?.count).toBe('1');
  });

  it('keeps a transient media failure retryable and resumes the attachment batch', async () => {
    const phone = nextPhone();
    await addEmployee(phone);
    let attempts = 0;
    container.appContext.integrations.whatsapp.fetchMedia = async (
      mediaId: string,
    ): Promise<FetchedMedia> => {
      fetchedMediaIds.push(mediaId);
      attempts += 1;
      if (attempts === 1) throw new Error('temporary Meta media outage');
      return { bytes: PHOTO, mimeType: 'image/jpeg', byteSize: PHOTO.byteLength };
    };

    await postInbound(
      inboundPayload({
        from: phone,
        messageId: 'wamid.INMEDIARETRY',
        body: GOOD_MESSAGE,
        mediaId: 'media-retry',
      }),
    );
    const jobs = await claimJobs(container.uow.db, {
      limit: 1,
      leaseSeconds: 60,
      workerId: 'vitest-media-retry',
      kinds: [JOB_KINDS.NORMALIZE_WEBHOOK],
    });
    const job = jobs[0];
    if (!job) throw new Error('missing webhook job');
    await expect(normalizeWebhook(job, workerContext(container, pdfStub))).rejects.toThrow(
      'temporary Meta media outage',
    );

    const failed = await container.repos.webhooks.findById(
      container.uow.db,
      job.payload.webhookInboxId as string,
    );
    expect(failed?.processedAt).toBeNull();
    expect(failed?.processError).toContain('temporary Meta media outage');
    // The request itself committed once; only the attachment remains.
    const ordersAfterFailure = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM change_orders',
    );
    expect(ordersAfterFailure.rows[0]?.count).toBe('1');

    await normalizeWebhook(job, workerContext(container, pdfStub));
    expect(fetchedMediaIds).toEqual(['media-retry', 'media-retry']);
    const files = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM file_objects',
    );
    expect(files.rows[0]?.count).toBe('1');
    const recovered = await container.repos.webhooks.findById(
      container.uow.db,
      job.payload.webhookInboxId as string,
    );
    expect(recovered?.processedAt).not.toBeNull();
    expect(recovered?.processError).toBeNull();
  });

  it('does not raise a second request when the provider redelivers a message', async () => {
    const phone = nextPhone();
    await addEmployee(phone);
    const body = inboundPayload({ from: phone, messageId: 'wamid.IN006', body: GOOD_MESSAGE });

    await postInbound(body);
    await runQueuedWebhookJob();
    // Meta redelivers the identical event; the webhook inbox dedupes it.
    await postInbound(body);

    const orders = await container.uow.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM change_orders`,
    );
    expect(orders.rows[0]?.count).toBe('1');
  });
});

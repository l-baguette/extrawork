import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '@extrawork/api/app';
import { JOB_KINDS } from '@extrawork/contracts';
import type { Container } from '@extrawork/runtime';
import { createTestContainer, truncateAll } from '@extrawork/testkit';

/**
 * A stored provider event and its normalisation job commit together — report
 * §13.2, §14.6.
 *
 * Apart, the two writes have a gap with no way out of it. A crash after the
 * insert commits leaves an event with no job; the provider's retry then hits
 * the unique `(provider, account, event id)` index, gets no id back, and
 * schedules nothing. The event is held forever, unprocessed, while the endpoint
 * keeps answering 200 — and because the storage half succeeded, nothing looks
 * wrong. That is the silent discard §14.6 forbids, in its most deniable form.
 *
 * The rollback case is what pins the property, so it is provoked rather than
 * assumed: a constraint makes every `job_queue` insert fail, and the assertion
 * is that no orphaned `webhook_inbox` row survives it. Split the transaction
 * again and this test fails; assert only the happy path and it would not.
 */

let container: Container;
let app: FastifyInstance;

const APP_SECRET = 'test-meta-app-secret';
const PHONE_NUMBER_ID = '111111111111111';

beforeAll(async () => {
  container = createTestContainer({
    env: {
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
  await dropFailingConstraint();
});

function deliveryReceipt(providerMessageId: string): string {
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
              statuses: [
                {
                  id: providerMessageId,
                  status: 'delivered',
                  timestamp: '1755400000',
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

function postReceipt(body: string) {
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

/**
 * Makes every subsequent `job_queue` insert fail. `NOT VALID` skips the rows
 * already there, so this only affects the write under test.
 */
async function addFailingConstraint(): Promise<void> {
  await container.uow.db.execute(
    sql`ALTER TABLE job_queue ADD CONSTRAINT tmp_reject_inserts CHECK (false) NOT VALID`,
  );
}

async function dropFailingConstraint(): Promise<void> {
  await container.uow.db.execute(
    sql`ALTER TABLE job_queue DROP CONSTRAINT IF EXISTS tmp_reject_inserts`,
  );
}

async function countRows(table: 'webhook_inbox' | 'job_queue'): Promise<number> {
  const identifier = table === 'webhook_inbox' ? sql`webhook_inbox` : sql`job_queue`;
  const result = await container.uow.db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM ${identifier}`,
  );
  return Number(result.rows[0]?.count ?? '0');
}

describe('webhook inbox and job scheduling are atomic', () => {
  it('stores the event and queues its job together', async () => {
    const response = await postReceipt(deliveryReceipt('wamid.ATOMIC0000000000000000001'));

    expect(response.statusCode).toBe(200);
    expect(await countRows('webhook_inbox')).toBe(1);
    expect(await countRows('job_queue')).toBe(1);
  });

  it('leaves no orphaned event when scheduling fails', async () => {
    await addFailingConstraint();

    // The requirement is only that this is not a 200: a provider told 200 never
    // retries, so acknowledging a write that did not happen loses the event for
    // good. The exact code is not pinned because it depends on how the write
    // failed — `client.ts` maps a check violation to 400 and a deadlock or lost
    // connection to 409/500, and the CHECK above is a stand-in for all of them.
    const response = await postReceipt(deliveryReceipt('wamid.ATOMIC0000000000000000002'));
    expect(response.statusCode).not.toBe(200);

    await dropFailingConstraint();

    // The whole point. Before this was one transaction, the row survived here
    // and no retry could ever schedule its job.
    expect(await countRows('webhook_inbox')).toBe(0);
    expect(await countRows('job_queue')).toBe(0);
  });

  it('lets the provider retry succeed after a failed attempt', async () => {
    const body = deliveryReceipt('wamid.ATOMIC0000000000000000003');

    await addFailingConstraint();
    await postReceipt(body);
    await dropFailingConstraint();

    // Meta redelivers an unacknowledged event. Because the first attempt rolled
    // back completely, the unique index does not swallow it as a duplicate.
    const retry = await postReceipt(body);

    expect(retry.statusCode).toBe(200);
    expect(await countRows('webhook_inbox')).toBe(1);
    expect(await countRows('job_queue')).toBe(1);
  });

  it('does not queue a second job for a genuine redelivery', async () => {
    const body = deliveryReceipt('wamid.ATOMIC0000000000000000004');

    await postReceipt(body);
    const duplicate = await postReceipt(body);

    // A duplicate is acknowledged, not re-queued — the stored event already has
    // a job from the first delivery (report §13.2).
    expect(duplicate.statusCode).toBe(200);
    expect(await countRows('webhook_inbox')).toBe(1);
    expect(await countRows('job_queue')).toBe(1);
  });
});

/** Guards against the enqueue quietly changing kind and stranding the handler. */
it('queues the job under the kind the worker handles', async () => {
  await postReceipt(deliveryReceipt('wamid.ATOMIC0000000000000000005'));

  const result = await container.uow.db.execute<{ kind: string; payload: Record<string, unknown> }>(
    sql`SELECT kind, payload FROM job_queue LIMIT 1`,
  );
  expect(result.rows[0]?.kind).toBe(JOB_KINDS.NORMALIZE_WEBHOOK);
  expect(result.rows[0]?.payload).toHaveProperty('webhookInboxId');
});

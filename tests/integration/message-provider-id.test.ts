import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * The provider message id round trip — report §10.3, §13.2.
 *
 * A delivery-status webhook carries the provider's own handle for the message
 * (Meta's `wamid`) and nothing else that identifies the row it refers to. So
 * `normalizeWebhook` resolves it through `findByProviderMessageId`, and that
 * lookup can only ever succeed if the id was written when the gateway returned
 * it from `send`.
 *
 * It was not. `record` inserted `provider` but never `provider_message_id`, so
 * the column stayed null on every row, every status webhook was discarded as
 * "unknown provider message id", and a delivered message sat at its send-time
 * status permanently. The column, its partial index and this reader had all
 * existed since 0001_core_schema — only the write was missing, which is exactly
 * the shape of defect an end-to-end assertion catches and a unit test does not.
 *
 * These tests pin the write, not the webhook handler: they fail if the id stops
 * being persisted, whatever the rest of the delivery path is doing.
 */

let container: Container;
let alpha: TenantFixture;
let beta: TenantFixture;

beforeAll(() => {
  container = createTestContainer();
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  alpha = await createTenant(container, { name: 'Alpha Interiors' });
  beta = await createTenant(container, { name: 'Beta Builders' });
});

/**
 * `version_id` and `contact_id` are nullable on `messages`, so a bare row is
 * enough to exercise the id round trip without dragging a whole change order
 * into a test about one column.
 */
function recordMessage(
  tenant: TenantFixture,
  input: {
    status: string;
    provider?: string | null;
    providerAccountId?: string | null;
    providerMessageId?: string | null;
    dedupeKey?: string | null;
  },
): Promise<string | null> {
  return container.uow.transaction((tx) =>
    container.repos.messages.record(tx, tenant.owner.tenant, {
      versionId: null,
      contactId: null,
      channel: 'WHATSAPP_CLOUD_API',
      purpose: 'REQUEST',
      ...input,
    }),
  );
}

describe('provider message id persistence', () => {
  it('makes a sent message findable by the id the gateway returned', async () => {
    // The shape Meta actually returns from POST /messages.
    const wamid = 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgSN0Y0MkQxQjc5RjA2QzMyQTAA';

    const messageId = await recordMessage(alpha, {
      status: 'SENT',
      provider: 'whatsapp-cloud',
      providerAccountId: 'phone-alpha',
      providerMessageId: wamid,
      dedupeKey: `request:${wamid}`,
    });
    expect(messageId).not.toBeNull();

    const found = await container.repos.messages.findByProviderMessageId(
      container.uow.db,
      'whatsapp-cloud',
      'phone-alpha',
      wamid,
    );

    expect(found).not.toBeNull();
    expect(found?.id).toBe(messageId);
    expect(found?.status).toBe('SENT');
    expect(found?.organizationId).toBe(alpha.organizationId);
  });

  it('leaves the id null for an intent recorded before any send', async () => {
    // `SendService.send` records the intent inside the domain transaction, long
    // before a provider has been called. Writing a placeholder id there would
    // make the row claim a provider handle it does not have.
    const messageId = await recordMessage(alpha, {
      status: 'PENDING',
      dedupeKey: 'request:pending-intent',
    });
    expect(messageId).not.toBeNull();

    const rows = await container.uow.db.execute<{ provider_message_id: string | null }>(
      sql`SELECT provider_message_id FROM messages WHERE id = ${messageId}::uuid`,
    );
    expect(rows.rows[0]?.provider_message_id).toBeNull();
  });

  it('does not resolve a provider id across tenants', async () => {
    const wamid = 'wamid.CROSSTENANT000000000000000000000000';
    await recordMessage(beta, {
      status: 'SENT',
      provider: 'whatsapp-cloud',
      providerAccountId: 'phone-beta',
      providerMessageId: wamid,
      dedupeKey: `request:${wamid}`,
    });

    const found = await container.repos.messages.findByProviderMessageId(
      container.uow.db,
      'whatsapp-cloud',
      'phone-beta',
      wamid,
    );

    // The lookup is deliberately un-scoped — a webhook arrives with no tenant —
    // so the row it finds must carry the owning organization for the caller to
    // scope everything downstream. Beta's message must never read as Alpha's.
    expect(found?.organizationId).toBe(beta.organizationId);
    expect(found?.organizationId).not.toBe(alpha.organizationId);
  });

  it('resolves identical provider ids independently for two provider accounts', async () => {
    const shared = 'wamid.ACCOUNTSCOPED000000000000000000000';
    const alphaId = await recordMessage(alpha, {
      status: 'SENT',
      provider: 'whatsapp-cloud',
      providerAccountId: 'phone-alpha',
      providerMessageId: shared,
      dedupeKey: 'request:alpha-shared',
    });
    const betaId = await recordMessage(beta, {
      status: 'SENT',
      provider: 'whatsapp-cloud',
      providerAccountId: 'phone-beta',
      providerMessageId: shared,
      dedupeKey: 'request:beta-shared',
    });

    const alphaFound = await container.repos.messages.findByProviderMessageId(
      container.uow.db,
      'whatsapp-cloud',
      'phone-alpha',
      shared,
    );
    const betaFound = await container.repos.messages.findByProviderMessageId(
      container.uow.db,
      'whatsapp-cloud',
      'phone-beta',
      shared,
    );
    expect(alphaFound?.id).toBe(alphaId);
    expect(betaFound?.id).toBe(betaId);
    expect(alphaFound?.organizationId).toBe(alpha.organizationId);
    expect(betaFound?.organizationId).toBe(beta.organizationId);
  });
});

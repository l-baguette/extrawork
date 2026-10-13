import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  leaseOutboxBatch,
  markOutboxFailed,
  markOutboxPublished,
  publishOutbox,
} from '@extrawork/db';
import type { Container } from '@extrawork/runtime';
import { createTestContainer, truncateAll } from '@extrawork/testkit';

let container: Container;

beforeAll(() => {
  container = createTestContainer();
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
});

describe('outbox lease ownership', () => {
  it('prevents a stale lease generation from publishing or failing a reclaimed event', async () => {
    const [eventId] = await container.uow.transaction((tx) =>
      publishOutbox(tx, {
        topic: 'approval.decided.v1',
        aggregateId: '00000000-0000-4000-8000-000000000001',
        organizationId: null,
        payload: {},
      }),
    );
    const [first] = await leaseOutboxBatch(container.uow.db, { limit: 1, leaseSeconds: 60 });
    expect(first?.id).toBe(eventId);

    await container.uow.pool.query(
      `UPDATE outbox_events SET leased_until = now() - interval '1 second' WHERE id = $1`,
      [eventId],
    );
    const [second] = await leaseOutboxBatch(container.uow.db, { limit: 1, leaseSeconds: 60 });
    expect(second?.id).toBe(eventId);
    expect(second?.attemptCount).toBe(first!.attemptCount + 1);

    await expect(
      markOutboxPublished(container.uow.db, first!.id, first!.attemptCount),
    ).resolves.toBe(false);
    await expect(
      markOutboxFailed(container.uow.db, first!.id, first!.attemptCount, 'STALE', 30),
    ).resolves.toBe('LEASE_LOST');

    await expect(
      markOutboxPublished(container.uow.db, second!.id, second!.attemptCount),
    ).resolves.toBe(true);
    const row = await container.uow.pool.query<{
      published_at: Date | null;
      dead_lettered_at: Date | null;
    }>('SELECT published_at, dead_lettered_at FROM outbox_events WHERE id = $1', [eventId]);
    expect(row.rows[0]?.published_at).toBeInstanceOf(Date);
    expect(row.rows[0]?.dead_lettered_at).toBeNull();
  });
});

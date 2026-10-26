import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@extrawork/contracts';
import { beginIdempotent, completeIdempotent } from '@extrawork/db';
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

const params = {
  scope: 'test.expiry',
  subjectId: 'subject-1',
  key: 'key-1',
  payload: { value: 'first' },
};

describe('idempotency expiry', () => {
  it('reclaims an expired key as a fresh request even when its payload changed', async () => {
    const first = await container.uow.transaction(async (tx) => {
      const claim = await beginIdempotent(tx, params);
      await completeIdempotent(tx, claim.id, { status: 201, body: { result: 'first' } });
      return claim;
    });
    await container.uow.pool.query(
      `UPDATE idempotency_records SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [first.id],
    );

    const second = await container.uow.transaction((tx) =>
      beginIdempotent(tx, { ...params, payload: { value: 'second' } }),
    );

    expect(second).toMatchObject({ id: first.id, replay: false, response: null });
  });

  it('still rejects a different payload while the key is live', async () => {
    await container.uow.transaction(async (tx) => {
      const claim = await beginIdempotent(tx, params);
      await completeIdempotent(tx, claim.id, { status: 200, body: { ok: true } });
    });

    await expect(
      container.uow.transaction((tx) =>
        beginIdempotent(tx, { ...params, payload: { value: 'different' } }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => AppError.is(error) && error.code === 'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('rejects a non-positive TTL before writing a claim', async () => {
    await expect(
      container.uow.transaction((tx) => beginIdempotent(tx, { ...params, ttlHours: 0 })),
    ).rejects.toThrow('Idempotency TTL must be a positive duration');
  });
});

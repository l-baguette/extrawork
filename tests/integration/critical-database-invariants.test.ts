import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Container } from '@extrawork/runtime';
import {
  createSentChangeOrder,
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

let container: Container;
let alpha: TenantFixture;
let beta: TenantFixture;
const runtimeRole = `ew_test_${randomUUID().replaceAll('-', '')}`;

beforeAll(async () => {
  container = createTestContainer();
  await container.uow.pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN`);
  await container.uow.pool.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
  await container.uow.pool.query(
    `GRANT SELECT, UPDATE ON change_order_versions TO "${runtimeRole}"`,
  );
});

afterAll(async () => {
  await container.uow.pool.query(`DROP OWNED BY "${runtimeRole}"`);
  await container.uow.pool.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  alpha = await createTenant(container, { name: 'Critical Alpha' });
  beta = await createTenant(container, { name: 'Critical Beta' });
});

async function asUnprivilegedWriter(
  query: string,
  values: unknown[],
  organizationId: string,
): Promise<unknown> {
  const client = await container.uow.pool.connect();
  try {
    await client.query('BEGIN');
    // A minimally privileged write role models a compromised application
    // credential without inheriting the test database owner's superuser bit.
    await client.query(`SET LOCAL ROLE "${runtimeRole}"`);
    await client.query("SET LOCAL extrawork.allow_repair = 'on'");
    // Row-level security applies to this role, so an unscoped statement would
    // match zero rows and "succeed" without the freeze trigger ever running —
    // the guard would look broken while actually being doubly enforced. Declare
    // the tenant, as the application does, so these tests keep asserting what
    // they were written to assert: that the trigger refuses even a correctly
    // scoped write.
    await client.query("SELECT set_config('extrawork.organization_id', $1, true)", [
      organizationId,
    ]);
    return await client.query(query, values);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('critical database integrity guards', () => {
  it('does not let a caller-set session value rewrite frozen evidence', async () => {
    const { changeOrder } = await createSentChangeOrder(container, alpha);

    await expect(
      asUnprivilegedWriter(
        `UPDATE change_order_versions
            SET canonical_sha256 = decode(repeat('00', 32), 'hex')
          WHERE id = $1`,
        [changeOrder.version.id],
        alpha.organizationId,
      ),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('rejects a frozen version returning to DRAFT', async () => {
    const { changeOrder } = await createSentChangeOrder(container, alpha);

    await expect(
      asUnprivilegedWriter(
        `UPDATE change_order_versions SET status = 'DRAFT' WHERE id = $1`,
        [changeOrder.version.id],
        alpha.organizationId,
      ),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('rejects a cross-tenant parent reference at the database boundary', async () => {
    await expect(
      container.uow.pool.query(
        `INSERT INTO contacts
           (id, organization_id, customer_id, name, email_normalized)
         VALUES ($1, $2, $3, 'Cross tenant contact', 'cross@example.test')`,
        [randomUUID(), beta.organizationId, alpha.customerId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('refuses a repository status write scoped to the wrong tenant', async () => {
    const { changeOrder } = await createSentChangeOrder(container, alpha);

    await expect(
      container.uow.transaction((tx) =>
        container.repos.changeOrders.setStatus(
          tx,
          beta.owner.tenant,
          changeOrder.version.id,
          'CANCELLED',
          new Date(),
        ),
      ),
    ).rejects.toMatchObject({ code: 'CHANGE_ORDER_NOT_FOUND' });

    const unchanged = await container.repos.changeOrders.requireVersion(
      container.uow.db,
      alpha.owner.tenant,
      changeOrder.version.id,
    );
    expect(unchanged.status).toBe('SENT');
  });
});

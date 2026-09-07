import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Container } from '@extrawork/runtime';
import { SYSTEM_SCOPE, runInScope, tenantScope } from '@extrawork/db';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * Proof that row-level security is real, and that the application still works
 * with it on.
 *
 * These tests exist because the rest of the suite cannot prove either. The test
 * database owner is a PostgreSQL superuser, and **superusers bypass RLS
 * unconditionally — even with FORCE ROW LEVEL SECURITY**. So every other test
 * file runs with the policies inert, and would keep passing if the policies were
 * dropped tomorrow.
 *
 * Everything here therefore runs through a second container connected as a
 * deliberately unprivileged login role, which is what production uses
 * (`pnpm db:harden`). If RLS is broken, misconfigured, or accidentally removed,
 * this file fails and nothing else does.
 */

let owner: Container;
/** A container connected as a non-superuser, i.e. how production connects. */
let restricted: Container;
let alpha: TenantFixture;
let beta: TenantFixture;

const roleName = `ew_rls_${randomUUID().replaceAll('-', '')}`;
const rolePassword = 'rls-test-password';

function restrictedUrl(base: string): string {
  const url = new URL(base);
  url.username = roleName;
  url.password = rolePassword;
  return url.toString();
}

beforeAll(async () => {
  owner = createTestContainer();

  // Mirrors the runtime role from `pnpm db:harden`: enough to run the app,
  // never enough to bypass a policy.
  await owner.uow.pool.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}'`);
  await owner.uow.pool.query(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
  await owner.uow.pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${roleName}"`,
  );
  await owner.uow.pool.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${roleName}"`,
  );

  restricted = createTestContainer({
    env: { DATABASE_URL: restrictedUrl(owner.env.DATABASE_URL) },
  });

  await truncateAll(owner);
  alpha = await createTenant(owner, { name: 'RLS Alpha' });
  beta = await createTenant(owner, { name: 'RLS Beta' });
});

afterAll(async () => {
  await restricted.close();
  await owner.uow.pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${roleName}"`);
  await owner.uow.pool.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${roleName}"`);
  await owner.uow.pool.query(`REVOKE USAGE ON SCHEMA public FROM "${roleName}"`);
  await owner.uow.pool.query(`DROP ROLE IF EXISTS "${roleName}"`);
  await owner.close();
});

/** Counts customer rows the restricted connection can actually see. */
async function visibleCustomers(): Promise<string[]> {
  const result = await restricted.uow.db.execute<{ organization_id: string }>(
    sql`SELECT organization_id FROM customers`,
  );
  return result.rows.map((row) => row.organization_id);
}

describe('row-level security', () => {
  it('is actually enforced for the restricted role (guards against a superuser false pass)', async () => {
    const check = await restricted.uow.db.execute<{ relrowsecurity: boolean; forced: boolean }>(
      sql`SELECT relrowsecurity, relforcerowsecurity AS forced
            FROM pg_class WHERE relname = 'customers'`,
    );
    expect(check.rows[0]?.relrowsecurity).toBe(true);
    expect(check.rows[0]?.forced).toBe(true);

    const superuser = await restricted.uow.db.execute<{ is_super: boolean }>(
      sql`SELECT usesuper AS is_super FROM pg_user WHERE usename = current_user`,
    );
    // If this ever becomes true the rest of this file proves nothing.
    expect(superuser.rows[0]?.is_super).toBe(false);
  });

  it('shows a tenant only its own rows', async () => {
    const seen = await runInScope(tenantScope(alpha.organizationId), visibleCustomers);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([alpha.organizationId]));
  });

  it('hides another tenant even from a query with no WHERE clause at all', async () => {
    const seen = await runInScope(tenantScope(beta.organizationId), visibleCustomers);
    expect(seen).not.toContain(alpha.organizationId);
  });

  it('shows nothing when no scope is declared, rather than everything', async () => {
    // The property that matters: the failure mode of forgetting to scope is an
    // empty result, not a cross-tenant disclosure.
    const seen = await visibleCustomers();
    expect(seen).toEqual([]);
  });

  it('lets an explicit system scope cross tenants, for the sweeps that must', async () => {
    const seen = await runInScope(SYSTEM_SCOPE, visibleCustomers);
    expect(new Set(seen)).toEqual(new Set([alpha.organizationId, beta.organizationId]));
  });

  it('refuses to write a row into another tenant (WITH CHECK)', async () => {
    await expect(
      runInScope(tenantScope(alpha.organizationId), () =>
        restricted.uow.transaction((tx) =>
          tx.db.execute(sql`
            INSERT INTO customers (id, organization_id, display_name)
            VALUES (${randomUUID()}::uuid, ${beta.organizationId}::uuid, 'Smuggled')
          `),
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses to update another tenant’s row even by primary key', async () => {
    const target = await owner.uow.db.execute<{ id: string }>(
      sql`SELECT id FROM customers WHERE organization_id = ${beta.organizationId}::uuid LIMIT 1`,
    );
    const betaCustomerId = target.rows[0]?.id;
    expect(betaCustomerId).toBeDefined();

    const updated = await runInScope(tenantScope(alpha.organizationId), () =>
      restricted.uow.transaction((tx) =>
        tx.db.execute(
          sql`UPDATE customers SET display_name = 'Taken over' WHERE id = ${betaCustomerId}::uuid`,
        ),
      ),
    );
    // Not an error — the row simply is not there to update, which is the whole
    // point. Assert the row survived rather than trusting the row count.
    expect((updated as { rowCount?: number }).rowCount ?? 0).toBe(0);

    const after = await owner.uow.db.execute<{ display_name: string }>(
      sql`SELECT display_name FROM customers WHERE id = ${betaCustomerId}::uuid`,
    );
    expect(after.rows[0]?.display_name).not.toBe('Taken over');
  });

  it('runs a real end-to-end flow through the application under RLS', async () => {
    // "Total functionality": the services, repositories and transactions all
    // work unchanged with the policies enforced, on the same role production
    // uses. If the scope plumbing missed a path, this is where it shows.
    const created = await runInScope(tenantScope(alpha.organizationId), async () => {
      const ctx = {
        actor: {
          userId: alpha.ownerUserId,
          organizationId: alpha.organizationId,
          role: 'OWNER' as const,
          projectGrants: new Set<string>(),
          authenticatedAt: Date.now(),
        },
        tenant: {
          organizationId: alpha.organizationId,
          userId: alpha.ownerUserId,
          role: 'OWNER' as const,
          requestId: 'rls-test',
        },
        requestId: 'rls-test',
        sessionId: null,
        ipHash: null,
        userAgent: 'vitest',
        readOnly: false,
      };

      const customer = await restricted.services.projects.createCustomer(ctx, {
        displayName: 'RLS Flow Customer',
        contacts: [
          {
            name: 'Flow Contact',
            phoneE164: '+919845099001',
            isDefaultApprover: true,
          },
        ],
      });

      const contacts = await restricted.repos.customers.listContacts(ctx.tenant, customer.id);
      const approver = contacts.find((c) => c.isDefaultApprover);
      expect(approver).toBeDefined();

      const project = await restricted.services.projects.createProject(ctx, {
        customerId: customer.id,
        title: 'RLS end-to-end project',
        siteAddress: { line1: '1 Test Road', city: 'Bengaluru', country: 'IN' },
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        baseline: { subtotalMinor: 100_000, taxMinor: 18_000, totalMinor: 118_000 },
        defaultApproverContactId: approver?.id,
      });

      // A read-back through the repository layer, which is the path that runs
      // outside a transaction and needed the scoped wrapper.
      const readBack = await restricted.repos.projects.findById(ctx.tenant, project.id);
      expect(readBack?.title).toBe('RLS end-to-end project');

      return { customerId: customer.id, projectId: project.id };
    });

    // And the rows really are the tenant's, seen from a trusted vantage point.
    const check = await owner.uow.db.execute<{ organization_id: string }>(
      sql`SELECT organization_id FROM projects WHERE id = ${created.projectId}::uuid`,
    );
    expect(check.rows[0]?.organization_id).toBe(alpha.organizationId);
  });
});

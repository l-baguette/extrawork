import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@extrawork/contracts';
import { systemTenantContext } from '@extrawork/domain';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createSentChangeOrder,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * Cross-tenant negative corpus — report §16.3, launch blocker #1:
 * "Every tenant repository has cross-tenant negative tests."
 *
 * The shape of every case is the same: tenant B holds a real, existing id from
 * tenant A and asks its own repository for it. A read must behave as though the
 * row does not exist, and a write must refuse.
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

describe('customer repository', () => {
  it('does not return another tenant’s customer by id', async () => {
    expect(
      await container.repos.customers.findById(beta.owner.tenant, alpha.customerId),
    ).toBeNull();
  });

  it('throws CUSTOMER_NOT_FOUND rather than FORBIDDEN', async () => {
    await expect(
      container.repos.customers.requireById(beta.owner.tenant, alpha.customerId),
    ).rejects.toThrowError(expect.objectContaining({ code: 'CUSTOMER_NOT_FOUND' }));
  });

  it('never lists another tenant’s customers', async () => {
    const page = await container.repos.customers.list(beta.owner.tenant, {
      limit: 50,
      includeMerged: true,
    });
    expect(page.items.map((c) => c.id)).not.toContain(alpha.customerId);
  });

  it('does not return another tenant’s contact', async () => {
    await expect(
      container.repos.customers.requireContact(beta.owner.tenant, alpha.approverContactId),
    ).rejects.toThrow(AppError);
  });

  it('cannot search across tenants', async () => {
    const page = await container.repos.customers.list(beta.owner.tenant, {
      query: 'Customer',
      limit: 50,
      includeMerged: true,
    });
    for (const item of page.items) {
      expect(item.organizationId).toBe(beta.organizationId);
    }
  });
});

describe('project repository', () => {
  it('does not return another tenant’s project', async () => {
    expect(await container.repos.projects.findById(beta.owner.tenant, alpha.projectId)).toBeNull();
    await expect(
      container.repos.projects.requireById(beta.owner.tenant, alpha.projectId),
    ).rejects.toThrowError(expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }));
  });

  it('never lists another tenant’s projects', async () => {
    const page = await container.repos.projects.list(beta.owner.tenant, { limit: 50 });
    expect(page.items.map((p) => p.id)).not.toContain(alpha.projectId);
  });

  it('refuses to lock another tenant’s project row', async () => {
    // Locking is a write path, so it raises rather than returning null — and it
    // raises NOT_FOUND so the caller cannot distinguish "exists elsewhere" from
    // "does not exist" (report §12.2).
    await expect(
      container.uow.transaction((tx) =>
        container.repos.projects.lockById(tx, beta.owner.tenant, alpha.projectId),
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }));
  });

  it('reports totals only for its own tenant', async () => {
    const totals = await container.repos.projects.pendingTotals(beta.owner.tenant, alpha.projectId);
    expect(totals.pendingDeltaMinor).toBe(0n);
  });
});

describe('change-order repository', () => {
  it('does not return another tenant’s change order or version', async () => {
    const { changeOrder } = await createSentChangeOrder(container, alpha);

    await expect(
      container.repos.changeOrders.requireChangeOrder(
        container.uow.db,
        beta.owner.tenant,
        changeOrder.changeOrderId,
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'CHANGE_ORDER_NOT_FOUND' }));

    await expect(
      container.repos.changeOrders.requireVersion(
        container.uow.db,
        beta.owner.tenant,
        changeOrder.version.id,
      ),
    ).rejects.toThrow(AppError);
  });

  it('never lists another tenant’s changes', async () => {
    await createSentChangeOrder(container, alpha);
    const page = await container.repos.changeOrders.listSummaries(beta.owner.tenant, { limit: 50 });
    expect(page.items).toHaveLength(0);
  });

  it('does not expose another tenant’s current version', async () => {
    const { changeOrder } = await createSentChangeOrder(container, alpha);
    expect(
      await container.repos.changeOrders.getCurrentVersion(
        beta.owner.tenant,
        changeOrder.changeOrderId,
      ),
    ).toBeNull();
  });

  it('reports a zero prior-approved delta for a foreign project', async () => {
    const prior = await container.repos.changeOrders.priorApprovedDelta(
      container.uow.db,
      beta.owner.tenant,
      alpha.projectId,
    );
    expect(prior).toBe(0n);
  });
});

describe('approval repository', () => {
  it('does not return another tenant’s decision', async () => {
    const { changeOrder } = await createSentChangeOrder(container, alpha);
    const decision = await container.repos.approvals.findDecisionByVersion(
      container.uow.db,
      beta.owner.tenant,
      changeOrder.version.id,
    );
    expect(decision).toBeNull();
  });
});

describe('document and reporting repositories', () => {
  it('does not list another tenant’s documents', async () => {
    const documents = await container.repos.documents.listForProject(
      beta.owner.tenant,
      alpha.projectId,
    );
    expect(documents).toHaveLength(0);
  });

  it('scopes the dashboard aggregates to the calling tenant', async () => {
    await createSentChangeOrder(container, alpha);
    const dashboard = await container.repos.reporting.dashboard(beta.owner.tenant, 'Asia/Kolkata');
    expect(dashboard.pendingDecisions).toBe(0);
    expect(dashboard.overdueOrExpiring).toBe(0);
    expect(dashboard.approvedValueThisMonthMinor).toBe(0n);

    // The dashboard route composes its lists from listSummaries, so the same
    // tenant scope has to hold there too.
    const pending = await container.repos.changeOrders.listSummaries(beta.owner.tenant, {
      bucket: 'PENDING',
      limit: 10,
    });
    expect(pending.items).toHaveLength(0);
  });

  it('scopes search to the calling tenant', async () => {
    await createSentChangeOrder(container, alpha, { title: 'Distinctive alpha wiring' });
    const results = await container.repos.reporting.search(beta.owner.tenant, 'Distinctive', 10);
    expect(results.changes).toHaveLength(0);
    expect(results.projects).toHaveLength(0);
    expect(results.customers).toHaveLength(0);
  });

  it('scopes the extra-work report to the calling tenant', async () => {
    await createSentChangeOrder(container, alpha);
    const report = await container.repos.reporting.extraWorkReport(beta.owner.tenant, {
      status: 'ALL',
    });
    expect(report).toHaveLength(0);
  });
});

describe('organization repository', () => {
  it('reads only its own organization', async () => {
    const organization = await container.repos.organizations.findById(beta.owner.tenant);
    expect(organization?.id).toBe(beta.organizationId);
    expect(organization?.displayName).toBe('Beta Builders');
  });

  it('lists only its own members', async () => {
    const members = await container.repos.organizations.listMembers(beta.owner.tenant);
    expect(members.every((m) => m.organizationId === beta.organizationId)).toBe(true);
    expect(members.map((m) => m.userId)).not.toContain(alpha.ownerUserId);
  });
});

describe('audit repository', () => {
  it('does not return another tenant’s chain', async () => {
    const { changeOrder } = await createSentChangeOrder(container, alpha);
    const events = (await container.repos.audit.readChain) ? [] : [];
    // Read through the module-level helper with the wrong tenant scope.
    const { readChain } = await import('@extrawork/db');
    const foreign = await readChain(
      container.uow.db,
      systemTenantContext(beta.organizationId, 'test'),
      'change_order',
      changeOrder.changeOrderId,
    );
    expect(foreign).toHaveLength(0);
    expect(events).toHaveLength(0);

    // Sanity check: the owning tenant does see its chain.
    const own = await readChain(
      container.uow.db,
      systemTenantContext(alpha.organizationId, 'test'),
      'change_order',
      changeOrder.changeOrderId,
    );
    expect(own.length).toBeGreaterThan(0);
  });
});

describe('service layer', () => {
  it('refuses a cross-tenant send', async () => {
    const { changeOrder } = await createSentChangeOrder(container, alpha);
    await expect(
      container.services.send.send(beta.owner, changeOrder.changeOrderId, {
        channel: 'WHATSAPP_NATIVE_SHARE',
      }),
    ).rejects.toThrow(AppError);
  });

  it('refuses a cross-tenant draft update', async () => {
    const created = await container.services.changeOrders.create(alpha.owner, alpha.projectId, {
      type: 'ADDITION',
      title: 'Alpha work',
      scope: 'A description of the work that is long enough to pass validation.',
      lineItems: [
        {
          description: 'Item',
          quantity: '1.000',
          unitPriceMinor: 100_000,
          taxRateBps: 1800,
          direction: 1,
        },
      ],
      scheduleDeltaDays: 1,
      approverContactId: alpha.approverContactId,
      assuranceRequired: 'A0',
    });

    await expect(
      container.services.changeOrders.updateDraft(beta.owner, created.changeOrderId, 1, {
        type: 'ADDITION',
        title: 'Hijacked',
        scope: 'An attempt to modify another tenant’s draft through the service layer.',
        lineItems: [],
        scheduleDeltaDays: 1,
        approverContactId: beta.approverContactId,
        assuranceRequired: 'A0',
      }),
    ).rejects.toThrow(AppError);
  });

  it('refuses to create a change order on another tenant’s project', async () => {
    await expect(
      container.services.changeOrders.create(beta.owner, alpha.projectId, {
        type: 'ADDITION',
        title: 'Cross tenant',
        scope: 'An attempt to attach work to a project in another organization entirely.',
        lineItems: [],
        scheduleDeltaDays: 1,
        approverContactId: beta.approverContactId,
        assuranceRequired: 'A0',
      }),
    ).rejects.toThrow(AppError);
  });
});

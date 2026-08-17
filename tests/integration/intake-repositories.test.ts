import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * Migration 0005 persistence: employees, inbound messages and request
 * templates, against real PostgreSQL.
 *
 * Two things are being proved here. The first is the same cross-tenant negative
 * corpus every other repository carries (report §16.3, launch blocker #1): B
 * holds a real id from A, and a read behaves as though the row does not exist.
 *
 * The second is specific to intake, and is the reason these tables exist at
 * all: a phone number must resolve to exactly one employee system-wide, and an
 * unattributable message must still be recorded rather than guessed into a
 * tenant.
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

/** Unique per test run so the global phone index does not collide across cases. */
let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+9198${String(10_000_000 + phoneCounter).slice(0, 8)}`;
}

async function addEmployee(
  tenant: TenantFixture,
  overrides: Partial<{
    name: string;
    phoneE164: string;
    allProjects: boolean;
    maxRequestMinor: bigint | null;
    projectIds: string[];
  }> = {},
) {
  return container.uow.transaction((tx) =>
    container.repos.employees.create(tx, tenant.owner.tenant, {
      name: overrides.name ?? 'Site Supervisor',
      phoneE164: overrides.phoneE164 ?? nextPhone(),
      roleNote: null,
      allProjects: overrides.allProjects ?? false,
      maxRequestMinor: overrides.maxRequestMinor ?? null,
      projectIds: overrides.projectIds ?? [tenant.projectId],
    }),
  );
}

describe('employee repository', () => {
  it('creates an employee with project assignments', async () => {
    const employee = await addEmployee(alpha);
    expect(employee.organizationId).toBe(alpha.organizationId);
    expect(employee.projectIds).toEqual([alpha.projectId]);
    expect(employee.status).toBe('ACTIVE');
  });

  it('keeps the approval ceiling as a bigint, never a number', async () => {
    const employee = await addEmployee(alpha, { maxRequestMinor: 2_000_000n });
    const reread = await container.repos.employees.requireById(alpha.owner.tenant, employee.id);
    expect(reread.maxRequestMinor).toBe(2_000_000n);
    expect(typeof reread.maxRequestMinor).toBe('bigint');
  });

  it('does not return another tenant’s employee by id', async () => {
    const employee = await addEmployee(alpha);
    expect(await container.repos.employees.findById(beta.owner.tenant, employee.id)).toBeNull();
  });

  it('throws EMPLOYEE_NOT_FOUND rather than FORBIDDEN', async () => {
    const employee = await addEmployee(alpha);
    await expect(
      container.repos.employees.requireById(beta.owner.tenant, employee.id),
    ).rejects.toThrowError(expect.objectContaining({ code: 'EMPLOYEE_NOT_FOUND' }));
  });

  it('never lists another tenant’s employees', async () => {
    const employee = await addEmployee(alpha);
    const listed = await container.repos.employees.list(beta.owner.tenant);
    expect(listed.map((e) => e.id)).not.toContain(employee.id);
  });

  it('refuses to update another tenant’s employee', async () => {
    const employee = await addEmployee(alpha);
    await expect(
      container.uow.transaction((tx) =>
        container.repos.employees.update(tx, beta.owner.tenant, employee.id, { name: 'Hijacked' }),
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'EMPLOYEE_NOT_FOUND' }));

    const untouched = await container.repos.employees.requireById(alpha.owner.tenant, employee.id);
    expect(untouched.name).toBe('Site Supervisor');
  });

  it('refuses to remove another tenant’s employee', async () => {
    const employee = await addEmployee(alpha);
    await expect(
      container.uow.transaction((tx) =>
        container.repos.employees.remove(tx, beta.owner.tenant, employee.id),
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: 'EMPLOYEE_NOT_FOUND' }));

    const untouched = await container.repos.employees.requireById(alpha.owner.tenant, employee.id);
    expect(untouched.status).toBe('ACTIVE');
  });

  it('drops a project id belonging to another tenant instead of assigning it', async () => {
    // The ids come from a request body. A foreign one must not silently grant
    // an employee access to another organization's project.
    const employee = await addEmployee(alpha, { projectIds: [alpha.projectId, beta.projectId] });
    expect(employee.projectIds).toEqual([alpha.projectId]);
    expect(
      await container.repos.employees.canRaiseFor(alpha.owner.tenant, employee.id, beta.projectId),
    ).toBe(false);
  });

  describe('one phone, one employee', () => {
    it('rejects a duplicate number inside the same organization', async () => {
      const phone = nextPhone();
      await addEmployee(alpha, { phoneE164: phone });
      await expect(addEmployee(alpha, { phoneE164: phone })).rejects.toThrowError(
        expect.objectContaining({ code: 'EMPLOYEE_PHONE_TAKEN' }),
      );
    });

    it('rejects the same number registered at a different organization', async () => {
      // This is the case that makes inbound attribution unambiguous: without it
      // a message from this number could belong to either tenant.
      const phone = nextPhone();
      await addEmployee(alpha, { phoneE164: phone });
      await expect(addEmployee(beta, { phoneE164: phone })).rejects.toThrowError(
        expect.objectContaining({ code: 'EMPLOYEE_PHONE_TAKEN' }),
      );
    });

    it('frees the number once the employee is removed', async () => {
      const phone = nextPhone();
      const employee = await addEmployee(alpha, { phoneE164: phone });
      await container.uow.transaction((tx) =>
        container.repos.employees.remove(tx, alpha.owner.tenant, employee.id),
      );

      const reused = await addEmployee(beta, { phoneE164: phone });
      expect(reused.organizationId).toBe(beta.organizationId);
      // The removed row survives so the inbound log keeps pointing at a person.
      expect(await container.repos.employees.findByPhoneGlobal(phone)).toMatchObject({
        id: reused.id,
      });
    });
  });

  describe('findByPhoneGlobal', () => {
    it('resolves the tenant from the number alone', async () => {
      const phone = nextPhone();
      const employee = await addEmployee(alpha, { phoneE164: phone });
      const found = await container.repos.employees.findByPhoneGlobal(phone);
      expect(found).toMatchObject({
        id: employee.id,
        organizationId: alpha.organizationId,
      });
      expect(found?.projectIds).toEqual([alpha.projectId]);
    });

    it('returns null for an unregistered number', async () => {
      expect(await container.repos.employees.findByPhoneGlobal(nextPhone())).toBeNull();
    });

    it('ignores a removed employee', async () => {
      const phone = nextPhone();
      const employee = await addEmployee(alpha, { phoneE164: phone });
      await container.uow.transaction((tx) =>
        container.repos.employees.remove(tx, alpha.owner.tenant, employee.id),
      );
      expect(await container.repos.employees.findByPhoneGlobal(phone)).toBeNull();
    });
  });

  describe('canRaiseFor', () => {
    it('allows an assigned project', async () => {
      const employee = await addEmployee(alpha, { projectIds: [alpha.projectId] });
      expect(
        await container.repos.employees.canRaiseFor(
          alpha.owner.tenant,
          employee.id,
          alpha.projectId,
        ),
      ).toBe(true);
    });

    it('allows any project when all_projects is set', async () => {
      const employee = await addEmployee(alpha, { allProjects: true, projectIds: [] });
      expect(
        await container.repos.employees.canRaiseFor(
          alpha.owner.tenant,
          employee.id,
          alpha.projectId,
        ),
      ).toBe(true);
    });

    it('refuses a suspended employee even on an assigned project', async () => {
      const employee = await addEmployee(alpha, { projectIds: [alpha.projectId] });
      await container.uow.transaction((tx) =>
        container.repos.employees.update(tx, alpha.owner.tenant, employee.id, {
          status: 'SUSPENDED',
        }),
      );
      expect(
        await container.repos.employees.canRaiseFor(
          alpha.owner.tenant,
          employee.id,
          alpha.projectId,
        ),
      ).toBe(false);
    });
  });
});

describe('inbound message repository', () => {
  let messageCounter = 0;
  function nextMessageId(): string {
    messageCounter += 1;
    return `wamid.test.${messageCounter}.${Math.random().toString(36).slice(2, 8)}`;
  }

  async function record(input: {
    providerMessageId?: string;
    fromPhoneE164?: string;
    body?: string;
  }) {
    return container.uow.transaction((tx) =>
      container.repos.inboundMessages.record(tx, {
        providerMessageId: input.providerMessageId ?? nextMessageId(),
        fromPhoneE164: input.fromPhoneE164 ?? nextPhone(),
        body: input.body ?? 'Project: Tower 4\nWhat: Two power points\nCost: 15800',
      }),
    );
  }

  it('logs a message from an unknown sender with no tenant attached', async () => {
    const { row, alreadySeen } = await record({});
    expect(alreadySeen).toBe(false);
    expect(row.organizationId).toBeNull();
    expect(row.status).toBe('RECEIVED');
  });

  it('is idempotent on the provider message id', async () => {
    const providerMessageId = nextMessageId();
    const first = await record({ providerMessageId });
    const second = await record({ providerMessageId });

    expect(second.alreadySeen).toBe(true);
    expect(second.row.id).toBe(first.row.id);

    const { rows } = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM inbound_messages WHERE provider_message_id = $1',
      [providerMessageId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('attributes a message to a tenant once the sender resolves', async () => {
    const employee = await addEmployee(alpha);
    const { row } = await record({ fromPhoneE164: employee.phoneE164 });

    const processed = await container.uow.transaction((tx) =>
      container.repos.inboundMessages.markProcessed(tx, row.id, {
        status: 'ACCEPTED',
        organizationId: alpha.organizationId,
        employeeId: employee.id,
        projectId: alpha.projectId,
        parsed: { costMinor: '1580000' },
        replyText: 'Sent to the customer for approval.',
      }),
    );

    expect(processed.status).toBe('ACCEPTED');
    expect(processed.organizationId).toBe(alpha.organizationId);
    expect(processed.parsed).toEqual({ costMinor: '1580000' });
    expect(processed.processedAt).toBeInstanceOf(Date);
  });

  it('leaves a rejected unknown sender unattributed', async () => {
    const { row } = await record({});
    const processed = await container.uow.transaction((tx) =>
      container.repos.inboundMessages.markProcessed(tx, row.id, {
        status: 'REJECTED_UNKNOWN_SENDER',
        rejectionReason: 'No employee registered for this number',
        replyText: 'This number is not registered.',
      }),
    );

    expect(processed.organizationId).toBeNull();
    expect(processed.status).toBe('REJECTED_UNKNOWN_SENDER');
    // Unattributed messages are invisible to every tenant, including the one
    // whose number was being impersonated.
    expect(await container.repos.inboundMessages.findById(alpha.owner.tenant, row.id)).toBeNull();
    expect((await container.repos.inboundMessages.listUnattributed()).map((m) => m.id)).toContain(
      row.id,
    );
  });

  it('does not return another tenant’s message by id', async () => {
    const employee = await addEmployee(alpha);
    const { row } = await record({ fromPhoneE164: employee.phoneE164 });
    await container.uow.transaction((tx) =>
      container.repos.inboundMessages.markProcessed(tx, row.id, {
        status: 'ACCEPTED',
        organizationId: alpha.organizationId,
        employeeId: employee.id,
      }),
    );

    expect(await container.repos.inboundMessages.findById(beta.owner.tenant, row.id)).toBeNull();
    await expect(
      container.repos.inboundMessages.requireById(beta.owner.tenant, row.id),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('never lists another tenant’s messages', async () => {
    const employee = await addEmployee(alpha);
    const { row } = await record({ fromPhoneE164: employee.phoneE164 });
    await container.uow.transaction((tx) =>
      container.repos.inboundMessages.markProcessed(tx, row.id, {
        status: 'ACCEPTED',
        organizationId: alpha.organizationId,
      }),
    );

    const page = await container.repos.inboundMessages.list(beta.owner.tenant, { limit: 50 });
    expect(page.items).toHaveLength(0);

    const own = await container.repos.inboundMessages.list(alpha.owner.tenant, { limit: 50 });
    expect(own.items.map((m) => m.id)).toContain(row.id);
  });

  it('filters the operator view down to unresolved messages', async () => {
    const employee = await addEmployee(alpha);
    const accepted = await record({ fromPhoneE164: employee.phoneE164 });
    const rejected = await record({ fromPhoneE164: employee.phoneE164 });

    await container.uow.transaction(async (tx) => {
      await container.repos.inboundMessages.markProcessed(tx, accepted.row.id, {
        status: 'ACCEPTED',
        organizationId: alpha.organizationId,
      });
      await container.repos.inboundMessages.markProcessed(tx, rejected.row.id, {
        status: 'REJECTED_POLICY',
        organizationId: alpha.organizationId,
        rejectionReason: 'Above the employee’s ceiling',
      });
    });

    const unresolved = await container.repos.inboundMessages.list(alpha.owner.tenant, {
      unresolvedOnly: true,
      limit: 50,
    });
    expect(unresolved.items.map((m) => m.id)).toEqual([rejected.row.id]);
  });

  it('counts recent messages from one number', async () => {
    const phone = nextPhone();
    await record({ fromPhoneE164: phone });
    await record({ fromPhoneE164: phone });
    const since = new Date(Date.now() - 60_000);
    expect(await container.repos.inboundMessages.countRecentFromPhone(phone, since)).toBe(2);
  });
});

describe('request template repository', () => {
  it('creates the row from the migration defaults on first read', async () => {
    expect(await container.repos.requestTemplates.find(alpha.owner.tenant)).toBeNull();

    const template = await container.uow.transaction((tx) =>
      container.repos.requestTemplates.ensure(tx, alpha.owner.tenant),
    );
    expect(template.templateVersion).toBe(1);
    expect(template.heading).toContain('Approval requested');
  });

  it('bumps the version on every edit', async () => {
    await container.uow.transaction((tx) =>
      container.repos.requestTemplates.ensure(tx, alpha.owner.tenant),
    );
    const edited = await container.uow.transaction((tx) =>
      container.repos.requestTemplates.update(tx, alpha.owner.tenant, {
        heading: 'Extra work approval',
        paymentNote: 'Billed with the next running account bill',
      }),
    );

    expect(edited.heading).toBe('Extra work approval');
    expect(edited.paymentNote).toBe('Billed with the next running account bill');
    expect(edited.templateVersion).toBe(2);
    expect(edited.updatedByUserId).toBe(alpha.ownerUserId);
  });

  it('does not read or write another tenant’s template', async () => {
    await container.uow.transaction((tx) =>
      container.repos.requestTemplates.update(tx, alpha.owner.tenant, { heading: 'Alpha copy' }),
    );

    expect(await container.repos.requestTemplates.find(beta.owner.tenant)).toBeNull();

    // Beta editing its own template creates Beta's row and leaves Alpha's alone.
    const betaTemplate = await container.uow.transaction((tx) =>
      container.repos.requestTemplates.update(tx, beta.owner.tenant, { heading: 'Beta copy' }),
    );
    expect(betaTemplate.organizationId).toBe(beta.organizationId);

    const alphaTemplate = await container.repos.requestTemplates.find(alpha.owner.tenant);
    expect(alphaTemplate?.heading).toBe('Alpha copy');
  });

  it('produces the snapshot frozen into a sent version', async () => {
    await container.uow.transaction((tx) =>
      container.repos.requestTemplates.update(tx, alpha.owner.tenant, {
        heading: 'Extra work approval',
        termsBody: 'Payable with the next bill.',
      }),
    );

    const snapshot = await container.uow.transaction((tx) =>
      container.repos.requestTemplates.snapshotFor(tx, alpha.owner.tenant),
    );

    expect(snapshot).toEqual({
      heading: 'Extra work approval',
      intro: expect.any(String),
      termsBody: 'Payable with the next bill.',
      paymentNote: null,
      footerNote: null,
      templateVersion: 2,
    });
    // The assurance language is deliberately not part of the snapshot the owner
    // controls — it lives in code and is frozen separately.
    expect(Object.keys(snapshot)).not.toContain('assurance');
  });
});

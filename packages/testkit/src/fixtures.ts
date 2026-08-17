import { randomUUID } from 'node:crypto';
import type { Container } from '@extrawork/runtime';
import type { RequestContext } from '@extrawork/application';
import type { MembershipRole } from '@extrawork/contracts';
import { actorContext } from './context.js';

/**
 * Small composable fixtures for integration and security tests.
 *
 * Distinct from `seed.ts`: the seed builds one rich demo story, these build the
 * minimum a single test needs, quickly, and let a test create *two* tenants so
 * cross-tenant negative assertions have something to cross into
 * (report §16.3, first launch blocker).
 */

export interface TenantFixture {
  organizationId: string;
  ownerUserId: string;
  owner: RequestContext;
  customerId: string;
  approverContactId: string;
  /** The approver's recorded name — a decision must be signed with it. */
  approverName: string;
  projectId: string;
  projectNumber: string;
}

export interface TenantFixtureOptions {
  name?: string;
  baselineSubtotalMinor?: number;
  baselineTaxMinor?: number;
  currency?: string;
  timezone?: string;
}

let counter = 0;

export async function createTenant(
  container: Container,
  options: TenantFixtureOptions = {},
): Promise<TenantFixture> {
  counter += 1;
  const suffix = `${counter}-${Math.random().toString(36).slice(2, 8)}`;
  const name = options.name ?? `Test Contractor ${suffix}`;

  const user = await container.uow.transaction((tx) =>
    container.repos.identity.upsertUser(tx, {
      provider: 'local',
      subject: `local|test-${suffix}`,
      email: `owner-${suffix}@example.test`,
      displayName: `Owner ${suffix}`,
    }),
  );

  const { organizationId } = await container.services.auth.createOrganization(
    user.id,
    randomUUID(),
    {
      displayName: name,
      legalName: `${name} LLP`,
      gstin: null,
      timezone: options.timezone ?? 'Asia/Kolkata',
      defaultCurrency: options.currency ?? 'INR',
    },
  );

  const owner = actorContext({ userId: user.id, organizationId, role: 'OWNER' });

  const customer = await container.services.projects.createCustomer(owner, {
    displayName: `Customer ${suffix}`,
    contacts: [
      {
        name: `Approver ${suffix}`,
        phoneE164: '+919845000000',
        email: `approver-${suffix}@example.test`,
        isDefaultApprover: true,
        authorityNote: 'Authorised to approve scope and cost.',
      },
    ],
  });

  const contacts = await container.repos.customers.listContacts(owner.tenant, customer.id);
  const approver = contacts[0];
  if (!approver) throw new Error('Fixture failed to create an approver contact');

  const subtotal = options.baselineSubtotalMinor ?? 1_000_000_00;
  const tax = options.baselineTaxMinor ?? 180_000_00;

  const project = await container.services.projects.createProject(owner, {
    customerId: customer.id,
    title: `Project ${suffix}`,
    currency: options.currency ?? 'INR',
    timezone: options.timezone ?? 'Asia/Kolkata',
    baseline: {
      subtotalMinor: subtotal,
      taxMinor: tax,
      totalMinor: subtotal + tax,
    },
    expectedCompletionDate: '2026-12-31',
    defaultApproverContactId: approver.id,
  });

  return {
    organizationId,
    ownerUserId: user.id,
    owner,
    customerId: customer.id,
    approverContactId: approver.id,
    approverName: approver.name,
    projectId: project.id,
    projectNumber: project.projectNumber,
  };
}

/** Adds a second member in a given role, for authorization-matrix tests. */
export async function addMember(
  container: Container,
  tenant: TenantFixture,
  role: MembershipRole,
  projectGrants: string[] = [],
): Promise<RequestContext> {
  counter += 1;
  const suffix = `${counter}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await container.uow.transaction(async (tx) => {
    const created = await container.repos.identity.upsertUser(tx, {
      provider: 'local',
      subject: `local|member-${suffix}`,
      email: `member-${suffix}@example.test`,
      displayName: `Member ${suffix}`,
    });
    await container.repos.organizations.addMembership(tx, {
      organizationId: tenant.organizationId,
      userId: created.id,
      role,
    });
    return created;
  });

  return actorContext({
    userId: user.id,
    organizationId: tenant.organizationId,
    role,
    projectGrants,
  });
}

export interface ChangeOrderFixtureOptions {
  title?: string;
  scheduleDeltaDays?: number;
  unitPriceMinor?: number;
  quantity?: string;
  taxRateBps?: number;
  direction?: 1 | -1;
  assuranceRequired?: 'A0' | 'A1';
  approverContactId?: string;
}

export async function createDraftChangeOrder(
  container: Container,
  tenant: TenantFixture,
  options: ChangeOrderFixtureOptions = {},
) {
  return container.services.changeOrders.create(tenant.owner, tenant.projectId, {
    type: options.direction === -1 ? 'DEDUCTION' : 'ADDITION',
    title: options.title ?? 'Extra work',
    scope: 'Scope description for the extra work recorded by this fixture.',
    reason: 'Requested by the customer on site.',
    lineItems: [
      {
        description: 'Work item',
        quantity: options.quantity ?? '1.000',
        unit: 'lot',
        unitPriceMinor: options.unitPriceMinor ?? 15_000_00,
        taxRateBps: options.taxRateBps ?? 1800,
        direction: options.direction ?? 1,
      },
    ],
    scheduleDeltaDays: options.scheduleDeltaDays ?? 2,
    approverContactId: options.approverContactId ?? tenant.approverContactId,
    assuranceRequired: options.assuranceRequired ?? 'A0',
  });
}

/** Creates a draft and sends it, returning the one-time approval token. */
export async function createSentChangeOrder(
  container: Container,
  tenant: TenantFixture,
  options: ChangeOrderFixtureOptions = {},
) {
  const changeOrder = await createDraftChangeOrder(container, tenant, options);
  const sent = await container.services.send.send(tenant.owner, changeOrder.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  const token = sent.approvalUrl.split('/r/')[1];
  if (!token) throw new Error('Send did not return a usable approval URL');
  return { changeOrder, sent, token };
}

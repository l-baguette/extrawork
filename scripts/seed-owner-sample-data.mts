#!/usr/bin/env tsx
/**
 * Fills an existing account's own organization with realistic sample data —
 * customers, employees, projects and change orders in a mix of states.
 *
 * Separate from `pnpm db:seed` (which builds its own fresh "Shree Interiors"
 * org for the primary demo) and from `seed-test-account.mts` (which attaches
 * a named tester to that existing demo org). This script is for an account
 * that already owns its *own* organization — created via sign-up and the
 * setup flow — but has nothing in it yet.
 *
 * Refuses to run against production, and refuses to add a second batch of
 * data to an organization that already has projects, so re-running it is
 * safe.
 */
import { randomUUID } from 'node:crypto';
import { loadConfig } from '@extrawork/config';
import { createContainer } from '@extrawork/runtime';
import { actorContext, publicContext } from '@extrawork/testkit';
import { sql } from 'drizzle-orm';

const EMAIL = process.env.TEST_ACCOUNT_EMAIL ?? 'test@gmail.com';
const force = process.argv.includes('--force');

const rupees = (amount: number): number => Math.round(amount * 100);
const today = () => new Date().toISOString().slice(0, 10);

const config = loadConfig();
if (config.APP_ENV === 'production') {
  process.stderr.write('Refusing to seed sample data into a production database.\n');
  process.exit(1);
}

const container = createContainer({ env: config, applicationName: 'extrawork-owner-sample-data' });

try {
  const { repos, services, uow } = container;

  const userRows = await uow.db.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE email_normalized = ${EMAIL}`,
  );
  const user = userRows.rows[0];
  if (!user) {
    process.stderr.write(
      `No user found for ${EMAIL}. Sign up (or run seed-test-account.mts) first.\n`,
    );
    process.exit(1);
  }

  const membershipRows = await uow.db.execute<{
    organization_id: string;
    role: 'OWNER' | 'ADMIN' | 'PROJECT_MANAGER' | 'FINANCE' | 'VIEWER';
    display_name: string;
  }>(
    sql`SELECT m.organization_id, m.role, o.display_name
        FROM memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ${user.id}
        ORDER BY (m.role = 'OWNER') DESC, m.created_at ASC
        LIMIT 1`,
  );
  const membership = membershipRows.rows[0];
  if (!membership) {
    process.stderr.write(
      `${EMAIL} has no organization yet. Complete the sign-up setup flow first.\n`,
    );
    process.exit(1);
  }

  const { organization_id: organizationId, role, display_name: orgName } = membership;

  const existingProjects = await repos.projects.list(
    { organizationId, userId: user.id, role, requestId: `req_seed_${randomUUID()}` },
    { limit: 1 },
  );
  if (existingProjects.items.length > 0 && !force) {
    process.stderr.write(
      `${orgName} already has projects. Pass --force to add another batch anyway.\n`,
    );
    process.exit(1);
  }

  const ctx = actorContext({ userId: user.id, organizationId, role });

  // --- Employees ---------------------------------------------------------
  const supervisor = await uow.transaction((tx) =>
    repos.employees.create(tx, ctx.tenant, {
      name: 'Manoj Yadav',
      phoneE164: '+919845077001',
      roleNote: 'Site supervisor',
      allProjects: true,
      maxRequestMinor: 5_000_000n,
      projectIds: [],
    }),
  );
  const siteEngineer = await uow.transaction((tx) =>
    repos.employees.create(tx, ctx.tenant, {
      name: 'Divya Nair',
      phoneE164: '+919845077002',
      roleNote: 'Site engineer',
      allProjects: true,
      maxRequestMinor: 2_000_000n,
      projectIds: [],
    }),
  );

  // --- Customers -----------------------------------------------------------
  const sharma = await services.projects.createCustomer(ctx, {
    displayName: 'Rohit Sharma',
    notes: 'Referred by a past customer.',
    contacts: [
      {
        name: 'Rohit Sharma',
        phoneE164: '+919845011111',
        email: 'rohit.sharma@example.com',
        isDefaultApprover: true,
        authorityNote: 'Flat owner; sole decision maker on scope and cost.',
      },
    ],
  });

  const bluePeak = await services.projects.createCustomer(ctx, {
    displayName: 'BluePeak Cafe LLP',
    legalName: 'BluePeak Hospitality LLP',
    notes: 'Commercial fit-out. Approvals via the managing partner.',
    contacts: [
      {
        name: 'Kavita Rao',
        phoneE164: '+919900223344',
        email: 'kavita@bluepeak.example',
        isDefaultApprover: true,
        authorityNote: 'Managing Partner, authorised up to INR 5,00,000 per change.',
      },
    ],
  });

  const sharmaContacts = await repos.customers.listContacts(ctx.tenant, sharma.id);
  const bluePeakContacts = await repos.customers.listContacts(ctx.tenant, bluePeak.id);
  const rohit = sharmaContacts.find((c) => c.isDefaultApprover) ?? sharmaContacts[0];
  const kavita = bluePeakContacts.find((c) => c.isDefaultApprover) ?? bluePeakContacts[0];
  if (!rohit || !kavita) throw new Error('Could not resolve approver contacts');

  // --- Projects --------------------------------------------------------------
  const flat = await services.projects.createProject(ctx, {
    customerId: sharma.id,
    title: '2BHK interior fit-out — Sobha Dream Acres, Block C',
    siteAddress: {
      line1: 'Flat 804, Block C, Sobha Dream Acres',
      line2: 'Panathur Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560103',
      country: 'IN',
    },
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    baseline: {
      subtotalMinor: rupees(1_240_000),
      taxMinor: rupees(223_200),
      totalMinor: rupees(1_463_200),
    },
    startDate: '2026-08-01',
    expectedCompletionDate: '2026-11-15',
    defaultApproverContactId: rohit.id,
  });

  const cafe = await services.projects.createProject(ctx, {
    customerId: bluePeak.id,
    title: 'BluePeak Cafe — Koramangala outlet fit-out',
    siteAddress: {
      line1: '80 Feet Road, Koramangala 4th Block',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560034',
      country: 'IN',
    },
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    baseline: {
      subtotalMinor: rupees(2_650_000),
      taxMinor: rupees(477_000),
      totalMinor: rupees(3_127_000),
    },
    startDate: '2026-08-15',
    expectedCompletionDate: '2026-10-31',
    defaultApproverContactId: kavita.id,
  });

  // --- Change orders (a mix of states) ---------------------------------------
  const wiring = await services.changeOrders.create(ctx, flat.id, {
    type: 'ADDITION',
    title: 'Additional power points for home office setup',
    scope:
      'Supply and install two additional 6A power points and one data point in the second ' +
      'bedroom for a home office, including conduit, wiring and wall finish make-good.',
    reason: 'Requested by customer after the WFH setup was finalised.',
    lineItems: [
      {
        description: 'Additional 6A power point — wiring, conduit and socket',
        quantity: '2.000',
        unit: 'point',
        unitPriceMinor: rupees(2_200),
        taxRateBps: 1800,
        direction: 1,
      },
      {
        description: 'Data point — Cat6 cabling and faceplate',
        quantity: '1.000',
        unit: 'point',
        unitPriceMinor: rupees(3_500),
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 1,
    approverContactId: rohit.id,
    assuranceRequired: 'A0',
  });
  const wiringSend = await services.send.send(ctx, wiring.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  await decideAs(wiringSend.approvalUrl, {
    type: 'APPROVE',
    signerName: 'Rohit Sharma',
    comment: 'Go ahead, thank you.',
  });

  const wardrobe = await services.changeOrders.create(ctx, flat.id, {
    type: 'ADDITION',
    title: 'Loft storage above the bedroom wardrobe',
    scope:
      'Fabricate and install a 1800 x 600 x 750 mm loft storage unit above the existing bedroom ' +
      'wardrobe in 18mm BWP plywood with laminate finish to match.',
    reason: 'Customer asked for additional storage during the site visit.',
    lineItems: [
      {
        description: 'Loft storage unit — 18mm BWP ply, laminate finish',
        quantity: '1.000',
        unit: 'unit',
        unitPriceMinor: rupees(28_500),
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 3,
    approverContactId: rohit.id,
    assuranceRequired: 'A0',
  });
  await services.send.send(ctx, wardrobe.changeOrderId, { channel: 'WHATSAPP_NATIVE_SHARE' });

  const espresso = await services.changeOrders.create(ctx, cafe.id, {
    type: 'ADDITION',
    title: 'Additional drainage for the second espresso station',
    scope:
      'Extend the floor drainage line by 5 m to serve the second espresso station, including ' +
      'core cutting, 75mm PVC line with fall and floor make-good.',
    reason: 'Second espresso station added after the equipment order.',
    lineItems: [
      {
        description: 'Drainage extension — 75mm PVC with fall and core cut',
        quantity: '5.000',
        unit: 'running m',
        unitPriceMinor: rupees(4_000),
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 2,
    approverContactId: kavita.id,
    assuranceRequired: 'A0',
  });
  const espressoSend = await services.send.send(ctx, espresso.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  await decideAs(espressoSend.approvalUrl, {
    type: 'DECLINE',
    signerName: 'Kavita Rao',
    comment: 'Not needed — rerouting to the existing line instead.',
  });

  const draft = await services.changeOrders.create(ctx, cafe.id, {
    type: 'ADDITION',
    title: 'Acoustic treatment to the seating area ceiling',
    scope:
      'Supply and install 25mm acoustic panels to the seating area ceiling to reduce ' +
      'reverberation. Area and finish to be confirmed after the acoustic walkthrough.',
    reason: 'Raised by the customer after the first trading week.',
    lineItems: [
      {
        description: 'Acoustic panel, 25mm, supply and install (provisional)',
        quantity: '15.000',
        unit: 'sq m',
        unitPriceMinor: rupees(2_100),
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 2,
    approverContactId: kavita.id,
    assuranceRequired: 'A0',
  });

  process.stdout.write(
    [
      '',
      '  Sample data added',
      '',
      `    organization: ${orgName} (${organizationId})`,
      `    owner:        ${EMAIL}`,
      `    employees:    ${supervisor.name}, ${siteEngineer.name}`,
      `    customers:    ${sharma.displayName}, ${bluePeak.displayName}`,
      `    projects:     ${flat.projectNumber} ${flat.title}`,
      `                  ${cafe.projectNumber} ${cafe.title}`,
      '    change orders:',
      `      ${wiring.number}   APPROVED`,
      `      ${wardrobe.number}   SENT (open link)`,
      `      ${espresso.number}   DECLINED`,
      `      ${draft.number}   DRAFT`,
      '',
    ].join('\n'),
  );

  async function decideAs(
    approvalUrl: string,
    input: {
      type: 'APPROVE' | 'DECLINE' | 'REQUEST_REVISION';
      signerName: string;
      comment?: string;
    },
  ): Promise<void> {
    const token = approvalUrl.split('/r/')[1];
    if (!token) throw new Error(`Could not extract a token from ${approvalUrl}`);
    const pubCtx = publicContext();
    const resolved = await services.publicApproval.resolve(token, pubCtx, undefined);
    if (!resolved.session) throw new Error('Public session was not issued on first view');
    await services.decisions.decide(
      {
        plainToken: token,
        publicSessionToken: resolved.session.token,
        input: {
          type: input.type,
          signerName: input.signerName,
          signedDate: today(),
          ...(input.comment ? { comment: input.comment } : {}),
          declarationAccepted: true,
        },
        idempotencyKey: randomUUID(),
        ifMatch: resolved.dto.etag,
      },
      pubCtx,
    );
  }
} finally {
  await container.close();
}

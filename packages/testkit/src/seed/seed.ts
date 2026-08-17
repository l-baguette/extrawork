import { randomUUID } from 'node:crypto';
import { localAuthSubject } from '@extrawork/application';
import type { Container } from '@extrawork/runtime';
import { actorContext, publicContext } from '../context.js';

/**
 * Demonstration data for local development and the E2E suite.
 *
 * Everything is created through the real application services, not by inserting
 * rows. That matters: the seeded change orders carry genuine frozen snapshots,
 * real SHA-256 digests, real approval tokens (hashed), real decisions and a
 * real audit hash chain. A demo that bypassed the domain would prove nothing
 * and would drift from the code under test.
 *
 * The scenario is a Bengaluru interior fit-out firm, matching the initial
 * vertical in report §1.1.
 */

export interface SeedResult {
  organizationId: string;
  ownerUserId: string;
  ownerEmail: string;
  projectManagerEmail: string;
  financeEmail: string;
  projects: Array<{ id: string; number: string; title: string }>;
  changeOrders: Array<{ id: string; number: string; status: string }>;
  /** Live approval links, printed once so a developer can open them. */
  openApprovalUrls: Array<{ changeNumber: string; url: string; changeOrderId: string }>;
}

const OWNER_EMAIL = 'rajesh@shreeinteriors.example';
const PM_EMAIL = 'anita@shreeinteriors.example';
const FINANCE_EMAIL = 'accounts@shreeinteriors.example';

/** Rupees -> paise, as an integer. Keeps the fixture readable. */
const rupees = (amount: number): number => Math.round(amount * 100);

export async function seed(container: Container): Promise<SeedResult> {
  const { services, repos, uow, appContext } = container;

  // --- Users -----------------------------------------------------------------
  const owner = await uow.transaction((tx) =>
    repos.identity.upsertUser(tx, {
      provider: 'local',
      subject: localAuthSubject(OWNER_EMAIL),
      email: OWNER_EMAIL,
      displayName: 'Rajesh Kumar',
    }),
  );
  const projectManager = await uow.transaction((tx) =>
    repos.identity.upsertUser(tx, {
      provider: 'local',
      subject: localAuthSubject(PM_EMAIL),
      email: PM_EMAIL,
      displayName: 'Anita Desai',
    }),
  );
  const finance = await uow.transaction((tx) =>
    repos.identity.upsertUser(tx, {
      provider: 'local',
      subject: localAuthSubject(FINANCE_EMAIL),
      email: FINANCE_EMAIL,
      displayName: 'Suresh Iyer',
    }),
  );

  // --- Organization ----------------------------------------------------------
  const { organizationId } = await services.auth.createOrganization(owner.id, randomUUID(), {
    displayName: 'Shree Interiors',
    legalName: 'Shree Interiors & Turnkey Solutions LLP',
    gstin: '29AABCS1429B1ZK',
    timezone: 'Asia/Kolkata',
    defaultCurrency: 'INR',
  });

  const ownerCtx = actorContext({ userId: owner.id, organizationId, role: 'OWNER' });

  await uow.transaction(async (tx) => {
    await repos.organizations.addMembership(tx, {
      organizationId,
      userId: projectManager.id,
      role: 'PROJECT_MANAGER',
    });
    await repos.organizations.addMembership(tx, {
      organizationId,
      userId: finance.id,
      role: 'FINANCE',
    });
    await repos.organizations.update(tx, ownerCtx.tenant, {
      contactPhone: '+918041234567',
      contactEmail: 'hello@shreeinteriors.example',
      brandPrimaryColor: '#1F6FEB',
    });
  });

  // --- Customers -------------------------------------------------------------
  const mehta = await services.projects.createCustomer(ownerCtx, {
    displayName: 'Priya Mehta',
    notes: 'Referred by Prestige Lakeside sales office.',
    contacts: [
      {
        name: 'Priya Mehta',
        phoneE164: '+919845012345',
        email: 'priya.mehta@example.com',
        isDefaultApprover: true,
        authorityNote: 'Registered flat owner; sole decision maker on scope and cost.',
      },
      {
        name: 'Vikram Mehta',
        phoneE164: '+919845067890',
        isDefaultApprover: false,
        authorityNote: 'Spouse. May be on site but is NOT authorised to approve extra cost.',
      },
    ],
  });

  const nandiCafe = await services.projects.createCustomer(ownerCtx, {
    displayName: 'Nandi Cafe Pvt Ltd',
    legalName: 'Nandi Hospitality Private Limited',
    notes: 'Commercial fit-out. All approvals via the operations head.',
    contacts: [
      {
        name: 'Farah Qureshi',
        phoneE164: '+919900112233',
        email: 'farah@nandicafe.example',
        isDefaultApprover: true,
        authorityNote: 'Operations Head, authorised up to INR 5,00,000 per change.',
      },
    ],
  });

  const mehtaContacts = await repos.customers.listContacts(ownerCtx.tenant, mehta.id);
  const nandiContacts = await repos.customers.listContacts(ownerCtx.tenant, nandiCafe.id);
  const priya = mehtaContacts.find((c) => c.isDefaultApprover) ?? mehtaContacts[0];
  const farah = nandiContacts.find((c) => c.isDefaultApprover) ?? nandiContacts[0];
  if (!priya || !farah) throw new Error('Seed could not resolve approver contacts');

  // --- Projects --------------------------------------------------------------
  const flat = await services.projects.createProject(ownerCtx, {
    customerId: mehta.id,
    title: '3BHK interior fit-out — Prestige Lakeside Habitat, Tower 4',
    siteAddress: {
      line1: 'Flat 1204, Tower 4, Prestige Lakeside Habitat',
      line2: 'Varthur Road, Gunjur',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560087',
      country: 'IN',
    },
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    baseline: {
      subtotalMinor: rupees(1_820_000),
      taxMinor: rupees(327_600),
      totalMinor: rupees(2_147_600),
    },
    startDate: '2026-06-15',
    expectedCompletionDate: '2026-10-12',
    defaultApproverContactId: priya.id,
  });

  const cafe = await services.projects.createProject(ownerCtx, {
    customerId: nandiCafe.id,
    title: 'Nandi Cafe — Indiranagar outlet fit-out',
    siteAddress: {
      line1: '100 Feet Road, Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560038',
      country: 'IN',
    },
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    baseline: {
      subtotalMinor: rupees(3_400_000),
      taxMinor: rupees(612_000),
      totalMinor: rupees(4_012_000),
    },
    startDate: '2026-07-01',
    expectedCompletionDate: '2026-09-30',
    defaultApproverContactId: farah.id,
  });

  const pmCtx = actorContext({
    userId: projectManager.id,
    organizationId,
    role: 'PROJECT_MANAGER',
    projectGrants: [flat.id, cafe.id],
  });

  const changeOrders: SeedResult['changeOrders'] = [];
  const openApprovalUrls: SeedResult['openApprovalUrls'] = [];

  // --- 1. Approved addition --------------------------------------------------
  const wiring = await services.changeOrders.create(pmCtx, flat.id, {
    type: 'ADDITION',
    title: 'Additional electrical wiring for kitchen appliances',
    scope:
      'Supply and install two new 16A dedicated circuits from the distribution board to the ' +
      'kitchen counter, including 2.5 sq mm FR copper wiring in concealed conduit, two 16A ' +
      'modular sockets with individual MCB protection, and making good of the wall chase and ' +
      'paint finish. Required for the built-in oven and the dishwasher selected after the ' +
      'original electrical layout was frozen.',
    reason: 'Requested by customer after kitchen appliance selection changed on 2026-08-02.',
    lineItems: [
      {
        description: 'Dedicated 16A circuit — wiring, conduit, MCB and socket',
        quantity: '2.000',
        unit: 'point',
        unitPriceMinor: rupees(6_500),
        taxRateBps: 1800,
        direction: 1,
      },
      {
        description: 'Wall chasing, plaster repair and paint touch-up',
        quantity: '1.000',
        unit: 'lot',
        unitPriceMinor: rupees(2_800),
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 2,
    approverContactId: priya.id,
    assuranceRequired: 'A0',
  });
  const wiringSend = await services.send.send(pmCtx, wiring.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  await decideAs(container, wiringSend.approvalUrl, {
    type: 'APPROVE',
    signerName: 'Priya Mehta',
    comment: 'Please go ahead. Confirm the oven point is on the right of the hob.',
  });
  changeOrders.push({ id: wiring.changeOrderId, number: wiring.number, status: 'APPROVED' });

  // --- 2. Approved substitution (adds and deducts in one change) -------------
  const flooring = await services.changeOrders.create(pmCtx, flat.id, {
    type: 'SUBSTITUTION',
    title: 'Master bedroom flooring changed from laminate to engineered wood',
    scope:
      'Remove the specified 8mm laminate flooring from the master bedroom scope and supply and ' +
      'install 14mm engineered oak flooring with matching skirting, including underlay and ' +
      'perimeter expansion detail. Area 21.5 sq m as measured on site.',
    reason: 'Customer selected an upgraded finish during the material walkthrough.',
    lineItems: [
      {
        description: 'Engineered oak flooring, 14mm, supply and install',
        quantity: '21.500',
        unit: 'sq m',
        unitPriceMinor: rupees(3_450),
        taxRateBps: 1800,
        direction: 1,
      },
      {
        description: 'Omit 8mm laminate flooring from original scope',
        quantity: '21.500',
        unit: 'sq m',
        unitPriceMinor: rupees(1_180),
        taxRateBps: 1800,
        direction: -1,
      },
    ],
    scheduleDeltaDays: 4,
    approverContactId: priya.id,
    assuranceRequired: 'A0',
  });
  const flooringSend = await services.send.send(pmCtx, flooring.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  await decideAs(container, flooringSend.approvalUrl, {
    type: 'APPROVE',
    signerName: 'Priya Mehta',
  });
  changeOrders.push({ id: flooring.changeOrderId, number: flooring.number, status: 'APPROVED' });

  // --- 3. Pending, awaiting a decision (a live link a developer can open) ----
  const wardrobe = await services.changeOrders.create(pmCtx, flat.id, {
    type: 'ADDITION',
    title: 'Loft storage above the guest bedroom wardrobe',
    scope:
      'Fabricate and install a 2100 x 600 x 750 mm loft storage unit above the existing guest ' +
      'bedroom wardrobe in 18mm BWP plywood with laminate finish to match, including two ' +
      'shutters on soft-close hinges and internal shelving.',
    reason: 'Customer asked for additional storage during the 12 August site visit.',
    lineItems: [
      {
        description: 'Loft storage unit — 18mm BWP ply, laminate finish, soft-close hardware',
        quantity: '1.000',
        unit: 'unit',
        unitPriceMinor: rupees(34_500),
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 3,
    approverContactId: priya.id,
    assuranceRequired: 'A0',
  });
  const wardrobeSend = await services.send.send(pmCtx, wardrobe.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  changeOrders.push({ id: wardrobe.changeOrderId, number: wardrobe.number, status: 'SENT' });
  openApprovalUrls.push({
    changeNumber: wardrobe.number,
    url: wardrobeSend.approvalUrl,
    changeOrderId: wardrobe.changeOrderId,
  });

  // --- 4. Declined -----------------------------------------------------------
  const falseCeiling = await services.changeOrders.create(pmCtx, flat.id, {
    type: 'ADDITION',
    title: 'Cove lighting in the living room false ceiling',
    scope:
      'Add a peripheral cove detail to the living room false ceiling with concealed warm-white ' +
      'LED strip, driver and dimmer, including gypsum profile and finishing.',
    reason: 'Discussed on site as an optional upgrade.',
    lineItems: [
      {
        description: 'Cove detail with concealed LED strip and dimmer',
        quantity: '11.000',
        unit: 'running m',
        unitPriceMinor: rupees(1_950),
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 2,
    approverContactId: priya.id,
    assuranceRequired: 'A0',
  });
  const ceilingSend = await services.send.send(pmCtx, falseCeiling.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  await decideAs(container, ceilingSend.approvalUrl, {
    type: 'DECLINE',
    signerName: 'Priya Mehta',
    comment: 'Not required for now, we will revisit after handover.',
  });
  changeOrders.push({
    id: falseCeiling.changeOrderId,
    number: falseCeiling.number,
    status: 'DECLINED',
  });

  // --- 5. Revision requested, then a v2 sent (exercises the version rules) ---
  const plumbing = await services.changeOrders.create(pmCtx, cafe.id, {
    type: 'ADDITION',
    title: 'Additional drainage for the second espresso station',
    scope:
      'Extend the floor drainage line by 6 m to serve the second espresso station, including ' +
      'core cutting, 75mm PVC line with fall, floor make-good and waterproofing at the ' +
      'penetration.',
    reason: 'Second espresso station added to the layout after the equipment order.',
    lineItems: [
      {
        description: 'Drainage extension — 75mm PVC with fall, core cut and waterproofing',
        quantity: '6.000',
        unit: 'running m',
        unitPriceMinor: rupees(4_200),
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 3,
    approverContactId: farah.id,
    assuranceRequired: 'A0',
  });
  const plumbingV1 = await services.send.send(pmCtx, plumbing.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  await decideAs(container, plumbingV1.approvalUrl, {
    type: 'REQUEST_REVISION',
    signerName: 'Farah Qureshi',
    comment:
      'Please split the waterproofing into a separate line and confirm whether the floor ' +
      'make-good matches the existing tile.',
  });
  // The revision creates v2 as a fresh draft; v1 is superseded and its token revoked.
  await services.changeOrders.createRevision(pmCtx, plumbing.changeOrderId);
  const plumbingV2 = await services.send.send(pmCtx, plumbing.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  changeOrders.push({
    id: plumbing.changeOrderId,
    number: plumbing.number,
    status: 'SENT (v2)',
  });
  openApprovalUrls.push({
    changeNumber: `${plumbing.number} v2`,
    url: plumbingV2.approvalUrl,
    changeOrderId: plumbing.changeOrderId,
  });

  // --- 6. Time-only change, zero commercial effect (report §4.6) -------------
  const timeOnly = await services.changeOrders.create(pmCtx, cafe.id, {
    type: 'TIME_ONLY',
    title: 'Programme extension for the delayed shopfront glazing delivery',
    scope:
      'Extend the programme by five working days. The toughened shopfront glazing delivery was ' +
      'rescheduled by the supplier. No change to price; recorded so the revised completion date ' +
      'is agreed in writing.',
    reason: 'Supplier delivery slip confirmed on 2026-08-10. No cost impact.',
    lineItems: [],
    scheduleDeltaDays: 5,
    approverContactId: farah.id,
    assuranceRequired: 'A0',
  });
  const timeOnlySend = await services.send.send(pmCtx, timeOnly.changeOrderId, {
    channel: 'WHATSAPP_NATIVE_SHARE',
  });
  await decideAs(container, timeOnlySend.approvalUrl, {
    type: 'APPROVE',
    signerName: 'Farah Qureshi',
    comment: 'Agreed, please keep the handover date updated on the tracker.',
  });
  changeOrders.push({ id: timeOnly.changeOrderId, number: timeOnly.number, status: 'APPROVED' });

  // --- 7. A draft left in progress -------------------------------------------
  const draft = await services.changeOrders.create(pmCtx, cafe.id, {
    type: 'ADDITION',
    title: 'Acoustic treatment to the mezzanine soffit',
    scope:
      'Supply and install 25mm acoustic panels to the mezzanine soffit to reduce reverberation ' +
      'in the seating area. Area and finish to be confirmed after the acoustic walkthrough.',
    reason: 'Raised by the customer after the first trading week.',
    lineItems: [
      {
        description: 'Acoustic panel, 25mm, supply and install (provisional)',
        quantity: '18.000',
        unit: 'sq m',
        unitPriceMinor: rupees(2_100),
        taxRateBps: 1800,
        direction: 1,
      },
    ],
    scheduleDeltaDays: 2,
    approverContactId: farah.id,
    assuranceRequired: 'A0',
  });
  changeOrders.push({ id: draft.changeOrderId, number: draft.number, status: 'DRAFT' });

  appContext.logger.info(
    { organizationId, projects: 2, changeOrders: changeOrders.length },
    'seed complete',
  );

  return {
    organizationId,
    ownerUserId: owner.id,
    ownerEmail: OWNER_EMAIL,
    projectManagerEmail: PM_EMAIL,
    financeEmail: FINANCE_EMAIL,
    projects: [
      { id: flat.id, number: flat.projectNumber, title: flat.title },
      { id: cafe.id, number: cafe.projectNumber, title: cafe.title },
    ],
    changeOrders,
    openApprovalUrls,
  };
}

/**
 * Walks the real customer path: resolve the link (which issues a public
 * session and records the first view), then post a decision with an
 * idempotency key, exactly as the browser does.
 */
async function decideAs(
  container: Container,
  approvalUrl: string,
  input: { type: 'APPROVE' | 'DECLINE' | 'REQUEST_REVISION'; signerName: string; comment?: string },
): Promise<void> {
  const token = approvalUrl.split('/r/')[1];
  if (!token) throw new Error(`Could not extract a token from ${approvalUrl}`);

  const ctx = publicContext();
  const resolved = await container.services.publicApproval.resolve(token, ctx, undefined);
  if (!resolved.session) throw new Error('Public session was not issued on first view');

  await container.services.decisions.decide(
    {
      plainToken: token,
      publicSessionToken: resolved.session.token,
      input: {
        type: input.type,
        signerName: input.signerName,
        ...(input.comment ? { comment: input.comment } : {}),
        declarationAccepted: true,
      },
      idempotencyKey: randomUUID(),
      ifMatch: resolved.dto.etag,
    },
    ctx,
  );
}

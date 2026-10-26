import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '@extrawork/application';
import type { StoredMediaRef } from '@extrawork/db';
import type { FetchedMedia } from '@extrawork/integrations';
import type { Container } from '@extrawork/runtime';
import {
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';

/**
 * WhatsApp as a project channel — spec 2026-10-12, D6/D7 and the "WhatsApp
 * conversation rules" — against real PostgreSQL.
 *
 * The rule with no second chance is the one from D7: the channel never guesses
 * between projects or firms. A foreman on two design firms' rosters is asked,
 * once, and nothing is filed — and no media fetched — until he answers. The
 * rest pin what the designer sees (a proposal or a note in "From WhatsApp",
 * and one notification), and that every filing can be corrected with one word.
 */

let container: Container;
let alpha: TenantFixture;
let beta: TenantFixture;
const clock = new FixedClock(new Date());
let fetchedMediaIds: string[] = [];

const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

beforeAll(() => {
  container = createTestContainer({ env: { WHATSAPP_DRIVER: 'simulator' }, clock });
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  clock.set(new Date());
  fetchedMediaIds = [];
  container.appContext.integrations.whatsapp.fetchMedia = async (
    mediaId: string,
  ): Promise<FetchedMedia> => {
    fetchedMediaIds.push(mediaId);
    return { bytes: PHOTO, mimeType: 'image/jpeg', byteSize: PHOTO.byteLength };
  };
  alpha = await createTenant(container, { name: 'Alpha Interiors' });
  beta = await createTenant(container, { name: 'Beta Builders' });
});

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+9197${String(30_000_000 + phoneCounter).slice(0, 8)}`;
}

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `wamid.channel.${messageCounter}.${Math.random().toString(36).slice(2, 8)}`;
}

async function addEmployee(tenant: TenantFixture, phoneE164: string) {
  return container.uow.transaction((tx) =>
    container.repos.employees.create(tx, tenant.owner.tenant, {
      name: 'Ramesh Patil',
      phoneE164,
      roleNote: null,
      allProjects: true,
      maxRequestMinor: null,
      projectIds: [],
    }),
  );
}

/** The fixture approver shares one number across tenants; give it its own. */
async function homeownerPhone(tenant: TenantFixture): Promise<string> {
  const phone = nextPhone();
  await container.uow.pool.query('UPDATE contacts SET phone_e164 = $1 WHERE id = $2', [
    phone,
    tenant.approverContactId,
  ]);
  return phone;
}

function send(fromPhoneE164: string, body: string, media: StoredMediaRef[] = []) {
  return container.services.intake.handleInbound({
    providerMessageId: nextMessageId(),
    fromPhoneE164,
    body,
    ...(media.length > 0 ? { media } : {}),
  });
}

function photo(mediaId: string): StoredMediaRef {
  return { mediaId, mimeType: 'image/jpeg', filename: null, caption: null };
}

async function inbound(id: string) {
  const { rows } = await container.uow.pool.query<{
    status: string;
    organization_id: string | null;
    project_id: string | null;
    change_order_id: string | null;
    document_id: string | null;
    resolved_by_inbound_message_id: string | null;
    rejection_reason: string | null;
  }>(
    `SELECT status, organization_id, project_id, change_order_id, document_id,
            resolved_by_inbound_message_id, rejection_reason
       FROM inbound_messages WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function documents(tenant: TenantFixture) {
  const { rows } = await container.uow.pool.query<{
    id: string;
    kind: string;
    body: string | null;
    source: string;
    system_key: string | null;
    deleted_at: Date | null;
    added_by_employee_id: string | null;
    added_by_contact_id: string | null;
    file_object_id: string | null;
  }>(
    `SELECT d.id, d.kind, d.body, d.source, f.system_key, d.deleted_at,
            d.added_by_employee_id, d.added_by_contact_id, d.file_object_id
       FROM project_documents d
       JOIN project_folders f ON f.id = d.folder_id
      WHERE d.organization_id = $1
      ORDER BY d.created_at, d.id`,
    [tenant.organizationId],
  );
  return rows;
}

async function notificationKinds(tenant: TenantFixture): Promise<string[]> {
  const { rows } = await container.uow.pool.query<{ kind: string }>(
    `SELECT kind FROM notifications WHERE organization_id = $1 AND user_id = $2 ORDER BY created_at`,
    [tenant.organizationId, tenant.ownerUserId],
  );
  return rows.map((r) => r.kind);
}

async function currentVersion(tenant: TenantFixture, changeOrderId: string) {
  return container.repos.changeOrders.getCurrentVersion(tenant.owner.tenant, changeOrderId);
}

describe('a number on two firms’ rosters', () => {
  it('is asked once, with the firm names, and nothing is filed yet', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    await addEmployee(beta, phone);

    const outcome = await send(phone, 'Tiles delivered to site today');

    expect(outcome.status).toBe('AWAITING_CHOICE');
    expect(outcome.organizationId).toBeNull();
    expect(outcome.reply).toContain('Which project');
    expect(outcome.reply).toContain('(Alpha Interiors)');
    expect(outcome.reply).toContain('(Beta Builders)');
    expect(await documents(alpha)).toHaveLength(0);
    expect(await documents(beta)).toHaveLength(0);
  });

  it('files the held message where the answer says, and links the two', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    const betaEmployee = await addEmployee(beta, phone);

    const held = await send(phone, 'Tiles delivered to site today');
    // Alpha's roster entry is older, so Beta is second in the list.
    const answer = await send(phone, '2');

    expect(answer.status).toBe('ANSWERED');
    expect(answer.organizationId).toBe(beta.organizationId);
    expect(answer.reply).toContain('Saved your note');

    const heldRow = await inbound(held.inboundMessageId);
    expect(heldRow).toMatchObject({
      status: 'SAVED',
      organization_id: beta.organizationId,
      project_id: beta.projectId,
      resolved_by_inbound_message_id: answer.inboundMessageId,
    });
    const filed = await documents(beta);
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      kind: 'NOTE',
      body: 'Tiles delivered to site today',
      source: 'WHATSAPP',
      system_key: 'WHATSAPP',
      added_by_employee_id: betaEmployee.id,
    });
    expect(await documents(alpha)).toHaveLength(0);
  });

  it('sticks to the chosen project for the next message', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    await addEmployee(beta, phone);
    await send(phone, 'Tiles delivered to site today');
    await send(phone, '2');

    const next = await send(phone, 'Second coat of paint done in the hall');

    expect(next.status).toBe('SAVED');
    expect(next.organizationId).toBe(beta.organizationId);
    expect(await documents(beta)).toHaveLength(2);
  });

  it('asks rather than guessing when a project code exists in both firms', async () => {
    expect(alpha.projectNumber).toBe(beta.projectNumber);
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    await addEmployee(beta, phone);

    const outcome = await send(phone, `${alpha.projectNumber} tiles delivered`);
    expect(outcome.status).toBe('AWAITING_CHOICE');

    // The code names both listed projects, so it cannot answer the question.
    const answer = await send(phone, alpha.projectNumber);
    expect(answer.status).toBe('ANSWERED');
    expect(answer.reply).toContain('Reply with a number from 1 to 2');
    expect((await inbound(outcome.inboundMessageId))?.status).toBe('AWAITING_CHOICE');
  });

  it('a project code that names one of them files it there directly', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    await container.uow.transaction((tx) =>
      container.repos.projects.create(tx, alpha.owner.tenant, {
        customerId: alpha.customerId,
        projectNumber: 'P-0777',
        title: 'Second site fit-out',
        siteAddress: null,
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        baselineSubtotalMinor: 1_000_000n,
        baselineTaxMinor: 0n,
        baselineTotalMinor: 1_000_000n,
        startDate: null,
        expectedCompletionDate: null,
        defaultApproverContactId: alpha.approverContactId,
        baselineDocumentFileId: null,
      }),
    );

    const outcome = await send(phone, 'P-777 electrician finished the conduit work');
    expect(outcome.status).toBe('SAVED');
    expect((await inbound(outcome.inboundMessageId))?.project_id).not.toBe(alpha.projectId);
  });

  it('resolves a held album with one answer and fetches its media only afterwards', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    await addEmployee(beta, phone);

    const first = await send(phone, '', [photo('album-1')]);
    const second = await send(phone, '', [photo('album-2')]);
    expect(first.status).toBe('AWAITING_CHOICE');
    expect(second.status).toBe('AWAITING_CHOICE');

    // Held means unattributed: nothing may be downloaded yet.
    await container.services.intake.storeMedia(first.inboundMessageId);
    await container.services.intake.storeMedia(second.inboundMessageId);
    expect(fetchedMediaIds).toEqual([]);

    const answer = await send(phone, '1');
    expect(answer.reply).toContain('Saved your files');
    const stored = await container.services.intake.storeMedia(answer.inboundMessageId);

    expect(stored.stored).toBe(2);
    expect(fetchedMediaIds.sort()).toEqual(['album-1', 'album-2']);
    const filed = await documents(alpha);
    expect(filed.map((d) => d.kind)).toEqual(['FILE', 'FILE']);
    expect(filed.every((d) => d.system_key === 'WHATSAPP')).toBe(true);
    const { rows } = await container.uow.pool.query<{ purpose: string; project_id: string }>(
      'SELECT purpose, project_id FROM file_objects WHERE organization_id = $1',
      [alpha.organizationId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.purpose === 'PROJECT_DOCUMENT')).toBe(true);
    expect(rows.every((r) => r.project_id === alpha.projectId)).toBe(true);
    // One notification for the batch, not one per photo.
    expect(await notificationKinds(alpha)).toEqual(['DOCUMENT_ADDED']);
    expect(await documents(beta)).toHaveLength(0);
  });
});

describe('an unanswered question', () => {
  it('expires after 30 minutes, telling the designers and the sender', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    await addEmployee(beta, phone);
    const held = await send(phone, 'Tiles delivered to site today');

    clock.advance(29 * 60_000);
    expect(await container.services.intake.expireStaleChoices()).toEqual([]);

    clock.advance(2 * 60_000);
    const replies = await container.services.intake.expireStaleChoices();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      phoneE164: phone,
      heldInboundMessageId: held.inboundMessageId,
    });
    expect(replies[0]?.reply).toContain('did not hear which project');

    expect(await inbound(held.inboundMessageId)).toMatchObject({
      status: 'REJECTED_NOT_AUTHORIZED',
      rejection_reason: 'project choice expired',
      // Two firms were on the list; it belongs to neither.
      organization_id: null,
    });
    expect(await notificationKinds(alpha)).toEqual(['WHATSAPP_ATTENTION']);
    expect(await notificationKinds(beta)).toEqual(['WHATSAPP_ATTENTION']);
    // Neither firm is shown what the sender wrote, since it was meant for one.
    const { rows } = await container.uow.pool.query<{ body: string }>(
      `SELECT body FROM notifications WHERE kind = 'WHATSAPP_ATTENTION'`,
    );
    expect(rows.every((r) => !r.body.includes('Tiles'))).toBe(true);

    // Swept once only.
    expect(await container.services.intake.expireStaleChoices()).toEqual([]);
  });

  it('a late answer is told the question expired, and files nothing', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    await addEmployee(beta, phone);
    await send(phone, 'Tiles delivered to site today');
    clock.advance(31 * 60_000);

    const late = await send(phone, '1');

    expect(late.status).toBe('ANSWERED');
    expect(late.reply).toContain('did not hear which project');
    expect(await documents(alpha)).toHaveLength(0);
    expect(await documents(beta)).toHaveLength(0);
  });
});

describe('the default routing: everything goes through the designer', () => {
  it('turns change language into a proposal awaiting review', async () => {
    const phone = nextPhone();
    const employee = await addEmployee(alpha, phone);

    const outcome = await send(phone, 'Can we add two more lights in the master bedroom');

    expect(outcome.status).toBe('ACCEPTED');
    expect(outcome.approvalUrl).toBeNull();
    expect(outcome.reply).toContain('Sent to your designer');
    expect(outcome.reply).toContain('Reply FILE');
    const version = await currentVersion(alpha, outcome.changeOrderId as string);
    expect(version?.status).toBe('DRAFT');
    expect(version?.submittedForReviewAt).not.toBeNull();
    expect(version?.reviewedAt).toBeNull();
    const { rows } = await container.uow.pool.query<{
      origin: string;
      raised_by_employee_id: string;
    }>('SELECT origin, raised_by_employee_id FROM change_order_versions WHERE id = $1', [
      version?.id,
    ]);
    expect(rows[0]).toEqual({ origin: 'WHATSAPP', raised_by_employee_id: employee.id });
    // createProposal notifies; intake must not add a second one.
    expect(await notificationKinds(alpha)).toEqual(['REQUEST_SUBMITTED']);
  });

  it('sends even a complete, priced request to the designer, not the homeowner', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);

    const outcome = await send(
      phone,
      'What: Two extra power points in the kitchen\nWhy: Client changed the layout\nCost: 15800\nDays: 2',
    );

    expect(outcome.status).toBe('ACCEPTED');
    expect(outcome.approvalUrl).toBeNull();
    const version = await currentVersion(alpha, outcome.changeOrderId as string);
    expect(version?.status).toBe('DRAFT');
    expect(version?.totalDeltaMinor).toBe(1_580_000n);
  });

  it('files plain text as a note in From WhatsApp and tells the designer once', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);

    const outcome = await send(phone, 'Plumber came, kitchen lines are done');

    expect(outcome.status).toBe('SAVED');
    expect(outcome.reply).toContain('Reply REQUEST');
    const row = await inbound(outcome.inboundMessageId);
    const filed = await documents(alpha);
    expect(filed).toHaveLength(1);
    expect(row?.document_id).toBe(filed[0]?.id);
    expect(await notificationKinds(alpha)).toEqual(['NOTE_ADDED']);
  });

  it('turns a homeowner’s change into a proposal from that contact', async () => {
    const phone = await homeownerPhone(alpha);

    const outcome = await send(phone, 'Please change the bathroom tiles to matte');

    expect(outcome.status).toBe('ACCEPTED');
    const { rows } = await container.uow.pool.query<{
      origin: string;
      submitted_by_contact_id: string;
    }>(
      `SELECT origin, submitted_by_contact_id FROM change_order_versions WHERE change_order_id = $1`,
      [outcome.changeOrderId],
    );
    expect(rows[0]).toEqual({
      origin: 'WHATSAPP',
      submitted_by_contact_id: alpha.approverContactId,
    });
  });
});

describe('the one-word correction', () => {
  it('REQUEST turns a filed note into a proposal and withdraws the note', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    const note = await send(phone, 'Two more power points near the TV unit');
    expect(note.status).toBe('SAVED');

    const corrected = await send(phone, 'request');

    expect(corrected.status).toBe('ANSWERED');
    expect(corrected.changeOrderId).not.toBeNull();
    expect(corrected.reply).toContain('Sent to your designer');
    const version = await currentVersion(alpha, corrected.changeOrderId as string);
    expect(version?.submittedForReviewAt).not.toBeNull();
    expect(await inbound(note.inboundMessageId)).toMatchObject({
      status: 'ACCEPTED',
      change_order_id: corrected.changeOrderId,
      document_id: null,
    });
    const filed = await documents(alpha);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.deleted_at).not.toBeNull();

    // Said twice, it is already a request.
    const again = await send(phone, 'request');
    expect(again.reply).toContain('already a request');
  });

  it('FILE withdraws a proposal still with the designer and files the message instead', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    const request = await send(phone, 'Can we shift the wardrobe to the left wall');

    const corrected = await send(phone, 'file');

    expect(corrected.status).toBe('ANSWERED');
    expect(corrected.reply).toContain('Saved your note');
    const version = await currentVersion(alpha, request.changeOrderId as string);
    expect(version?.status).toBe('CANCELLED');
    expect((await inbound(request.inboundMessageId))?.status).toBe('SAVED');
    const filed = await documents(alpha);
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({
      kind: 'NOTE',
      body: 'Can we shift the wardrobe to the left wall',
      deleted_at: null,
    });
  });

  it('FILE cannot withdraw a request that has already gone to the homeowner', async () => {
    await container.uow.pool.query(
      `UPDATE organizations SET request_routing = 'AUTO_SEND' WHERE id = $1`,
      [alpha.organizationId],
    );
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    const sent = await send(
      phone,
      'What: Two extra power points in the kitchen\nWhy: Client changed the layout\nCost: 15800',
    );
    expect(sent.approvalUrl).not.toBeNull();
    // A sent record is the designer's and the homeowner's: no FILE offer.
    expect(sent.reply).not.toContain('Reply FILE');

    const corrected = await send(phone, 'file');

    expect(corrected.reply).toContain('already gone past');
    expect((await currentVersion(alpha, sent.changeOrderId as string))?.status).toBe('SENT');
    expect(await documents(alpha)).toHaveLength(0);
  });

  it('says so when there is nothing to correct', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    const outcome = await send(phone, 'file');
    expect(outcome.status).toBe('ANSWERED');
    expect(outcome.reply).toContain('nothing recent');
  });
});

describe('commands', () => {
  it('answers help instead of rejecting it', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    const outcome = await send(phone, 'help');
    expect(outcome.status).toBe('ANSWERED');
    expect(outcome.reply).toContain('PROJECTS');
    expect(outcome.reply).toContain(alpha.projectNumber);
  });

  it('gives a homeowner a fresh portal link for “contracts”', async () => {
    const phone = await homeownerPhone(alpha);

    const outcome = await send(phone, 'contracts');

    expect(outcome.status).toBe('ANSWERED');
    expect(outcome.reply).toMatch(/\/p\/[A-Za-z0-9_-]+/);
    const { rows } = await container.uow.pool.query<{ created_via: string; contact_id: string }>(
      'SELECT created_via, contact_id FROM project_portal_links WHERE organization_id = $1',
      [alpha.organizationId],
    );
    expect(rows).toEqual([{ created_via: 'WHATSAPP', contact_id: alpha.approverContactId }]);
  });

  it('gives site team their open requests for “contracts” and “status”', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    const request = await send(phone, 'Can we add a skirting in the hall');
    const number = (
      await container.repos.changeOrders.requireChangeOrder(
        container.uow.db,
        alpha.owner.tenant,
        request.changeOrderId as string,
      )
    ).number;

    const contracts = await send(phone, 'contracts');
    const status = await send(phone, 'status');

    for (const reply of [contracts.reply, status.reply]) {
      expect(reply).toContain(number);
      expect(reply).toContain('with the designer');
      expect(reply).not.toMatch(/\/p\//);
    }
  });
});

describe('strangers', () => {
  it('never fetches media for an unknown number, even when asked to', async () => {
    const outcome = await send(nextPhone(), 'look at this', [photo('stranger-photo')]);
    expect(outcome.status).toBe('REJECTED_UNKNOWN_SENDER');

    const stored = await container.services.intake.storeMedia(outcome.inboundMessageId);

    expect(stored.stored).toBe(0);
    expect(fetchedMediaIds).toEqual([]);
    const { rows } = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM file_objects',
    );
    expect(rows[0]?.count).toBe('0');
  });
});

describe('a Project: line with the request typed under it', () => {
  // Found in the integration click-through: the parser runs a label on over
  // the unlabelled lines after it, so the project value swallowed the request
  // and the sender was asked which project although they had said.
  it('files under the named project and keeps the request as its description', async () => {
    const phone = nextPhone();
    await addEmployee(alpha, phone);
    await container.uow.transaction((tx) =>
      container.repos.projects.create(tx, alpha.owner.tenant, {
        customerId: alpha.customerId,
        projectNumber: 'P-0777',
        title: 'Second site fit-out',
        siteAddress: null,
        currency: 'INR',
        timezone: 'Asia/Kolkata',
        baselineSubtotalMinor: 1_000_000n,
        baselineTaxMinor: 0n,
        baselineTotalMinor: 1_000_000n,
        startDate: null,
        expectedCompletionDate: null,
        defaultApproverContactId: alpha.approverContactId,
        baselineDocumentFileId: null,
      }),
    );

    const outcome = await send(
      phone,
      `Project: ${alpha.projectNumber}\nCan we add a cove light in the master bedroom\nCost: 18500`,
    );

    expect(outcome.status).toBe('ACCEPTED');
    expect((await inbound(outcome.inboundMessageId))?.project_id).toBe(alpha.projectId);
    const version = await currentVersion(alpha, outcome.changeOrderId as string);
    expect(version?.title).toBe('Can we add a cove light in the master bedroom');
    expect(version?.totalDeltaMinor).toBe(1_850_000n);
  });
});

import { describe, expect, it } from 'vitest';
import { MembershipRoleSchema, type ChangeOrderDto } from '@extrawork/contracts';
import { isDesignerRole, roleAllows } from '@extrawork/domain';
import {
  canCloseProject,
  canInvoice,
  canPropose,
  isDesigner,
} from '../../apps/web/src/lib/role-hints.js';
import {
  composerValuesFromChange,
  reviewContextFromChange,
} from '../../apps/web/src/features/composer/from-change.js';

/**
 * The web cannot import the domain policy (lint-enforced), so it carries its
 * own hints for which controls to offer. They must never drift from the
 * policy: a hint that is too generous shows a button that fails, one that is
 * too strict hides something a person is allowed to do.
 */
describe('web role hints mirror the domain policy', () => {
  for (const role of MembershipRoleSchema.options) {
    it(`${role}`, () => {
      expect(isDesigner(role)).toBe(isDesignerRole(role));
      // The designer is whoever may edit and send (spec 2026-10-12, D4).
      expect(isDesigner(role)).toBe(roleAllows(role, 'change_order:send'));
      expect(canPropose(role)).toBe(roleAllows(role, 'change_order:propose'));
      expect(canInvoice(role)).toBe(roleAllows(role, 'change_order:invoice'));
      expect(canCloseProject(role)).toBe(roleAllows(role, 'project:close'));
    });
  }

  it('offers nothing without a role', () => {
    expect(isDesigner(null)).toBe(false);
    expect(canPropose(undefined)).toBe(false);
    expect(canInvoice(null)).toBe(false);
    expect(canCloseProject(undefined)).toBe(false);
  });
});

const ids = {
  change: '00000000-0000-4000-8000-000000000001',
  version: '00000000-0000-4000-8000-000000000002',
  project: '00000000-0000-4000-8000-000000000003',
  contact: '00000000-0000-4000-8000-000000000004',
  user: '00000000-0000-4000-8000-000000000005',
  file: '00000000-0000-4000-8000-000000000006',
  line: '00000000-0000-4000-8000-000000000007',
};

function proposal(overrides: Partial<ChangeOrderDto['currentVersion']> = {}): ChangeOrderDto {
  return {
    id: ids.change,
    projectId: ids.project,
    number: 'P-0004-R03',
    type: 'ADDITION',
    createdByUserId: ids.user,
    createdAt: '2026-10-14T05:00:00.000Z',
    versionCount: 1,
    decision: null,
    reversalOfChangeOrderId: null,
    currentVersion: {
      id: ids.version,
      changeOrderId: ids.change,
      projectId: ids.project,
      versionNumber: 1,
      status: 'DRAFT',
      title: 'Shift the wash basin',
      scopeDescription: 'Shift the wash basin two feet to the left',
      reason: null,
      room: null,
      workCategory: null,
      submission: {
        origin: 'WHATSAPP',
        submittedAt: '2026-10-14T05:00:00.000Z',
        label: 'Ramesh · Kumar Constructions',
        awaitingReview: true,
        reviewedAt: null,
        note: 'Plumber is on site tomorrow',
      },
      invoicing: null,
      type: 'ADDITION',
      currency: 'INR',
      totals: {
        subtotalDeltaMinor: 450_000,
        taxDeltaMinor: 0,
        totalDeltaMinor: 450_000,
        revisedContractTotalMinor: null,
        baselineTotalMinor: 0,
        priorApprovedDeltaMinor: 0,
        currency: 'INR',
      },
      lineItems: [
        {
          id: ids.line,
          position: 0,
          description: 'Shift the wash basin',
          quantity: '1.000',
          unit: 'lot',
          unitPriceMinor: 450_050,
          taxRateBps: 0,
          direction: 1,
          subtotalMinor: 450_050,
          taxMinor: 0,
          totalMinor: 450_050,
        },
      ],
      attachments: [
        {
          id: ids.file,
          fileObjectId: ids.file,
          filename: 'basin.jpg',
          mimeType: 'image/jpeg',
          byteSize: 1000,
          sha256: null,
          scanStatus: 'CLEAN',
          caption: null,
          position: 0,
        },
      ],
      schedule: { deltaDays: 1, revisedCompletionDate: null },
      approver: {
        contactId: ids.contact,
        name: 'Priya',
        maskedPhone: null,
        maskedEmail: null,
        authorityNote: null,
      },
      assuranceRequired: 'A1',
      canonicalSha256: null,
      canonicalizerVersion: null,
      termsVersion: null,
      sentAt: null,
      viewedAt: null,
      decidedAt: null,
      expiresAt: null,
      createdAt: '2026-10-14T05:00:00.000Z',
      updatedAt: '2026-10-14T05:00:00.000Z',
      lockVersion: 3,
      etag: `"${ids.version}:3"`,
      ...overrides,
    },
  };
}

describe('opening a server draft in the composer', () => {
  it('maps a proposal into editable form values', () => {
    const values = composerValuesFromChange(proposal());
    expect(values.scope).toBe('Shift the wash basin two feet to the left');
    // Empty strings, not null: the form's "not set" for both fields.
    expect(values.reason).toBe('');
    expect(values.room).toBe('');
    expect(values.workCategory).toBe('');
    expect(values.attachmentIds).toEqual([ids.file]);
    expect(values.approverContactId).toBe(ids.contact);
    expect(values.scheduleDeltaDays).toBe(1);
    expect(values.lineItems).toEqual([
      {
        key: ids.line,
        description: 'Shift the wash basin',
        // The stored scale is three places; "1.000" reads as a typo in a form.
        quantity: '1',
        unit: 'lot',
        unitPrice: '4500.50',
        taxRateBps: 0,
        direction: 1,
      },
    ]);
  });

  it('keeps room, type of work and a fractional quantity', () => {
    const base = proposal();
    const values = composerValuesFromChange(
      proposal({
        room: 'Master bathroom',
        workCategory: 'PLUMBING',
        lineItems: [{ ...base.currentVersion.lineItems[0]!, quantity: '2.500', direction: -1 }],
      }),
    );
    expect(values.room).toBe('Master bathroom');
    expect(values.workCategory).toBe('PLUMBING');
    expect(values.lineItems[0]?.quantity).toBe('2.5');
    expect(values.lineItems[0]?.direction).toBe(-1);
  });

  it('names who raised a request awaiting review, and how', () => {
    expect(reviewContextFromChange(proposal())).toEqual({
      number: 'P-0004-R03',
      raisedBy: 'Ramesh · Kumar Constructions',
      how: 'on WhatsApp',
      note: 'Plumber is on site tomorrow',
      attachments: [{ id: ids.file, filename: 'basin.jpg' }],
    });
  });

  it("shows no review banner on the designer's own draft", () => {
    const own = proposal({
      submission: {
        origin: 'WEB',
        submittedAt: null,
        label: null,
        awaitingReview: false,
        reviewedAt: null,
        note: null,
      },
    });
    expect(reviewContextFromChange(own)).toBeUndefined();
  });
});

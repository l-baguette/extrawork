import type { ChangeOrderDto, RequestOrigin } from '@extrawork/contracts';
import { minorToInput } from '@/lib/format';
import type { ComposerValues } from './schema';
import type { ReviewContext } from './composer';

/**
 * How a request reached the record, as a phrase that finishes "raised …"
 * (spec 2026-10-12: the designer reviews against where it came from).
 */
export const ORIGIN_HOW: Record<RequestOrigin, string> = {
  WEB: 'in the app',
  WHATSAPP: 'on WhatsApp',
  IMPORT: 'by import',
  PASTED: 'from a WhatsApp message you pasted',
  COLLABORATOR: 'in the app',
  PORTAL: 'from the homeowner portal',
};

/** The same, as a short label for a details list. */
export const ORIGIN_LABELS: Record<RequestOrigin, string> = {
  WEB: 'Web app',
  WHATSAPP: 'WhatsApp',
  IMPORT: 'Import',
  PASTED: 'Pasted WhatsApp message',
  COLLABORATOR: 'Collaborator, in the app',
  PORTAL: 'Homeowner portal',
};

/**
 * The composer's form state for a draft that already exists on the server —
 * a proposal raised on WhatsApp, by a collaborator or by the homeowner, which
 * the designer now reviews, prices and sends in the same composer they use
 * for their own requests.
 */
export function composerValuesFromChange(change: ChangeOrderDto): ComposerValues {
  const version = change.currentVersion;
  const currency = version.totals.currency;
  return {
    type: version.type,
    title: version.title,
    scope: version.scopeDescription,
    reason: version.reason ?? '',
    room: version.room ?? '',
    workCategory: version.workCategory ?? '',
    attachmentIds: version.attachments.map((a) => a.fileObjectId),
    lineItems: version.lineItems.map((line) => ({
      key: line.id,
      description: line.description,
      quantity: trimQuantity(line.quantity),
      unit: line.unit ?? '',
      unitPrice: minorToInput(Math.abs(line.unitPriceMinor), currency),
      taxRateBps: line.taxRateBps,
      direction: line.direction === -1 ? -1 : 1,
    })),
    scheduleDeltaDays: version.schedule.deltaDays,
    approverContactId: version.approver.contactId,
    expiresAt: undefined,
    assuranceRequired: version.assuranceRequired,
  };
}

/** The review banner, or undefined for the designer's own draft. */
export function reviewContextFromChange(change: ChangeOrderDto): ReviewContext | undefined {
  const submission = change.currentVersion.submission;
  if (!submission.awaitingReview) return undefined;
  return {
    number: change.number,
    raisedBy: submission.label,
    how: ORIGIN_HOW[submission.origin],
    note: submission.note,
    attachments: change.currentVersion.attachments.map((a) => ({
      id: a.fileObjectId,
      filename: a.filename,
    })),
  };
}

/** "1.000" reads as a typo in a form; the stored scale is three places. */
function trimQuantity(quantity: string): string {
  return quantity.includes('.') ? quantity.replace(/\.?0+$/, '') || '0' : quantity;
}

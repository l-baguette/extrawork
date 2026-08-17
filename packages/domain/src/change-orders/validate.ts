import { AppError, type AssuranceLevel, type ChangeType } from '@extrawork/contracts';
import {
  calculateRevisedContractTotal,
  calculateVersionTotals,
  type LineItemCalcInput,
} from '../money/totals.js';

/**
 * Domain validation for a change-order draft — report §4.6 edge cases.
 *
 * Kept out of route handlers (report §14.4) so the same rules apply to the
 * create path, the draft-update path, the preview and the send path.
 */

export interface DraftValidationInput {
  projectCurrency: string;
  currency: string;
  projectStatus: string;
  baselineTotalMinor: bigint;
  priorApprovedDeltaMinor: bigint;
  lineItems: readonly LineItemCalcInput[];
  scheduleDeltaDays: number;
  type: ChangeType;
  assuranceRequired: AssuranceLevel;
  /** Attachment scan states; a send is blocked while any is unresolved. */
  attachmentScanStatuses: readonly string[];
}

export interface DraftValidationResult {
  subtotalDeltaMinor: bigint;
  taxDeltaMinor: bigint;
  totalDeltaMinor: bigint;
  revisedContractTotalMinor: bigint;
}

export interface Blocker {
  code: string;
  message: string;
}

/**
 * Hard rules. Throws — used by create/update/send. `collectSendBlockers` is the
 * soft counterpart used by the preview to explain what still needs doing.
 */
export function validateDraft(input: DraftValidationInput): DraftValidationResult {
  if (input.currency !== input.projectCurrency) {
    throw new AppError('CURRENCY_MISMATCH', {
      details: { projectCurrency: input.projectCurrency, received: input.currency },
    });
  }
  if (input.projectStatus === 'CLOSED' || input.projectStatus === 'ARCHIVED') {
    throw new AppError('PROJECT_CLOSED');
  }
  if (input.projectStatus === 'INTEGRITY_REVIEW') {
    throw new AppError('PROJECT_INTEGRITY_REVIEW');
  }
  // Report §4.6: a zero-price time-only change is valid, so substance is
  // "lines OR schedule", not "lines".
  if (input.lineItems.length === 0 && input.scheduleDeltaDays === 0) {
    throw new AppError('EMPTY_CHANGE');
  }
  if (input.type === 'TIME_ONLY' && input.lineItems.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'A time-only change cannot carry priced line items',
    });
  }

  const totals = calculateVersionTotals(input.lineItems);
  const revisedContractTotalMinor = calculateRevisedContractTotal({
    baselineTotalMinor: input.baselineTotalMinor,
    priorApprovedDeltaMinor: input.priorApprovedDeltaMinor,
    currentVersionDeltaMinor: totals.totalDeltaMinor,
  });

  return { ...totals, revisedContractTotalMinor };
}

/**
 * Non-throwing checks for the composer preview. The send button stays disabled
 * while any blocker remains (report §6.3).
 */
export function collectSendBlockers(input: {
  lineItems: readonly LineItemCalcInput[];
  scheduleDeltaDays: number;
  attachmentScanStatuses: readonly string[];
  approverHasContactChannel: boolean;
  projectStatus: string;
  scopeLength: number;
  readOnlySubscription: boolean;
}): Blocker[] {
  const blockers: Blocker[] = [];

  if (input.lineItems.length === 0 && input.scheduleDeltaDays === 0) {
    blockers.push({
      code: 'EMPTY_CHANGE',
      message: 'Add at least one line item or a schedule impact.',
    });
  }
  if (input.scopeLength < 10) {
    blockers.push({
      code: 'SCOPE_TOO_SHORT',
      message: 'Describe the work in enough detail for the customer to recognise it.',
    });
  }
  if (!input.approverHasContactChannel) {
    blockers.push({
      code: 'APPROVER_UNREACHABLE',
      message: 'The approver needs a phone number or an email address.',
    });
  }
  // Report §13.1: block send only when a required attachment is incomplete.
  const pending = input.attachmentScanStatuses.filter(
    (s) => s === 'PENDING' || s === 'SCANNING',
  ).length;
  if (pending > 0) {
    blockers.push({
      code: 'ATTACHMENT_NOT_READY',
      message:
        pending === 1
          ? 'One photo is still being checked. This usually takes a few seconds.'
          : `${pending} photos are still being checked.`,
    });
  }
  const rejected = input.attachmentScanStatuses.filter(
    (s) => s === 'REJECTED' || s === 'FAILED',
  ).length;
  if (rejected > 0) {
    blockers.push({
      code: 'ATTACHMENT_REJECTED',
      message: 'Remove the attachment that failed the safety check.',
    });
  }
  if (input.projectStatus === 'CLOSED' || input.projectStatus === 'ARCHIVED') {
    blockers.push({ code: 'PROJECT_CLOSED', message: 'This project is closed.' });
  }
  if (input.projectStatus === 'INTEGRITY_REVIEW') {
    blockers.push({
      code: 'PROJECT_INTEGRITY_REVIEW',
      message: 'This project is under integrity review. New sends are paused.',
    });
  }
  if (input.readOnlySubscription) {
    blockers.push({
      code: 'SUBSCRIPTION_READ_ONLY',
      message: 'Your subscription is inactive. Existing records stay readable and exportable.',
    });
  }

  return blockers;
}

/**
 * Report §4.6: project currency and timezone cannot change after the first sent
 * request without an administrator migration workflow.
 */
export function assertBaselineEditable(hasSentChange: boolean): void {
  if (hasSentChange) {
    throw new AppError('BASELINE_LOCKED');
  }
}

/** Attachments cannot be removed after send; a revision is required (§4.6). */
export function assertAttachmentRemovable(versionStatus: string): void {
  if (versionStatus !== 'DRAFT') {
    throw new AppError('ATTACHMENT_IMMUTABLE');
  }
}

import { z } from 'zod';
import {
  AssuranceLevelSchema,
  DecisionTypeSchema,
  IdempotencyKeySchema,
  InstantSchema,
  LocalDateSchema,
  UuidSchema,
  VersionStatusSchema,
} from '../primitives.js';

/**
 * The public approval surface. Every field here is deliberately chosen: report
 * §5.3 requires a *minimal* projection across the public trust boundary, and
 * §6.7 lists exactly what the customer needs to decide. No internal IDs beyond
 * what the page needs, no other projects, no team data, no full phone numbers.
 */

export const PublicLineItemSchema = z.object({
  description: z.string(),
  quantity: z.string(),
  unit: z.string().nullable(),
  unitPriceMinor: z.number().int(),
  taxRateBps: z.number().int(),
  /** Signed: a deduction line renders with a minus sign (report §4.6). */
  totalMinor: z.number().int(),
});

export const PublicAttachmentSchema = z.object({
  id: UuidSchema,
  caption: z.string().nullable(),
  mimeType: z.string(),
  /** Short-lived signed URL for a sanitised, EXIF-stripped derivative. */
  url: z.string().url(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

export const PublicRequestSchema = z.object({
  /** Opaque per-view id for support, never the token. */
  requestRef: z.string(),
  status: VersionStatusSchema,
  /** True once a terminal decision exists; the UI switches to receipt mode. */
  decided: z.boolean(),
  organization: z.object({
    displayName: z.string(),
    legalName: z.string().nullable(),
    contactPhone: z.string().nullable(),
    contactEmail: z.string().nullable(),
    brandPrimaryColor: z.string().nullable(),
  }),
  project: z.object({
    title: z.string(),
    projectNumber: z.string(),
    /** City/state only — the full site address is not needed to decide. */
    siteSummary: z.string().nullable(),
  }),
  change: z.object({
    number: z.string(),
    versionNumber: z.number().int(),
    type: z.string(),
    title: z.string(),
    scope: z.string(),
    reason: z.string().nullable(),
  }),
  commercial: z.object({
    currency: z.string(),
    lineItems: z.array(PublicLineItemSchema),
    subtotalDeltaMinor: z.number().int(),
    taxDeltaMinor: z.number().int(),
    totalDeltaMinor: z.number().int(),
    baselineTotalMinor: z.number().int(),
    priorApprovedDeltaMinor: z.number().int(),
    revisedContractTotalMinor: z.number().int(),
  }),
  schedule: z.object({
    deltaDays: z.number().int(),
    revisedCompletionDate: LocalDateSchema.nullable(),
  }),
  attachments: z.array(PublicAttachmentSchema),
  approver: z.object({
    name: z.string(),
    maskedContact: z.string(),
  }),
  assurance: z.object({
    required: AssuranceLevelSchema,
    /** What this session has actually achieved so far. */
    achieved: AssuranceLevelSchema,
    label: z.string(),
    summary: z.string(),
    limitation: z.string(),
    /** True when the customer must verify by OTP before deciding. */
    verificationRequired: z.boolean(),
  }),
  declarations: z.object({
    approve: z.string(),
    decline: z.string(),
    requestRevision: z.string(),
    disclaimer: z.string(),
  }),
  expiresAt: InstantSchema,
  sentAt: InstantSchema,
  /** Concurrency tag the decision POST must echo in `If-Match`. */
  etag: z.string(),
  /**
   * The double-submit CSRF value for this public session, echoed by the client
   * in `X-CSRF-Token` on every mutating public call.
   *
   * Returned in the body rather than read from `document.cookie`: the session
   * cookies are scoped to `/public` on the API host, which the approval page —
   * served from a different path and, in production, a different host — cannot
   * read. An attacker's origin still cannot obtain this value, because CORS
   * prevents them from reading the response at all.
   */
  csrfToken: z.string().nullable(),
  /** Present only when a decision has already been recorded. */
  receipt: z
    .object({
      receiptId: z.string(),
      type: DecisionTypeSchema,
      signerName: z.string(),
      occurredAt: InstantSchema,
      assuranceAchieved: AssuranceLevelSchema,
    })
    .nullable(),
});
export type PublicRequestDto = z.infer<typeof PublicRequestSchema>;

export const DecisionInputSchema = z
  .object({
    type: DecisionTypeSchema,
    /** Typed name is the assent artefact at A0 (report §3.3). */
    signerName: z.string().trim().min(2).max(120),
    comment: z.string().trim().max(2_000).optional(),
    /** Must be explicitly true — never pre-selected in the UI (report §6.7). */
    declarationAccepted: z.boolean(),
    idempotencyKey: IdempotencyKeySchema.optional(),
  })
  .refine((v) => v.declarationAccepted === true, {
    message: 'You must confirm the declaration to record a decision',
    path: ['declarationAccepted'],
  })
  .refine((v) => v.type !== 'REQUEST_REVISION' || Boolean(v.comment?.trim()), {
    message: 'Tell the contractor what needs to change',
    path: ['comment'],
  });
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

export const DecisionReceiptSchema = z.object({
  receiptId: z.string(),
  decisionId: UuidSchema,
  type: DecisionTypeSchema,
  signerName: z.string(),
  occurredAt: InstantSchema,
  assuranceAchieved: AssuranceLevelSchema,
  assuranceLabel: z.string(),
  assuranceLimitation: z.string(),
  changeNumber: z.string(),
  versionNumber: z.number().int(),
  organizationName: z.string(),
  projectTitle: z.string(),
  currency: z.string(),
  totalDeltaMinor: z.number().int(),
  revisedContractTotalMinor: z.number().int(),
  /** Token for `/public/v1/receipts/{receiptToken}`; shown once at decision. */
  receiptToken: z.string().nullable(),
  /** Null until the worker has produced the pack (report §13.1). */
  evidenceStatus: z.enum(['PENDING', 'GENERATING', 'READY', 'FAILED']),
  evidenceUrl: z.string().url().nullable(),
});
export type DecisionReceiptDto = z.infer<typeof DecisionReceiptSchema>;

export const OtpRequestSchema = z.object({
  /** Echoed back so the UI can show which number was used, already masked. */
  channel: z.literal('SMS').default('SMS'),
});

export const OtpChallengeSchema = z.object({
  challengeId: UuidSchema,
  maskedDestination: z.string(),
  expiresAt: InstantSchema,
  resendAvailableAt: InstantSchema,
  attemptsRemaining: z.number().int(),
});

export const OtpVerifySchema = z.object({
  challengeId: UuidSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const OtpVerifyResultSchema = z.object({
  verified: z.boolean(),
  assuranceAchieved: AssuranceLevelSchema,
  attemptsRemaining: z.number().int(),
});

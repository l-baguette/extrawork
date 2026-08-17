import { z } from 'zod';
import {
  AssuranceLevelSchema,
  ChangeTypeSchema,
  CursorSchema,
  InstantSchema,
  LimitSchema,
  LocalDateSchema,
  LongTextSchema,
  MediumTextSchema,
  ShortTextSchema,
  UuidSchema,
  VersionStatusSchema,
} from '../primitives.js';
import {
  AttachmentSchema,
  AuditEventSchema,
  ChangeOrderSchema,
  ChangeOrderSummarySchema,
  LineItemInputSchema,
  TotalsSchema,
} from './common.js';

/**
 * A change must carry commercial or schedule substance. Report §4.6 allows a
 * zero-price time-only change, so the rule is "lines OR schedule impact",
 * not "lines".
 */
const hasSubstance = (v: { lineItems: unknown[]; scheduleDeltaDays: number }) =>
  v.lineItems.length > 0 || v.scheduleDeltaDays !== 0;

export const CreateChangeOrderSchema = z
  .object({
    type: ChangeTypeSchema,
    title: ShortTextSchema,
    scope: LongTextSchema,
    reason: MediumTextSchema.optional(),
    lineItems: z.array(LineItemInputSchema).max(100).default([]),
    scheduleDeltaDays: z.number().int().min(-365).max(365).default(0),
    approverContactId: UuidSchema,
    expiresAt: InstantSchema.optional(),
    assuranceRequired: AssuranceLevelSchema.default('A0'),
  })
  .refine(hasSubstance, {
    message: 'Add at least one line item or a schedule impact',
    path: ['lineItems'],
  });
export type CreateChangeOrderInput = z.infer<typeof CreateChangeOrderSchema>;

/**
 * Draft update replaces the whole editable payload. Partial patching of line
 * arrays is ambiguous under concurrent edits, so the client always sends the
 * full intended state together with `If-Match`.
 */
export const UpdateDraftSchema = z
  .object({
    type: ChangeTypeSchema,
    title: ShortTextSchema,
    scope: LongTextSchema,
    reason: MediumTextSchema.nullable().optional(),
    lineItems: z.array(LineItemInputSchema).max(100),
    scheduleDeltaDays: z.number().int().min(-365).max(365),
    approverContactId: UuidSchema,
    expiresAt: InstantSchema.nullable().optional(),
    assuranceRequired: AssuranceLevelSchema,
  })
  .refine(hasSubstance, {
    message: 'Add at least one line item or a schedule impact',
    path: ['lineItems'],
  });
export type UpdateDraftInput = z.infer<typeof UpdateDraftSchema>;

/**
 * Preview is a server calculation, never a client one (ADR-005). The send
 * button stays disabled until this call succeeds (report §6.3).
 */
export const PreviewSchema = z.object({
  totals: TotalsSchema,
  revisedCompletionDate: LocalDateSchema.nullable(),
  /** Exactly what the customer will see, rendered from the same projection. */
  customerView: z.object({
    organizationName: z.string(),
    projectTitle: z.string(),
    changeNumber: z.string(),
    versionNumber: z.number().int(),
    title: z.string(),
    scope: z.string(),
    lineItems: z.array(
      z.object({
        description: z.string(),
        quantity: z.string(),
        unit: z.string().nullable(),
        unitPriceMinor: z.number().int(),
        taxRateBps: z.number().int(),
        totalMinor: z.number().int(),
      }),
    ),
    attachmentCount: z.number().int(),
    scheduleDeltaDays: z.number().int(),
    assuranceRequired: AssuranceLevelSchema,
    approverName: z.string(),
    approverMaskedContact: z.string(),
  }),
  /** Blocking reasons the UI must resolve before send becomes available. */
  blockers: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
    }),
  ),
});
export type PreviewDto = z.infer<typeof PreviewSchema>;

export const SendChangeOrderSchema = z.object({
  /**
   * `WHATSAPP_NATIVE_SHARE` records intent only — the contractor sends the
   * message from their own phone (report §10.3). `WHATSAPP` asks the system to
   * deliver it, which is how a request raised over WhatsApp intake reaches the
   * customer; it requires a gateway that can actually deliver.
   */
  channel: z
    .enum(['WHATSAPP_NATIVE_SHARE', 'WHATSAPP', 'EMAIL', 'COPY_LINK'])
    .default('WHATSAPP_NATIVE_SHARE'),
  expiresAt: InstantSchema.optional(),
  messageNote: MediumTextSchema.optional(),
});
export type SendChangeOrderInput = z.infer<typeof SendChangeOrderSchema>;

export const SendResultSchema = z.object({
  changeOrderId: UuidSchema,
  versionId: UuidSchema,
  versionNumber: z.number().int(),
  status: VersionStatusSchema,
  /** Full approval URL. Returned exactly once; only the hash is stored. */
  approvalUrl: z.string().url(),
  expiresAt: InstantSchema,
  canonicalSha256: z.string(),
  share: z.object({
    /** `https://wa.me/...` deep link for the native share step. */
    whatsappUrl: z.string().url().nullable(),
    smsUrl: z.string().nullable(),
    mailtoUrl: z.string().nullable(),
    messageText: z.string(),
  }),
});
export type SendResultDto = z.infer<typeof SendResultSchema>;

/** Records that the contractor actually opened the share sheet (report §10.3). */
export const ShareIntentSchema = z.object({
  channel: z.enum(['WHATSAPP_NATIVE_SHARE', 'EMAIL', 'COPY_LINK', 'SMS']),
});

export const CreateRevisionSchema = z.object({
  reason: MediumTextSchema.optional(),
});

export const CancelChangeOrderSchema = z.object({
  reason: MediumTextSchema,
});

export const RemindSchema = z.object({
  channel: z.enum(['WHATSAPP_NATIVE_SHARE', 'EMAIL']).default('WHATSAPP_NATIVE_SHARE'),
});

export const RemindResultSchema = z.object({
  messageText: z.string(),
  whatsappUrl: z.string().url().nullable(),
  mailtoUrl: z.string().nullable(),
  approvalUrl: z.string().url().nullable(),
  cooldownUntil: InstantSchema.nullable(),
});

export const RegisterAttachmentSchema = z.object({
  fileObjectId: UuidSchema,
  caption: z.string().trim().max(200).optional(),
});

export const ListChangeOrdersQuerySchema = z.object({
  projectId: UuidSchema.optional(),
  customerId: UuidSchema.optional(),
  status: VersionStatusSchema.optional(),
  /** Convenience buckets used by the dashboard cards. */
  bucket: z.enum(['PENDING', 'DECIDED', 'EXPIRING', 'DRAFT']).optional(),
  query: z.string().trim().max(200).optional(),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});

export const ChangeOrderVersionListSchema = z.object({
  versions: z.array(
    z.object({
      id: UuidSchema,
      versionNumber: z.number().int(),
      status: VersionStatusSchema,
      totalDeltaMinor: z.number().int(),
      scheduleDeltaDays: z.number().int(),
      sentAt: InstantSchema.nullable(),
      decidedAt: InstantSchema.nullable(),
      canonicalSha256: z.string().nullable(),
    }),
  ),
});

export const EvidenceDocumentSchema = z.object({
  id: UuidSchema,
  versionId: UuidSchema,
  status: z.enum(['PENDING', 'GENERATING', 'READY', 'FAILED']),
  templateVersion: z.string(),
  rendererVersion: z.string().nullable(),
  fileSha256: z.string().nullable(),
  generatedAt: InstantSchema.nullable(),
  /** Short-lived signed URL; null until the document is READY. */
  downloadUrl: z.string().url().nullable(),
  manifestSha256: z.string().nullable(),
});
export type EvidenceDocumentDto = z.infer<typeof EvidenceDocumentSchema>;

export const ChangeOrderEventsSchema = z.object({
  events: z.array(AuditEventSchema),
  /** False when the chain failed verification; the UI must warn, not hide it. */
  chainValid: z.boolean(),
});
export type ChangeOrderEventsDto = z.infer<typeof ChangeOrderEventsSchema>;

export { AttachmentSchema, ChangeOrderSchema, ChangeOrderSummarySchema };

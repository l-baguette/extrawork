import { z } from 'zod';
import {
  AssuranceLevelSchema,
  ChangeTypeSchema,
  CurrencySchema,
  InstantSchema,
  LocalDateSchema,
  MoneySchema,
  QuantitySchema,
  TaxRateBpsSchema,
  UuidSchema,
  VersionStatusSchema,
} from '../primitives.js';

/**
 * Projections shared by several endpoints. Keeping them here means the API, the
 * worker, the PDF template and the web client all agree on shape, and the
 * OpenAPI document is generated from exactly what the routes return.
 */

export const TotalsSchema = z.object({
  subtotalDeltaMinor: z.number().int(),
  taxDeltaMinor: z.number().int(),
  totalDeltaMinor: z.number().int(),
  /** Null while the version is a draft with no computed projection yet. */
  revisedContractTotalMinor: z.number().int().nullable(),
  baselineTotalMinor: z.number().int(),
  priorApprovedDeltaMinor: z.number().int(),
  currency: CurrencySchema,
});
export type TotalsDto = z.infer<typeof TotalsSchema>;

export const LineItemInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: QuantitySchema,
  unit: z.string().trim().max(24).optional(),
  /** Always non-negative; the sign of a line comes from `direction`. */
  unitPriceMinor: z.number().int().min(0),
  taxRateBps: TaxRateBpsSchema.default(0),
  /** +1 adds to the contract, -1 deducts from it (report §8.1). */
  direction: z.union([z.literal(1), z.literal(-1)]).default(1),
});
export type LineItemInput = z.infer<typeof LineItemInputSchema>;

export const LineItemSchema = LineItemInputSchema.extend({
  id: UuidSchema,
  position: z.number().int().min(0),
  subtotalMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
});
export type LineItemDto = z.infer<typeof LineItemSchema>;

export const AttachmentSchema = z.object({
  id: UuidSchema,
  fileObjectId: UuidSchema,
  filename: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().min(0),
  sha256: z.string().nullable(),
  scanStatus: z.enum(['PENDING', 'SCANNING', 'CLEAN', 'REJECTED', 'FAILED']),
  caption: z.string().nullable(),
  position: z.number().int().min(0),
});
export type AttachmentDto = z.infer<typeof AttachmentSchema>;

export const ScheduleSchema = z.object({
  deltaDays: z.number().int(),
  revisedCompletionDate: LocalDateSchema.nullable(),
});

export const ApproverSchema = z.object({
  contactId: UuidSchema,
  name: z.string(),
  /** Masked for any surface that does not need the full number (report §12.3). */
  maskedPhone: z.string().nullable(),
  maskedEmail: z.string().nullable(),
  authorityNote: z.string().nullable(),
});

export const ChangeOrderVersionSchema = z.object({
  id: UuidSchema,
  changeOrderId: UuidSchema,
  projectId: UuidSchema,
  versionNumber: z.number().int().min(1),
  status: VersionStatusSchema,
  title: z.string(),
  scopeDescription: z.string(),
  reason: z.string().nullable(),
  type: ChangeTypeSchema,
  currency: CurrencySchema,
  totals: TotalsSchema,
  lineItems: z.array(LineItemSchema),
  attachments: z.array(AttachmentSchema),
  schedule: ScheduleSchema,
  approver: ApproverSchema,
  assuranceRequired: AssuranceLevelSchema,
  canonicalSha256: z.string().nullable(),
  canonicalizerVersion: z.string().nullable(),
  termsVersion: z.string().nullable(),
  sentAt: InstantSchema.nullable(),
  viewedAt: InstantSchema.nullable(),
  decidedAt: InstantSchema.nullable(),
  expiresAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  lockVersion: z.number().int().min(1),
  /** Concurrency tag echoed back in `If-Match` (report §7.2, §4.5). */
  etag: z.string(),
});
export type ChangeOrderVersionDto = z.infer<typeof ChangeOrderVersionSchema>;

export const DecisionSchema = z.object({
  id: UuidSchema,
  type: z.enum(['APPROVE', 'DECLINE', 'REQUEST_REVISION']),
  signerName: z.string(),
  signerComment: z.string().nullable(),
  assuranceAchieved: AssuranceLevelSchema,
  verifiedPhoneMasked: z.string().nullable(),
  occurredAt: InstantSchema,
  receiptId: z.string(),
});
export type DecisionDto = z.infer<typeof DecisionSchema>;

export const ChangeOrderSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  number: z.string(),
  type: ChangeTypeSchema,
  createdByUserId: UuidSchema,
  createdAt: InstantSchema,
  currentVersion: ChangeOrderVersionSchema,
  versionCount: z.number().int().min(1),
  decision: DecisionSchema.nullable(),
  reversalOfChangeOrderId: UuidSchema.nullable(),
});
export type ChangeOrderDto = z.infer<typeof ChangeOrderSchema>;

export const ChangeOrderSummarySchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  projectTitle: z.string(),
  customerName: z.string(),
  number: z.string(),
  title: z.string(),
  type: ChangeTypeSchema,
  status: VersionStatusSchema,
  versionNumber: z.number().int(),
  totalDeltaMinor: z.number().int(),
  currency: CurrencySchema,
  scheduleDeltaDays: z.number().int(),
  sentAt: InstantSchema.nullable(),
  decidedAt: InstantSchema.nullable(),
  expiresAt: InstantSchema.nullable(),
  updatedAt: InstantSchema,
});
export type ChangeOrderSummaryDto = z.infer<typeof ChangeOrderSummarySchema>;

export const AuditEventSchema = z.object({
  id: UuidSchema,
  sequence: z.number().int(),
  eventType: z.string(),
  actorType: z.enum(['USER', 'CUSTOMER', 'SYSTEM', 'SUPPORT', 'PROVIDER']),
  actorLabel: z.string().nullable(),
  occurredAt: InstantSchema,
  summary: z.string(),
  eventHash: z.string(),
  previousHash: z.string().nullable(),
});
export type AuditEventDto = z.infer<typeof AuditEventSchema>;

export const MoneyOut = MoneySchema;

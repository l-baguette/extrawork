import { z } from 'zod';
import { InstantSchema, LocalDateSchema, UuidSchema } from '../primitives.js';

export const ReportQuerySchema = z.object({
  from: LocalDateSchema.optional(),
  to: LocalDateSchema.optional(),
  projectId: UuidSchema.optional(),
  customerId: UuidSchema.optional(),
  createdByUserId: UuidSchema.optional(),
  status: z.enum(['APPROVED', 'DECLINED', 'PENDING', 'ALL']).default('APPROVED'),
});
export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export const ExtraWorkReportRowSchema = z.object({
  changeOrderId: UuidSchema,
  number: z.string(),
  versionNumber: z.number().int(),
  projectId: UuidSchema,
  projectNumber: z.string(),
  projectTitle: z.string(),
  customerName: z.string(),
  title: z.string(),
  status: z.string(),
  currency: z.string(),
  subtotalDeltaMinor: z.number().int(),
  taxDeltaMinor: z.number().int(),
  totalDeltaMinor: z.number().int(),
  scheduleDeltaDays: z.number().int(),
  sentAt: InstantSchema.nullable(),
  decidedAt: InstantSchema.nullable(),
  decisionType: z.string().nullable(),
  assuranceAchieved: z.string().nullable(),
  createdBy: z.string(),
});
export type ExtraWorkReportRow = z.infer<typeof ExtraWorkReportRowSchema>;

export const ExtraWorkReportSchema = z.object({
  rows: z.array(ExtraWorkReportRowSchema),
  totals: z.object({
    currency: z.string(),
    count: z.number().int(),
    subtotalDeltaMinor: z.number().int(),
    taxDeltaMinor: z.number().int(),
    totalDeltaMinor: z.number().int(),
  }),
  generatedAt: InstantSchema,
});
export type ExtraWorkReportDto = z.infer<typeof ExtraWorkReportSchema>;

/**
 * Accounting hand-off model (report §10.5). Provider adapters map this to Zoho
 * or Tally; MVP emits CSV. `unitRateMinor` is a string so a JSON consumer can
 * never widen it into a float.
 */
export const ApprovedChangeExportSchema = z.object({
  externalCustomerRef: z.string().nullable(),
  projectRef: z.string(),
  changeNumber: z.string(),
  approvedAt: InstantSchema,
  currency: z.string(),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.string(),
      unitRateMinor: z.string(),
      taxRateBps: z.number().int(),
      totalMinor: z.string(),
    }),
  ),
});
export type ApprovedChangeExport = z.infer<typeof ApprovedChangeExportSchema>;

export const CreateEvidencePackSchema = z.object({
  /** Empty means every approved change on the project. */
  changeOrderIds: z.array(UuidSchema).max(200).default([]),
  includeAttachments: z.boolean().default(true),
});

export const ExportJobSchema = z.object({
  id: UuidSchema,
  kind: z.enum(['PROJECT_EVIDENCE_PACK', 'ORGANIZATION_EXPORT', 'ACCOUNTING_CSV']),
  status: z.enum(['PENDING', 'RUNNING', 'READY', 'FAILED']),
  requestedAt: InstantSchema,
  completedAt: InstantSchema.nullable(),
  downloadUrl: z.string().url().nullable(),
  manifestSha256: z.string().nullable(),
  error: z.string().nullable(),
});
export type ExportJobDto = z.infer<typeof ExportJobSchema>;

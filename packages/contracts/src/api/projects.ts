import { z } from 'zod';
import {
  CurrencySchema,
  CursorSchema,
  InstantSchema,
  LimitSchema,
  LocalDateSchema,
  MediumTextSchema,
  ProjectStatusSchema,
  ShortTextSchema,
  TimezoneSchema,
  UuidSchema,
} from '../primitives.js';
import { ChangeOrderSummarySchema } from './common.js';

export const AddressSchema = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().length(2).default('IN'),
});
export type AddressDto = z.infer<typeof AddressSchema>;

/**
 * Baseline is captured once at project creation. The subtotal/tax/total must be
 * internally consistent — the database enforces the same rule as a CHECK.
 */
export const BaselineInputSchema = z
  .object({
    subtotalMinor: z.number().int().min(0),
    taxMinor: z.number().int().min(0),
    totalMinor: z.number().int().min(0),
  })
  .refine(
    (b) => b.totalMinor === b.subtotalMinor + b.taxMinor,
    'Baseline total must equal subtotal plus tax',
  );
export type BaselineInput = z.infer<typeof BaselineInputSchema>;

export const CreateProjectSchema = z.object({
  customerId: UuidSchema,
  title: ShortTextSchema,
  siteAddress: AddressSchema.optional(),
  currency: CurrencySchema.default('INR'),
  timezone: TimezoneSchema.default('Asia/Kolkata'),
  baseline: BaselineInputSchema,
  startDate: LocalDateSchema.optional(),
  expectedCompletionDate: LocalDateSchema.optional(),
  /** Contact authorised to approve changes; must belong to the customer. */
  defaultApproverContactId: UuidSchema,
  /** Optional original quotation/contract, already uploaded and scanned. */
  baselineDocumentFileId: UuidSchema.optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

/**
 * Currency and timezone are absent by design: report §4.6 forbids changing them
 * after the first sent request without an administrator migration workflow.
 */
export const UpdateProjectSchema = z
  .object({
    title: ShortTextSchema,
    siteAddress: AddressSchema.nullable(),
    status: ProjectStatusSchema.exclude(['INTEGRITY_REVIEW', 'CLOSED', 'ARCHIVED']),
    startDate: LocalDateSchema.nullable(),
    expectedCompletionDate: LocalDateSchema.nullable(),
    defaultApproverContactId: UuidSchema,
  })
  .partial();

/**
 * After the first send the baseline can only move through an explicit,
 * audited amendment (report §4.1).
 */
export const BaselineAmendmentSchema = z.object({
  baseline: BaselineInputSchema,
  reason: MediumTextSchema,
  effectiveDate: LocalDateSchema.optional(),
  supportingFileId: UuidSchema.optional(),
});
export type BaselineAmendmentInput = z.infer<typeof BaselineAmendmentSchema>;

export const ProjectTotalsSchema = z.object({
  currency: CurrencySchema,
  baselineSubtotalMinor: z.number().int(),
  baselineTaxMinor: z.number().int(),
  baselineTotalMinor: z.number().int(),
  approvedDeltaMinor: z.number().int(),
  revisedTotalMinor: z.number().int(),
  pendingDeltaMinor: z.number().int(),
  approvedChangeCount: z.number().int(),
  pendingChangeCount: z.number().int(),
  approvedScheduleDeltaDays: z.number().int(),
});
export type ProjectTotalsDto = z.infer<typeof ProjectTotalsSchema>;

export const ProjectSchema = z.object({
  id: UuidSchema,
  organizationId: UuidSchema,
  customerId: UuidSchema,
  customerName: z.string(),
  projectNumber: z.string(),
  title: z.string(),
  siteAddress: AddressSchema.nullable(),
  status: ProjectStatusSchema,
  currency: CurrencySchema,
  timezone: z.string(),
  totals: ProjectTotalsSchema,
  startDate: LocalDateSchema.nullable(),
  expectedCompletionDate: LocalDateSchema.nullable(),
  revisedCompletionDate: LocalDateSchema.nullable(),
  defaultApproverContactId: UuidSchema.nullable(),
  baselineDocumentFileId: UuidSchema.nullable(),
  /** False once any version has been sent; drives the baseline-lock rule. */
  baselineEditable: z.boolean(),
  hasSentChange: z.boolean(),
  closedAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  lockVersion: z.number().int(),
});
export type ProjectDto = z.infer<typeof ProjectSchema>;

export const ProjectSummarySchema = z.object({
  id: UuidSchema,
  projectNumber: z.string(),
  title: z.string(),
  customerId: UuidSchema,
  customerName: z.string(),
  status: ProjectStatusSchema,
  currency: CurrencySchema,
  baselineTotalMinor: z.number().int(),
  approvedDeltaMinor: z.number().int(),
  revisedTotalMinor: z.number().int(),
  pendingChangeCount: z.number().int(),
  updatedAt: InstantSchema,
});
export type ProjectSummaryDto = z.infer<typeof ProjectSummarySchema>;

export const ListProjectsQuerySchema = z.object({
  status: ProjectStatusSchema.optional(),
  customerId: UuidSchema.optional(),
  query: z.string().trim().max(200).optional(),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});

export const ChangeRegisterSchema = z.object({
  project: ProjectSummarySchema,
  totals: ProjectTotalsSchema,
  changes: z.array(ChangeOrderSummarySchema),
});
export type ChangeRegisterDto = z.infer<typeof ChangeRegisterSchema>;

export const CloseProjectSchema = z.object({
  reason: MediumTextSchema.optional(),
});

export const DashboardSchema = z.object({
  currency: CurrencySchema,
  pendingDecisions: z.number().int(),
  overdueOrExpiring: z.number().int(),
  approvedValueThisMonthMinor: z.number().int(),
  averageHoursToDecision: z.number().nullable(),
  projectsWithUnbilledApprovedExtras: z.number().int(),
  recentDecisions: z.array(ChangeOrderSummarySchema),
  awaitingDecision: z.array(ChangeOrderSummarySchema),
});
export type DashboardDto = z.infer<typeof DashboardSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const SearchResultsSchema = z.object({
  customers: z.array(
    z.object({ id: UuidSchema, displayName: z.string(), snippet: z.string().nullable() }),
  ),
  projects: z.array(
    z.object({
      id: UuidSchema,
      projectNumber: z.string(),
      title: z.string(),
      customerName: z.string(),
    }),
  ),
  changes: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      title: z.string(),
      projectId: UuidSchema,
      projectTitle: z.string(),
      status: z.string(),
    }),
  ),
});
export type SearchResultsDto = z.infer<typeof SearchResultsSchema>;

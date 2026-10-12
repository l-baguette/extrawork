import { z } from 'zod';
import {
  CurrencySchema,
  FolderVisibilitySchema,
  InstantSchema,
  LocalDateSchema,
  LongTextSchema,
  MediumTextSchema,
  MilestoneKindSchema,
  RoomSchema,
  UuidSchema,
  VersionStatusSchema,
  WorkCategorySchema,
} from '../primitives.js';
import { ContractHistoryEntrySchema } from './projects.js';

/**
 * The homeowner portal — spec 2026-10-12, D5.
 *
 * A read-only window onto one project for one customer contact, opened from a
 * private link with no account. It shows everything the homeowner has been
 * asked to decide and everything the designer chose to share with them, and
 * nothing else: no drafts, no proposals still with the designer, no internal
 * folders, no other customer's data.
 */

export const CreatePortalLinkSchema = z.object({
  /** Defaults to the project's approver. Must be a contact of the project's customer. */
  contactId: UuidSchema.optional(),
  /** 1–365 days; defaults to 90. */
  validDays: z.number().int().min(1).max(365).default(90),
});

export const PortalLinkSchema = z.object({
  id: UuidSchema,
  contactId: UuidSchema,
  contactName: z.string(),
  createdVia: z.enum(['WEB', 'WHATSAPP']),
  expiresAt: InstantSchema,
  revokedAt: InstantSchema.nullable(),
  lastViewedAt: InstantSchema.nullable(),
  viewCount: z.number().int(),
  createdAt: InstantSchema,
});
export type PortalLinkDto = z.infer<typeof PortalLinkSchema>;

export const PortalLinkCreatedSchema = z.object({
  link: PortalLinkSchema,
  /** Full URL, returned once. */
  portalUrl: z.string().url(),
  whatsappShareUrl: z.string().url().nullable(),
  messageText: z.string(),
});
export type PortalLinkCreatedDto = z.infer<typeof PortalLinkCreatedSchema>;

export const PortalLinkListSchema = z.object({
  items: z.array(PortalLinkSchema),
});

// --- Public projection --------------------------------------------------------

export const PortalRequestSchema = z.object({
  id: UuidSchema,
  number: z.string(),
  versionNumber: z.number().int(),
  title: z.string(),
  scope: z.string(),
  room: z.string().nullable(),
  workCategory: WorkCategorySchema.nullable(),
  status: VersionStatusSchema,
  totalDeltaMinor: z.number().int(),
  scheduleDeltaDays: z.number().int(),
  sentAt: InstantSchema.nullable(),
  decidedAt: InstantSchema.nullable(),
  /** Present while the homeowner can still act on it from the portal. */
  actionable: z.boolean(),
  /** True when an evidence pack is ready to download. */
  evidenceReady: z.boolean(),
});
export type PortalRequestDto = z.infer<typeof PortalRequestSchema>;

export const PortalDocumentSchema = z.object({
  id: UuidSchema,
  folderName: z.string(),
  folderVisibility: FolderVisibilitySchema,
  kind: z.enum(['FILE', 'LINK', 'NOTE']),
  title: z.string(),
  url: z.string().nullable(),
  body: z.string().nullable(),
  mimeType: z.string().nullable(),
  byteSize: z.number().int().nullable(),
  createdAt: InstantSchema,
});
export type PortalDocumentDto = z.infer<typeof PortalDocumentSchema>;

export const PortalViewSchema = z.object({
  organizationName: z.string(),
  contactName: z.string(),
  project: z.object({
    number: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    city: z.string().nullable(),
    status: z.string(),
    startDate: LocalDateSchema.nullable(),
    expectedCompletionDate: LocalDateSchema.nullable(),
    revisedCompletionDate: LocalDateSchema.nullable(),
  }),
  contract: z.object({
    currency: CurrencySchema,
    originalTotalMinor: z.number().int(),
    approvedDeltaMinor: z.number().int(),
    currentTotalMinor: z.number().int(),
    pendingDeltaMinor: z.number().int(),
    history: z.array(ContractHistoryEntrySchema),
  }),
  requests: z.array(PortalRequestSchema),
  documents: z.array(PortalDocumentSchema),
  milestones: z.array(
    z.object({
      id: UuidSchema,
      title: z.string(),
      kind: MilestoneKindSchema,
      dueDate: LocalDateSchema,
      completedAt: InstantSchema.nullable(),
    }),
  ),
  expiresAt: InstantSchema,
});
export type PortalViewDto = z.infer<typeof PortalViewSchema>;

/** The homeowner asks for a change from the portal. Becomes a proposal. */
export const PortalChangeRequestSchema = z.object({
  description: LongTextSchema,
  room: RoomSchema.optional(),
  workCategory: WorkCategorySchema.optional(),
  reason: MediumTextSchema.optional(),
});
export type PortalChangeRequestInput = z.infer<typeof PortalChangeRequestSchema>;

export const PortalChangeRequestResultSchema = z.object({
  number: z.string(),
  message: z.string(),
});

export const PortalDownloadSchema = z.object({
  downloadUrl: z.string().url(),
  filename: z.string(),
});

import { z } from 'zod';

/**
 * Wire-level primitive schemas shared by the API, the worker and the web app.
 * Report §7.2: camelCase JSON, ISO-8601 UTC instants, YYYY-MM-DD local dates,
 * money as `{ amountMinor, currency }`, quantity as a decimal string.
 */

export const UuidSchema = z.string().uuid();

/** ISO-4217 alpha code. Storage and APIs keep the code even though MVP is INR. */
export const CurrencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Currency must be a three-letter ISO 4217 code');

/**
 * Minor units as a JSON number. Safe because JSON numbers are IEEE-754 doubles
 * and these are integers well inside 2^53; the *database* column is bigint and
 * every arithmetic step in the domain uses bigint. Never a fractional value.
 */
export const AmountMinorSchema = z
  .number()
  .int('Money must be a whole number of minor units (paise)')
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

export const MoneySchema = z.object({
  amountMinor: AmountMinorSchema,
  currency: CurrencySchema,
});
export type MoneyDto = z.infer<typeof MoneySchema>;

/**
 * Quantity travels as a decimal string, never a float (report §6.3).
 * Up to 3 decimal places to match `numeric(18,3)`.
 */
export const QuantitySchema = z
  .string()
  .regex(/^-?\d{1,15}(\.\d{1,3})?$/, 'Quantity must be a decimal string with at most 3 decimals')
  .refine((v) => Number(v) !== 0, 'Quantity cannot be zero');

/** Basis points: 1800 = 18%. */
export const TaxRateBpsSchema = z.number().int().min(0).max(10_000, 'Tax rate cannot exceed 100%');

export const InstantSchema = z
  .string()
  .datetime({ offset: true })
  .describe('ISO 8601 instant in UTC');

export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real calendar date');

/**
 * E.164. Ten-digit Indian input is normalised client- and server-side before it
 * reaches this schema (report §2.2, §9.5).
 */
export const PhoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format, for example +919876543210');

export const EmailSchema = z.string().email().max(320);

export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA timezone');

export const ShortTextSchema = z.string().trim().min(1).max(200);
export const MediumTextSchema = z.string().trim().min(1).max(2_000);
export const LongTextSchema = z.string().trim().min(1).max(20_000);

export const IdempotencyKeySchema = z.string().min(8).max(200);

export const CursorSchema = z.string().min(1).max(500);
export const LimitSchema = z.coerce.number().int().min(1).max(100).default(20);

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

// --- Domain enums (mirrored from the PostgreSQL enums in §9.3) -------------

export const MembershipRoleSchema = z.enum([
  'OWNER',
  'ADMIN',
  'PROJECT_MANAGER',
  'FINANCE',
  'VIEWER',
  // Someone from another firm (or the homeowner) working on specific projects
  // in this workspace. Never organization-wide; sees only granted projects.
  'COLLABORATOR',
]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const ProjectStatusSchema = z.enum([
  'ACTIVE',
  'ON_HOLD',
  'CLOSED',
  'ARCHIVED',
  'INTEGRITY_REVIEW',
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ChangeTypeSchema = z.enum(['ADDITION', 'DEDUCTION', 'SUBSTITUTION', 'TIME_ONLY']);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const VersionStatusSchema = z.enum([
  'DRAFT',
  'SENT',
  'VIEWED',
  'REVISION_REQUESTED',
  'APPROVED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'SUPERSEDED',
]);
export type VersionStatus = z.infer<typeof VersionStatusSchema>;

export const DecisionTypeSchema = z.enum(['APPROVE', 'DECLINE', 'REQUEST_REVISION']);
export type DecisionType = z.infer<typeof DecisionTypeSchema>;

export const AssuranceLevelSchema = z.enum(['A0', 'A1', 'A2']);
export type AssuranceLevel = z.infer<typeof AssuranceLevelSchema>;

export const ActorTypeSchema = z.enum(['USER', 'CUSTOMER', 'SYSTEM', 'SUPPORT', 'PROVIDER']);
export type ActorType = z.infer<typeof ActorTypeSchema>;

// --- Three-party workspace (spec 2026-10-12) ------------------------------

/** Which party a collaborator represents on a project. */
export const CollaboratorPartySchema = z.enum([
  'CONSTRUCTION',
  'ARCHITECT',
  'CONSULTANT',
  'HOMEOWNER',
  'OTHER',
]);
export type CollaboratorParty = z.infer<typeof CollaboratorPartySchema>;

export const COLLABORATOR_PARTY_LABELS: Record<CollaboratorParty, string> = {
  CONSTRUCTION: 'Construction company',
  ARCHITECT: 'Architecture firm',
  CONSULTANT: 'Consultant',
  HOMEOWNER: 'Homeowner',
  OTHER: 'Other',
};

/** Which firm a site-team member belongs to, relative to this workspace. */
export const TeamPartySchema = z.enum([
  'INTERNAL',
  'CONSTRUCTION',
  'ARCHITECT',
  'CONSULTANT',
  'OTHER',
]);
export type TeamParty = z.infer<typeof TeamPartySchema>;

export const TeamRoleSchema = z.enum([
  'SITE_SUPERVISOR',
  'FOREMAN',
  'CONTRACTOR',
  'DESIGNER',
  'WORKER',
  'OTHER',
]);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  SITE_SUPERVISOR: 'Site supervisor',
  FOREMAN: 'Foreman',
  CONTRACTOR: 'Contractor',
  DESIGNER: 'Designer',
  WORKER: 'Site worker',
  OTHER: 'Other',
};

export const BusinessTypeSchema = z.enum([
  'DESIGN_FIRM',
  'ARCHITECTURE_FIRM',
  'DESIGN_AND_BUILD',
  'CONSTRUCTION',
  'SPECIALIST_CONTRACTOR',
  'OTHER',
]);
export type BusinessType = z.infer<typeof BusinessTypeSchema>;

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  DESIGN_FIRM: 'Interior design firm',
  ARCHITECTURE_FIRM: 'Architecture firm',
  DESIGN_AND_BUILD: 'Design-and-build / turnkey',
  CONSTRUCTION: 'Construction company',
  SPECIALIST_CONTRACTOR: 'Specialist contractor',
  OTHER: 'Other',
};

/** Spec D3. */
export const RequestRoutingSchema = z.enum(['DESIGNER_REVIEW', 'AUTO_SEND']);
export type RequestRouting = z.infer<typeof RequestRoutingSchema>;

/** Type of work on a request. Mirrors the CHECK in migration 0021. */
export const WorkCategorySchema = z.enum([
  'CIVIL',
  'DEMOLITION',
  'PLUMBING',
  'ELECTRICAL',
  'CARPENTRY',
  'MODULAR_KITCHEN',
  'FALSE_CEILING',
  'FLOORING',
  'PAINTING',
  'WATERPROOFING',
  'HVAC',
  'FABRICATION',
  'GLASS_ALUMINIUM',
  'FURNITURE',
  'RENOVATION',
  'DESIGN_CHANGE',
  'OTHER',
]);
export type WorkCategory = z.infer<typeof WorkCategorySchema>;

export const WORK_CATEGORY_LABELS: Record<WorkCategory, string> = {
  CIVIL: 'Civil & masonry',
  DEMOLITION: 'Demolition',
  PLUMBING: 'Plumbing & sanitary',
  ELECTRICAL: 'Electrical & lighting',
  CARPENTRY: 'Carpentry & woodwork',
  MODULAR_KITCHEN: 'Modular kitchen & wardrobes',
  FALSE_CEILING: 'False ceiling',
  FLOORING: 'Flooring & tiling',
  PAINTING: 'Painting & polish',
  WATERPROOFING: 'Waterproofing',
  HVAC: 'Air-conditioning & ventilation',
  FABRICATION: 'Fabrication & metalwork',
  GLASS_ALUMINIUM: 'Glass & aluminium',
  FURNITURE: 'Furniture & furnishing',
  RENOVATION: 'General renovation',
  DESIGN_CHANGE: 'Design change',
  OTHER: 'Other',
};

/** Free entry is allowed; these are the suggestions offered in the picker. */
export const ROOM_SUGGESTIONS = [
  'Whole home',
  'Living room',
  'Dining',
  'Kitchen',
  'Master bedroom',
  'Bedroom 2',
  'Bedroom 3',
  "Kids' bedroom",
  'Guest bedroom',
  'Master bathroom',
  'Common bathroom',
  'Powder room',
  'Pooja room',
  'Study',
  'Foyer',
  'Passage',
  'Balcony',
  'Utility',
  'Terrace',
  'Exterior',
] as const;

export const RoomSchema = z.string().trim().min(1).max(80);

/** Where a request came from (migration 0021). */
export const RequestOriginSchema = z.enum([
  'WEB',
  'WHATSAPP',
  'IMPORT',
  'PASTED',
  'COLLABORATOR',
  'PORTAL',
]);
export type RequestOrigin = z.infer<typeof RequestOriginSchema>;

export const FolderVisibilitySchema = z.enum(['INTERNAL', 'PROJECT', 'CLIENT']);
export type FolderVisibility = z.infer<typeof FolderVisibilitySchema>;

export const FOLDER_VISIBILITY_LABELS: Record<FolderVisibility, string> = {
  INTERNAL: 'Your firm only',
  PROJECT: 'Firm and collaborators',
  CLIENT: 'Everyone, including the homeowner',
};

export const FolderSystemKeySchema = z.enum(['PLANS', 'CONTRACTS', 'PHOTOS', 'BILLS', 'WHATSAPP']);
export type FolderSystemKey = z.infer<typeof FolderSystemKeySchema>;

/** The folders every project starts with, in display order. */
export const DEFAULT_PROJECT_FOLDERS: ReadonlyArray<{
  systemKey: FolderSystemKey;
  name: string;
  visibility: FolderVisibility;
}> = [
  { systemKey: 'PLANS', name: 'Plans & drawings', visibility: 'CLIENT' },
  { systemKey: 'CONTRACTS', name: 'Contracts & quotes', visibility: 'CLIENT' },
  { systemKey: 'PHOTOS', name: 'Site photos', visibility: 'PROJECT' },
  { systemKey: 'BILLS', name: 'Bills & invoices', visibility: 'INTERNAL' },
  { systemKey: 'WHATSAPP', name: 'From WhatsApp', visibility: 'PROJECT' },
];

export const DocumentKindSchema = z.enum(['FILE', 'LINK', 'NOTE']);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

export const MilestoneKindSchema = z.enum([
  'MILESTONE',
  'SITE_VISIT',
  'DELIVERY',
  'HANDOVER',
  'PAYMENT',
  'OTHER',
]);
export type MilestoneKind = z.infer<typeof MilestoneKindSchema>;

export const MILESTONE_KIND_LABELS: Record<MilestoneKind, string> = {
  MILESTONE: 'Milestone',
  SITE_VISIT: 'Site visit',
  DELIVERY: 'Delivery',
  HANDOVER: 'Handover',
  PAYMENT: 'Payment',
  OTHER: 'Other',
};

/** User-facing role names. PROJECT_MANAGER is the designer leading projects. */
export const MEMBERSHIP_ROLE_LABELS: Record<MembershipRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  PROJECT_MANAGER: 'Designer',
  FINANCE: 'Accounts',
  VIEWER: 'Viewer',
  COLLABORATOR: 'Collaborator',
};

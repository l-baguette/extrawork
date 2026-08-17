import { z } from 'zod';
import {
  CurrencySchema,
  EmailSchema,
  InstantSchema,
  MembershipRoleSchema,
  ShortTextSchema,
  TimezoneSchema,
  UuidSchema,
} from '../primitives.js';

/** GSTIN: 2-digit state, 10-char PAN, entity digit, Z, checksum. */
export const GstinSchema = z
  .string()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/, 'Not a valid 15-character GSTIN');

export const CreateOrganizationSchema = z.object({
  displayName: ShortTextSchema,
  legalName: ShortTextSchema.optional(),
  gstin: GstinSchema.optional(),
  timezone: TimezoneSchema.default('Asia/Kolkata'),
  defaultCurrency: CurrencySchema.default('INR'),
});
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;

export const UpdateOrganizationSchema = z
  .object({
    displayName: ShortTextSchema,
    legalName: ShortTextSchema.nullable(),
    gstin: GstinSchema.nullable(),
    timezone: TimezoneSchema,
    retentionMonths: z.number().int().min(1).max(120),
    brandPrimaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #1F6FEB')
      .nullable(),
    contactPhone: z.string().max(20).nullable(),
    contactEmail: EmailSchema.nullable(),
    /** Hours after send at which reminders fire (report §8.6). */
    reminderPolicyHours: z.array(z.number().int().min(1).max(720)).max(4),
  })
  .partial();
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationSchema>;

export const EntitlementsSchema = z.object({
  activeProjects: z.number().int(),
  completedDecisionsPerPeriod: z.number().int(),
  teamMembers: z.number().int(),
  automatedWhatsApp: z.boolean(),
  otpApprovals: z.boolean(),
  customBranding: z.boolean(),
  retentionMonths: z.number().int(),
});
export type EntitlementsDto = z.infer<typeof EntitlementsSchema>;

export const SubscriptionSchema = z.object({
  planCode: z.enum(['TRIAL', 'STARTER_MONTHLY', 'PROJECT_PASS', 'PRO_MONTHLY']),
  status: z.enum(['TRIALING', 'ACTIVE', 'GRACE', 'LAPSED', 'CANCELLED']),
  currentPeriodStart: InstantSchema,
  currentPeriodEnd: InstantSchema,
  graceEndsAt: InstantSchema.nullable(),
  /** Report §8.7: a lapse never hides evidence, it stops new sends. */
  readOnly: z.boolean(),
  entitlements: EntitlementsSchema,
  usage: z.object({
    activeProjects: z.number().int(),
    completedDecisionsThisPeriod: z.number().int(),
    teamMembers: z.number().int(),
  }),
});
export type SubscriptionDto = z.infer<typeof SubscriptionSchema>;

export const OrganizationSchema = z.object({
  id: UuidSchema,
  displayName: z.string(),
  legalName: z.string().nullable(),
  gstin: z.string().nullable(),
  timezone: z.string(),
  defaultCurrency: CurrencySchema,
  retentionMonths: z.number().int(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
  brandPrimaryColor: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  reminderPolicyHours: z.array(z.number().int()),
  createdAt: InstantSchema,
  subscription: SubscriptionSchema,
});
export type OrganizationDto = z.infer<typeof OrganizationSchema>;

export const MembershipSchema = z.object({
  userId: UuidSchema,
  organizationId: UuidSchema,
  displayName: z.string(),
  email: z.string(),
  role: MembershipRoleSchema,
  status: z.enum(['ACTIVE', 'INVITED', 'REVOKED']),
  createdAt: InstantSchema,
});
export type MembershipDto = z.infer<typeof MembershipSchema>;

export const InviteMembershipSchema = z.object({
  email: EmailSchema,
  displayName: ShortTextSchema,
  /** Ownership is transferred through a dedicated re-authenticated command. */
  role: MembershipRoleSchema.exclude(['OWNER']),
});
export type InviteMembershipInput = z.infer<typeof InviteMembershipSchema>;

export const UpdateMembershipSchema = z.object({
  role: MembershipRoleSchema.exclude(['OWNER']),
});

export const CurrentUserSchema = z.object({
  user: z.object({
    id: UuidSchema,
    email: z.string(),
    displayName: z.string(),
  }),
  memberships: z.array(
    z.object({
      organizationId: UuidSchema,
      organizationName: z.string(),
      role: MembershipRoleSchema,
    }),
  ),
  activeOrganizationId: UuidSchema.nullable(),
});
export type CurrentUserDto = z.infer<typeof CurrentUserSchema>;

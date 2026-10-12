import { z } from 'zod';
import {
  CollaboratorPartySchema,
  EmailSchema,
  InstantSchema,
  MembershipRoleSchema,
  ShortTextSchema,
  UuidSchema,
} from '../primitives.js';

/**
 * Collaborators and invitations — spec 2026-10-12, D1 and D2.
 *
 * A collaborator is someone from another firm (or the homeowner) with an
 * account, working on specific projects in this workspace. The site team —
 * people identified only by their WhatsApp number — is `employees.ts`.
 */

export const InviteCollaboratorSchema = z.object({
  email: EmailSchema,
  displayName: ShortTextSchema.optional(),
  party: CollaboratorPartySchema,
  companyName: ShortTextSchema.optional(),
  /**
   * Optional WhatsApp number. When given, the person is also added to the
   * project's site team so they can send requests and files by message.
   */
  phone: z.string().trim().min(4).max(32).optional(),
  message: z.string().trim().max(1_000).optional(),
});
export type InviteCollaboratorInput = z.infer<typeof InviteCollaboratorSchema>;

export const InvitationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']);

export const InvitationSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  email: z.string(),
  displayName: z.string().nullable(),
  party: CollaboratorPartySchema,
  companyName: z.string().nullable(),
  status: InvitationStatusSchema,
  invitedByName: z.string().nullable(),
  expiresAt: InstantSchema,
  createdAt: InstantSchema,
});
export type InvitationDto = z.infer<typeof InvitationSchema>;

/**
 * Returned once, when the invitation is created: the full link exists only in
 * this response and in the email, never in the database (hash only).
 */
export const InvitationCreatedSchema = z.object({
  invitation: InvitationSchema,
  inviteUrl: z.string().url(),
  /** `https://wa.me/?text=...` so the designer can send it from their phone. */
  whatsappShareUrl: z.string().url(),
  /** True when the person was also added to the WhatsApp site team. */
  addedToSiteTeam: z.boolean(),
});
export type InvitationCreatedDto = z.infer<typeof InvitationCreatedSchema>;

/** Someone with access to a project, from inside or outside the firm. */
export const ProjectPersonSchema = z.object({
  userId: UuidSchema,
  displayName: z.string(),
  email: z.string(),
  role: MembershipRoleSchema,
  /** Null for the firm's own staff. */
  party: CollaboratorPartySchema.nullable(),
  companyName: z.string().nullable(),
  /** True for OWNER/ADMIN/FINANCE, who see every project without a grant. */
  orgWide: z.boolean(),
  joinedAt: InstantSchema,
});
export type ProjectPersonDto = z.infer<typeof ProjectPersonSchema>;

export const ProjectCollaboratorsSchema = z.object({
  people: z.array(ProjectPersonSchema),
  invitations: z.array(InvitationSchema),
});
export type ProjectCollaboratorsDto = z.infer<typeof ProjectCollaboratorsSchema>;

/** What an invitee sees before accepting. Public: holds no private detail. */
export const InvitationPreviewSchema = z.object({
  organizationName: z.string(),
  projectTitle: z.string(),
  projectNumber: z.string(),
  invitedByName: z.string().nullable(),
  party: CollaboratorPartySchema,
  /** Masked, so a forwarded link does not disclose the full address. */
  emailMasked: z.string(),
  status: InvitationStatusSchema,
  expiresAt: InstantSchema,
});
export type InvitationPreviewDto = z.infer<typeof InvitationPreviewSchema>;

export const AcceptInvitationSchema = z.object({
  token: z.string().min(16).max(200),
});

export const AcceptedInvitationSchema = z.object({
  organizationId: UuidSchema,
  projectId: UuidSchema,
});
export type AcceptedInvitationDto = z.infer<typeof AcceptedInvitationSchema>;

/** Invitations addressed to the signed-in user's email, across workspaces. */
export const PendingInvitationSchema = z.object({
  id: UuidSchema,
  organizationName: z.string(),
  projectTitle: z.string(),
  party: CollaboratorPartySchema,
  invitedByName: z.string().nullable(),
  expiresAt: InstantSchema,
});
export const PendingInvitationListSchema = z.object({
  items: z.array(PendingInvitationSchema),
});
export type PendingInvitationDto = z.infer<typeof PendingInvitationSchema>;

/** Accept from the in-app list, where the session's email already proves the match. */
export const AcceptPendingInvitationSchema = z.object({
  invitationId: UuidSchema,
});

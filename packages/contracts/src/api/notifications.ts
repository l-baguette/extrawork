import { z } from 'zod';
import {
  CursorSchema,
  InstantSchema,
  LimitSchema,
  LocalDateSchema,
  UuidSchema,
} from '../primitives.js';

/**
 * Notifications, the calendar and the homeowner portal — spec 2026-10-12,
 * D5 and D14.
 */

export const NotificationKindSchema = z.enum([
  /** A site-team member, collaborator or homeowner raised a request for review. */
  'REQUEST_SUBMITTED',
  /** The designer sent a proposal to the homeowner (tells the submitter). */
  'REQUEST_SENT',
  /** The designer declined a proposal without sending it (tells the submitter). */
  'REQUEST_DISMISSED',
  'DECISION_RECORDED',
  'DOCUMENT_ADDED',
  'NOTE_ADDED',
  'COLLABORATOR_JOINED',
  'MILESTONE_DUE',
  'COMPLETION_DUE',
  /** A WhatsApp message could not be filed (unknown project, expired choice). */
  'WHATSAPP_ATTENTION',
]);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const NotificationSchema = z.object({
  id: UuidSchema,
  kind: NotificationKindSchema,
  title: z.string(),
  body: z.string().nullable(),
  /** A path inside the web app, e.g. `/app/changes/{id}`. */
  linkPath: z.string().nullable(),
  projectId: UuidSchema.nullable(),
  actorLabel: z.string().nullable(),
  createdAt: InstantSchema,
  readAt: InstantSchema.nullable(),
});
export type NotificationDto = z.infer<typeof NotificationSchema>;

export const ListNotificationsQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});

export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int(),
});
export type NotificationListDto = z.infer<typeof NotificationListSchema>;

export const MarkNotificationsReadSchema = z.union([
  z.object({ ids: z.array(UuidSchema).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

/** Unread counts for every workspace the signed-in user belongs to. */
export const NotificationSummarySchema = z.object({
  workspaces: z.array(z.object({ organizationId: UuidSchema, unreadCount: z.number().int() })),
});
export type NotificationSummaryDto = z.infer<typeof NotificationSummarySchema>;

export const NotificationPreferencesSchema = z.object({
  emailEnabled: z.boolean(),
  completionReminders: z.boolean(),
  reminderLeadDays: z.number().int().min(0).max(30),
});
export type NotificationPreferencesDto = z.infer<typeof NotificationPreferencesSchema>;

// --- Calendar -----------------------------------------------------------------

export const CalendarEventKindSchema = z.enum([
  'PROJECT_START',
  'PROJECT_COMPLETION',
  /** Expected completion moved by approved schedule changes. */
  'PROJECT_REVISED_COMPLETION',
  'MILESTONE',
  /** A request waiting on the homeowner whose link expires on this date. */
  'APPROVAL_EXPIRES',
  'DECISION',
]);
export type CalendarEventKind = z.infer<typeof CalendarEventKindSchema>;

export const CalendarEventSchema = z.object({
  id: z.string(),
  kind: CalendarEventKindSchema,
  date: LocalDateSchema,
  title: z.string(),
  detail: z.string().nullable(),
  projectId: UuidSchema,
  projectNumber: z.string(),
  projectTitle: z.string(),
  linkPath: z.string(),
  completed: z.boolean(),
});
export type CalendarEventDto = z.infer<typeof CalendarEventSchema>;

export const CalendarQuerySchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
  projectId: UuidSchema.optional(),
});

export const CalendarSchema = z.object({
  from: LocalDateSchema,
  to: LocalDateSchema,
  events: z.array(CalendarEventSchema),
});
export type CalendarDto = z.infer<typeof CalendarSchema>;

export const CalendarFeedSchema = z.object({
  /** Returned once on creation; afterwards only `active` is known. */
  feedUrl: z.string().url().nullable(),
  active: z.boolean(),
  createdAt: InstantSchema.nullable(),
});
export type CalendarFeedDto = z.infer<typeof CalendarFeedSchema>;

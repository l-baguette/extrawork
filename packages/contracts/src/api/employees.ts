import { z } from 'zod';
import {
  AmountMinorSchema,
  CursorSchema,
  InstantSchema,
  LimitSchema,
  PhoneE164Schema,
  ShortTextSchema,
  UuidSchema,
} from '../primitives.js';

/**
 * Employees, request templates and the inbound message log — the owner-facing
 * surface of the WhatsApp intake channel (migration 0005).
 */

export const EmployeeStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;

/**
 * `phone` is the employee's whole identity — there is no login. It is accepted
 * in whatever form the owner types it and normalised to E.164 server-side, so
 * the same person entered as `98765 43210` or `+91 98765 43210` is one row.
 */
export const CreateEmployeeSchema = z.object({
  name: ShortTextSchema,
  phone: z.string().trim().min(4).max(32),
  roleNote: ShortTextSchema.nullish(),
  /** True lets them raise a request on any project, ignoring `projectIds`. */
  allProjects: z.boolean().default(false),
  projectIds: z.array(UuidSchema).max(200).default([]),
  /**
   * Per-request ceiling in minor units. Null means no ceiling. This is the
   * owner's principal control: a supervisor may commit ₹20,000 of extra work
   * unprompted, but not ₹5,00,000.
   */
  maxRequestMinor: AmountMinorSchema.nullish(),
});
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeSchema>;

export const UpdateEmployeeSchema = z
  .object({
    name: ShortTextSchema,
    phone: z.string().trim().min(4).max(32),
    roleNote: ShortTextSchema.nullable(),
    // REMOVED is absent on purpose: removal is a DELETE, so that an accidental
    // status edit cannot free the phone number for reuse elsewhere.
    status: EmployeeStatusSchema.exclude(['REMOVED']),
    allProjects: z.boolean(),
    projectIds: z.array(UuidSchema).max(200),
    maxRequestMinor: AmountMinorSchema.nullable(),
  })
  .partial();
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeSchema>;

export const EmployeeSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  phoneE164: PhoneE164Schema,
  /** Masked for list views so a full roster is not casually exportable. */
  phoneMasked: z.string(),
  roleNote: z.string().nullable(),
  status: EmployeeStatusSchema,
  allProjects: z.boolean(),
  projectIds: z.array(UuidSchema),
  maxRequestMinor: z.number().int().nullable(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type EmployeeDto = z.infer<typeof EmployeeSchema>;

export const ListEmployeesQuerySchema = z.object({
  status: EmployeeStatusSchema.optional(),
  query: z.string().trim().max(200).optional(),
});

export const EmployeeListSchema = z.object({
  items: z.array(EmployeeSchema),
});

// --- Request template -------------------------------------------------------

/**
 * The customer-facing copy the owner controls. Note what is *not* here: the
 * assurance language and the disclaimer. Those state what the record actually
 * is, and letting a seller reword them would let the product overstate its own
 * evidence (report §3.3, §12.4). They live in `assurance.ts` and are read-only
 * in the settings UI.
 */
export const UpdateRequestTemplateSchema = z
  .object({
    heading: ShortTextSchema,
    intro: z.string().trim().max(2_000),
    termsBody: z.string().trim().max(20_000),
    paymentNote: z.string().trim().max(2_000).nullable(),
    footerNote: z.string().trim().max(2_000).nullable(),
  })
  .partial();
export type UpdateRequestTemplateInput = z.infer<typeof UpdateRequestTemplateSchema>;

export const RequestTemplateSchema = z.object({
  heading: z.string(),
  intro: z.string(),
  termsBody: z.string(),
  paymentNote: z.string().nullable(),
  footerNote: z.string().nullable(),
  /** Bumped on every edit and frozen into each sent version. */
  templateVersion: z.number().int(),
  updatedAt: InstantSchema,
});
export type RequestTemplateDto = z.infer<typeof RequestTemplateSchema>;

// --- Inbound message log ----------------------------------------------------

export const InboundStatusSchema = z.enum([
  'RECEIVED',
  'REJECTED_UNKNOWN_SENDER',
  'REJECTED_NOT_AUTHORIZED',
  'REJECTED_UNPARSEABLE',
  'REJECTED_POLICY',
  'ACCEPTED',
]);
export type InboundStatusDto = z.infer<typeof InboundStatusSchema>;

/**
 * One row of the owner's "every request ever filed" view. Rejected messages are
 * included deliberately — an operator needs to see that someone texted and was
 * turned away, and what they were told.
 */
export const InboundMessageSchema = z.object({
  id: UuidSchema,
  status: InboundStatusSchema,
  /** Masked: the log is a support view, not a contact export. */
  fromPhoneMasked: z.string(),
  employeeId: UuidSchema.nullable(),
  employeeName: z.string().nullable(),
  projectId: UuidSchema.nullable(),
  projectTitle: z.string().nullable(),
  changeOrderId: UuidSchema.nullable(),
  body: z.string().nullable(),
  mediaCount: z.number().int(),
  rejectionReason: z.string().nullable(),
  /** Exactly what the employee was replied on WhatsApp. */
  replyText: z.string().nullable(),
  receivedAt: InstantSchema,
  processedAt: InstantSchema.nullable(),
});
export type InboundMessageDto = z.infer<typeof InboundMessageSchema>;

export const ListInboundQuerySchema = z.object({
  status: InboundStatusSchema.optional(),
  employeeId: UuidSchema.optional(),
  /** Everything the system could not turn into a change order. */
  unresolvedOnly: z.coerce.boolean().optional(),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
});

export const InboundMessageListSchema = z.object({
  items: z.array(InboundMessageSchema),
  nextCursor: z.string().nullable(),
});

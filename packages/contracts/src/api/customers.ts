import { z } from 'zod';
import {
  CursorSchema,
  EmailSchema,
  InstantSchema,
  LimitSchema,
  MediumTextSchema,
  ShortTextSchema,
  UuidSchema,
} from '../primitives.js';

/** Human-entered phone input; the application service normalizes it to E.164. */
const PhoneInputSchema = z.string().trim().min(4).max(32);

export const ContactInputSchema = z
  .object({
    name: ShortTextSchema,
    phoneE164: PhoneInputSchema.optional(),
    email: EmailSchema.optional(),
    isDefaultApprover: z.boolean().default(false),
    /** Free text recording why this person may authorise changes (report §16.1). */
    authorityNote: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => Boolean(v.phoneE164 || v.email),
    'A contact needs at least a phone number or an email address',
  );
export type ContactInput = z.infer<typeof ContactInputSchema>;

export const ContactSchema = z.object({
  id: UuidSchema,
  customerId: UuidSchema,
  name: z.string(),
  phoneE164: z.string().nullable(),
  email: z.string().nullable(),
  isDefaultApprover: z.boolean(),
  authorityNote: z.string().nullable(),
  whatsappOptInStatus: z.enum(['UNKNOWN', 'OPTED_IN', 'OPTED_OUT']),
  whatsappOptInAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
});
export type ContactDto = z.infer<typeof ContactSchema>;

export const UpdateContactSchema = ContactInputSchema.innerType().partial();

export const CreateCustomerSchema = z.object({
  displayName: ShortTextSchema,
  legalName: ShortTextSchema.optional(),
  notes: MediumTextSchema.optional(),
  contacts: z.array(ContactInputSchema).max(10).default([]),
});
export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

export const UpdateCustomerSchema = z
  .object({
    displayName: ShortTextSchema,
    legalName: ShortTextSchema.nullable(),
    notes: MediumTextSchema.nullable(),
  })
  .partial();

export const CustomerSchema = z.object({
  id: UuidSchema,
  displayName: z.string(),
  legalName: z.string().nullable(),
  notes: z.string().nullable(),
  mergedIntoCustomerId: UuidSchema.nullable(),
  contacts: z.array(ContactSchema),
  projectCount: z.number().int(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  lockVersion: z.number().int(),
});
export type CustomerDto = z.infer<typeof CustomerSchema>;

/**
 * A row of the customer directory. Deliberately *not* `CustomerSchema`: the
 * list endpoint returns a summary with one approver, not every contact, so a
 * caller typing the list response as a full `CustomerDto` gets a shape the API
 * never sends and crashes on `contacts`.
 */
export const CustomerSummarySchema = z.object({
  id: UuidSchema,
  displayName: z.string(),
  legalName: z.string().nullable(),
  mergedIntoCustomerId: UuidSchema.nullable(),
  projectCount: z.number().int(),
  approver: z
    .object({
      id: UuidSchema,
      name: z.string(),
      phoneE164: z.string().nullable(),
      email: z.string().nullable(),
      authorityNote: z.string().nullable(),
    })
    .nullable(),
  updatedAt: InstantSchema,
});
export type CustomerSummaryDto = z.infer<typeof CustomerSummarySchema>;

export const ListCustomersQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  cursor: CursorSchema.optional(),
  limit: LimitSchema,
  includeMerged: z.coerce.boolean().default(false),
});

/**
 * Merge is explicit and never automatic (report §9.5). Source IDs survive
 * through `merged_into_customer_id` so historical evidence keeps resolving.
 */
export const MergeCustomerSchema = z.object({
  sourceCustomerId: UuidSchema,
  /** Typed confirmation guards against a mis-tap on an irreversible action. */
  confirmDisplayName: ShortTextSchema,
});
export type MergeCustomerInput = z.infer<typeof MergeCustomerSchema>;

export const DuplicateCandidateSchema = z.object({
  customerId: UuidSchema,
  displayName: z.string(),
  score: z.number().min(0).max(1),
  reasons: z.array(z.enum(['SAME_PHONE', 'SAME_EMAIL', 'SIMILAR_NAME'])),
});
export type DuplicateCandidateDto = z.infer<typeof DuplicateCandidateSchema>;

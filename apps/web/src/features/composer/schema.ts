import { z } from 'zod';
import { AssuranceLevelSchema, ChangeTypeSchema } from '@extrawork/contracts';

/**
 * Composer form schema — report §6.3 "Form strategy".
 *
 *  - React Hook Form owns field state; this Zod schema gives immediate feedback.
 *  - The shape mirrors `CreateChangeOrderSchema` from `packages/contracts`, and
 *    the backend repeats every check and remains authoritative.
 *  - Monetary inputs accept a localised display string and serialise to integer
 *    paise at the boundary; quantities serialise as decimal strings. No value in
 *    this form is ever a binary float.
 */

export const LineDraftSchema = z.object({
  // Stable key for React list reconciliation; never sent to the API.
  key: z.string(),
  description: z.string().trim().min(1, 'Describe this item').max(500),
  quantity: z
    .string()
    .trim()
    .regex(/^\d{1,15}(\.\d{1,3})?$/, 'Use a number, up to 3 decimals')
    .refine((v) => Number(v) > 0, 'Quantity must be more than zero'),
  unit: z.string().trim().max(24).optional(),
  /** Rupee text as typed; converted to integer paise on submit. */
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount like 6500 or 6500.50'),
  taxRateBps: z.number().int().min(0).max(10_000),
  direction: z.union([z.literal(1), z.literal(-1)]),
});
export type LineDraft = z.infer<typeof LineDraftSchema>;

export const ComposerSchema = z
  .object({
    // Step 1 — what changed
    type: ChangeTypeSchema,
    title: z.string().trim().min(1, 'Give this change a short title').max(200),
    scope: z
      .string()
      .trim()
      .min(20, 'Describe the work in enough detail for the customer to agree to it')
      .max(20_000),
    reason: z.string().trim().max(2_000).optional(),
    attachmentIds: z.array(z.string().uuid()).max(12),

    // Step 2 — commercial effect
    lineItems: z.array(LineDraftSchema).max(100),

    // Step 3 — time and approval
    scheduleDeltaDays: z.number().int().min(-365).max(365),
    approverContactId: z.string().uuid('Choose who will approve this'),
    expiresAt: z.string().optional(),
    assuranceRequired: AssuranceLevelSchema,
  })
  // Report §4.6: a zero-price, time-only change is valid, so the rule is
  // "line items OR a schedule impact", not "line items".
  .refine((value) => value.lineItems.length > 0 || value.scheduleDeltaDays !== 0, {
    message: 'Add at least one line item, or record a change to the schedule',
    path: ['lineItems'],
  });

export type ComposerValues = z.infer<typeof ComposerSchema>;

export const EMPTY_COMPOSER: ComposerValues = {
  type: 'ADDITION',
  title: '',
  scope: '',
  reason: '',
  attachmentIds: [],
  lineItems: [],
  scheduleDeltaDays: 0,
  approverContactId: '',
  expiresAt: undefined,
  assuranceRequired: 'A0',
};

export function newLine(direction: 1 | -1 = 1): LineDraft {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? `line-${Date.now()}-${Math.random()}`,
    description: '',
    quantity: '1',
    unit: '',
    unitPrice: '',
    taxRateBps: 1800, // 18% GST is the common default for interior fit-out work.
    direction,
  };
}

/** GST slabs a contractor picks from, rather than typing a rate. */
export const TAX_RATES = [
  { bps: 0, label: 'No tax' },
  { bps: 500, label: '5%' },
  { bps: 1200, label: '12%' },
  { bps: 1800, label: '18%' },
  { bps: 2800, label: '28%' },
] as const;

export const STEPS = [
  { id: 1, label: 'What changed' },
  { id: 2, label: 'Cost' },
  { id: 3, label: 'Time and approver' },
  { id: 4, label: 'Preview' },
] as const;

/** Fields that must be valid before a given step can be left. */
export const STEP_FIELDS: Record<number, Array<keyof ComposerValues>> = {
  1: ['title', 'scope', 'type'],
  2: ['lineItems'],
  3: ['scheduleDeltaDays', 'approverContactId', 'assuranceRequired'],
  4: [],
};

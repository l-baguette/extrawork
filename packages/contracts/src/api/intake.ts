import { z } from 'zod';
import { UuidSchema, WorkCategorySchema } from '../primitives.js';

/**
 * Paste-to-draft — Tier 1 C (spec 2026-09-14 section C), adapted to the review
 * flow of spec 2026-10-12: the designer pastes a WhatsApp message a contractor
 * sent them, sees what was read, and opens it in the composer.
 *
 * The parse is read-only. Nothing is written until the designer saves.
 */

export const ParseIntakeRequestSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  projectId: UuidSchema.optional(),
});
export type ParseIntakeRequest = z.infer<typeof ParseIntakeRequestSchema>;

export const ParseIntakeResponseSchema = z.object({
  description: z.string().nullable(),
  reason: z.string().nullable(),
  /** Minor units, following the money-on-the-wire convention. */
  amountMinor: z.number().int().nullable(),
  days: z.number().int().nullable(),
  room: z.string().nullable(),
  workCategory: WorkCategorySchema.nullable(),
  /** Fields a request needs that the message did not supply. */
  missing: z.array(z.string()),
  /** Things that were present but could not be read safely, e.g. "15k or 1.5L?". */
  problems: z.array(z.string()),
  project: z
    .object({
      id: UuidSchema,
      title: z.string(),
      projectNumber: z.string(),
    })
    .nullable(),
});
export type ParseIntakeResponse = z.infer<typeof ParseIntakeResponseSchema>;

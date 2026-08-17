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

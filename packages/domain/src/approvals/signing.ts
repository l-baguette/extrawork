import { AppError } from '@extrawork/contracts';

/**
 * The signature block — what the signatory asserts, as distinct from what the
 * system observes.
 *
 * A conventional signature block carries a name, a date and often a place, and
 * all three are assertions *by the signatory*. A server timestamp is not a
 * substitute: it is the system's assertion about them. Under the Indian
 * Contract Act, 1872 the contract is formed by acceptance, and the date of that
 * acceptance is a term the parties state rather than a log line — so it is
 * collected, not derived.
 *
 * This module governs how far the two may disagree. It never rewrites what the
 * signatory wrote.
 */

/**
 * How far the asserted date may sit from the server's own day.
 *
 * One day either side, and the tolerance is real rather than defensive. A
 * customer in Dubai signing at 23:30 IST-minus-1:30 genuinely writes tomorrow's
 * date by their own calendar, and a customer signing just after midnight writes
 * yesterday's out of habit. Both are honest, and normalising either to the
 * server's day would destroy a fact rather than tidy it.
 *
 * Beyond that window the entry is refused rather than silently corrected: a
 * date months away is either a typo the signatory should see, or an attempt to
 * backdate an agreement, and neither should be quietly absorbed into an
 * append-only record.
 */
export const SIGNED_DATE_TOLERANCE_DAYS = 1;

/** `YYYY-MM-DD` in the given IANA zone, which is the calendar the signatory reads. */
export function calendarDateIn(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return parts;
}

export interface SignedDateCheck {
  /** Days between what was asserted and the server's own calendar day. */
  driftDays: number;
  /** True when the two do not name the same day; recorded, never hidden. */
  diverges: boolean;
}

/**
 * Checks an asserted signing date against the server clock.
 *
 * Returns the drift so the caller can record it. Throws only when the gap is
 * wide enough that the entry cannot be an honest timezone or habit difference.
 */
export function assertSignedDatePlausible(
  signedDate: string,
  now: Date,
  timezone: string,
  toleranceDays: number = SIGNED_DATE_TOLERANCE_DAYS,
): SignedDateCheck {
  const asserted = Date.parse(`${signedDate}T00:00:00Z`);
  if (Number.isNaN(asserted)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'That is not a real calendar date.',
      details: { field: 'signedDate' },
    });
  }

  const serverDay = Date.parse(`${calendarDateIn(now, timezone)}T00:00:00Z`);
  // No rounding: both operands are exact UTC midnights parsed from YYYY-MM-DD,
  // so their difference is a whole number of days by construction. Rounding
  // here would only hide a bug if that ever stopped being true — and the
  // repository bans `Math.round` outright, because in every other file in this
  // codebase a rounding call is about money and must go through the half-up
  // engine (report §8.1).
  const driftDays = (asserted - serverDay) / 86_400_000;

  if (Math.abs(driftDays) > toleranceDays) {
    throw new AppError('VALIDATION_FAILED', {
      message:
        driftDays > 0
          ? 'That date is in the future. Enter the date you are signing on.'
          : 'That date is too far in the past. Enter the date you are signing on.',
      details: { field: 'signedDate', driftDays },
    });
  }

  return { driftDays, diverges: driftDays !== 0 };
}

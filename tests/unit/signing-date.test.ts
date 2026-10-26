import { describe, expect, it } from 'vitest';
import { SIGNED_DATE_TOLERANCE_DAYS, assertSignedDatePlausible } from '@extrawork/domain';

/**
 * The asserted signing date — Indian Contract Act, 1872.
 *
 * The date of acceptance is a term the parties state, not a log line the system
 * writes about them, so it is collected from the signatory and bounded rather
 * than derived. These tests pin the two halves of that: an honest timezone or
 * habit difference survives untouched, and a date that could only be a typo or
 * a backdating attempt is refused instead of being quietly normalised.
 */

const IST = 'Asia/Kolkata';
// 21:00 UTC on 13 Aug is already 02:30 IST on 14 Aug — the case where the
// server's calendar day and UTC's disagree.
const LATE_EVENING_UTC = new Date('2026-08-13T21:00:00.000Z');

describe('asserted signing date', () => {
  it('accepts the server’s own calendar day', () => {
    const check = assertSignedDatePlausible('2026-08-14', LATE_EVENING_UTC, IST);
    expect(check.driftDays).toBe(0);
    expect(check.diverges).toBe(false);
  });

  it('uses the local calendar, not UTC', () => {
    // In UTC it is still the 13th; in IST it is the 14th. The signatory reads
    // the Indian calendar, so that is the one the rule is measured against.
    expect(() => assertSignedDatePlausible('2026-08-14', LATE_EVENING_UTC, IST)).not.toThrow();
  });

  it('accepts a signatory one timezone ahead writing tomorrow', () => {
    const check = assertSignedDatePlausible('2026-08-15', LATE_EVENING_UTC, IST);
    expect(check.driftDays).toBe(1);
    // Recorded as divergent rather than corrected: it is a fact about a real
    // person in a real place.
    expect(check.diverges).toBe(true);
  });

  it('accepts someone writing yesterday out of habit just after midnight', () => {
    const check = assertSignedDatePlausible('2026-08-13', LATE_EVENING_UTC, IST);
    expect(check.driftDays).toBe(-1);
    expect(check.diverges).toBe(true);
  });

  it('refuses a date far in the future rather than absorbing it', () => {
    expect(() => assertSignedDatePlausible('2026-09-30', LATE_EVENING_UTC, IST)).toThrow(/future/i);
  });

  it('refuses a backdated agreement', () => {
    // The case the bound actually exists for: an append-only record must not
    // quietly accept a date chosen to predate something else.
    expect(() => assertSignedDatePlausible('2026-01-01', LATE_EVENING_UTC, IST)).toThrow(/past/i);
  });

  it('refuses text that is not a calendar date', () => {
    expect(() => assertSignedDatePlausible('not-a-date', LATE_EVENING_UTC, IST)).toThrow();
  });

  it('tolerates one day either side, not a week', () => {
    expect(SIGNED_DATE_TOLERANCE_DAYS).toBe(1);
  });
});

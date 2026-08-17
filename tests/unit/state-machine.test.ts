import { describe, expect, it } from 'vitest';
import { AppError, type VersionStatus } from '@extrawork/contracts';
import {
  VERSION_ACTIONS,
  affectsProjectTotals,
  assertTransition,
  canCreateRevision,
  canTransition,
  decisionAction,
  isEditable,
  isOpenForDecision,
  isTerminal,
  nextStatus,
  type VersionAction,
} from '@extrawork/domain';

/**
 * The full transition matrix — report §4.3 and §14.5 ("State-transition matrix").
 *
 * The table below is written out longhand rather than generated from the
 * implementation, so a change to the machine has to be reflected here
 * deliberately instead of silently passing.
 */

const ALL_STATUSES: VersionStatus[] = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'REVISION_REQUESTED',
  'APPROVED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'SUPERSEDED',
];

const EXPECTED: Record<VersionStatus, Partial<Record<VersionAction, VersionStatus>>> = {
  DRAFT: { SEND: 'SENT', CANCEL: 'CANCELLED' },
  SENT: {
    VIEW: 'VIEWED',
    APPROVE: 'APPROVED',
    DECLINE: 'DECLINED',
    REQUEST_REVISION: 'REVISION_REQUESTED',
    EXPIRE: 'EXPIRED',
    CANCEL: 'CANCELLED',
    SUPERSEDE: 'SUPERSEDED',
  },
  VIEWED: {
    VIEW: 'VIEWED',
    APPROVE: 'APPROVED',
    DECLINE: 'DECLINED',
    REQUEST_REVISION: 'REVISION_REQUESTED',
    EXPIRE: 'EXPIRED',
    CANCEL: 'CANCELLED',
    SUPERSEDE: 'SUPERSEDED',
  },
  REVISION_REQUESTED: { SUPERSEDE: 'SUPERSEDED', CANCEL: 'CANCELLED' },
  EXPIRED: { SUPERSEDE: 'SUPERSEDED', CANCEL: 'CANCELLED' },
  APPROVED: {},
  DECLINED: {},
  CANCELLED: {},
  SUPERSEDED: {},
};

describe('transition matrix', () => {
  for (const from of ALL_STATUSES) {
    for (const action of VERSION_ACTIONS) {
      const expected = EXPECTED[from][action];
      it(`${from} + ${action} -> ${expected ?? 'rejected'}`, () => {
        if (expected) {
          expect(canTransition(from, action)).toBe(true);
          expect(nextStatus(from, action)).toBe(expected);
          expect(assertTransition(from, action)).toBe(expected);
        } else {
          expect(canTransition(from, action)).toBe(false);
          expect(nextStatus(from, action)).toBeNull();
          expect(() => assertTransition(from, action)).toThrow(AppError);
        }
      });
    }
  }
});

describe('terminal states', () => {
  it('marks APPROVED, DECLINED, CANCELLED and SUPERSEDED terminal', () => {
    expect(isTerminal('APPROVED')).toBe(true);
    expect(isTerminal('DECLINED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('SUPERSEDED')).toBe(true);
    expect(isTerminal('SENT')).toBe(false);
  });

  it('never allows a terminal version to transition again', () => {
    // Report §4.3: "APPROVED and DECLINED are terminal for that version."
    for (const status of ALL_STATUSES.filter(isTerminal)) {
      for (const action of VERSION_ACTIONS) {
        expect(canTransition(status, action)).toBe(false);
      }
    }
  });
});

describe('decision error codes', () => {
  it('returns ALREADY_DECIDED for a second decision', () => {
    // Report §4.6: the second decision "receives 409 ALREADY_DECIDED".
    expect(() => assertTransition('APPROVED', 'APPROVE')).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DECIDED' }),
    );
    expect(() => assertTransition('DECLINED', 'DECLINE')).toThrowError(
      expect.objectContaining({ code: 'ALREADY_DECIDED' }),
    );
  });

  it('returns VERSION_SUPERSEDED when the contractor replaced the version', () => {
    expect(() => assertTransition('SUPERSEDED', 'APPROVE')).toThrowError(
      expect.objectContaining({ code: 'VERSION_SUPERSEDED' }),
    );
  });

  it('returns REQUEST_EXPIRED past the deadline', () => {
    expect(() => assertTransition('EXPIRED', 'APPROVE')).toThrowError(
      expect.objectContaining({ code: 'REQUEST_EXPIRED' }),
    );
  });

  it('returns TOKEN_REVOKED for a cancelled request', () => {
    expect(() => assertTransition('CANCELLED', 'APPROVE')).toThrowError(
      expect.objectContaining({ code: 'TOKEN_REVOKED' }),
    );
  });
});

describe('viewing', () => {
  it('is idempotent once viewed', () => {
    // Report §4.5: repeat views do not change the evidence event.
    expect(assertTransition('VIEWED', 'VIEW')).toBe('VIEWED');
  });
});

describe('editability and revisions', () => {
  it('only a draft may be edited in place', () => {
    expect(isEditable('DRAFT')).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== 'DRAFT')) {
      expect(isEditable(status)).toBe(false);
    }
  });

  it('refuses to revise an approved version', () => {
    // Report §4.3: a correction to an approved change is a new linked change
    // or a reversal, never a revision of the approved version.
    expect(canCreateRevision('APPROVED')).toBe(false);
    expect(canCreateRevision('CANCELLED')).toBe(false);
    expect(canCreateRevision('SUPERSEDED')).toBe(false);
  });

  it('allows a revision from open, revision-requested, expired and declined', () => {
    expect(canCreateRevision('SENT')).toBe(true);
    expect(canCreateRevision('VIEWED')).toBe(true);
    expect(canCreateRevision('REVISION_REQUESTED')).toBe(true);
    expect(canCreateRevision('EXPIRED')).toBe(true);
    expect(canCreateRevision('DECLINED')).toBe(true);
  });
});

describe('decision effects', () => {
  it('only an approval moves project totals', () => {
    expect(affectsProjectTotals('APPROVE')).toBe(true);
    expect(affectsProjectTotals('DECLINE')).toBe(false);
    expect(affectsProjectTotals('REQUEST_REVISION')).toBe(false);
  });

  it('maps a decision type to its action', () => {
    expect(decisionAction('APPROVE')).toBe('APPROVE');
    expect(decisionAction('DECLINE')).toBe('DECLINE');
    expect(decisionAction('REQUEST_REVISION')).toBe('REQUEST_REVISION');
  });
});

describe('open for decision', () => {
  it('is only SENT and VIEWED', () => {
    expect(isOpenForDecision('SENT')).toBe(true);
    expect(isOpenForDecision('VIEWED')).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== 'SENT' && s !== 'VIEWED')) {
      expect(isOpenForDecision(status)).toBe(false);
    }
  });
});

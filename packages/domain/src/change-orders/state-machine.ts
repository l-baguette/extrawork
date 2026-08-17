import { AppError, type DecisionType, type VersionStatus } from '@extrawork/contracts';

/**
 * Change-order version state machine — report §4.3.
 *
 *   DRAFT --send--> SENT --open--> VIEWED
 *     |                |             |
 *     |                +-------------+--approve--> APPROVED (terminal)
 *     |                +-------------+--decline--> DECLINED (terminal)
 *     |                +-------------+--request revision--> REVISION_REQUESTED
 *     |                +-------------+--expire---> EXPIRED
 *     +--cancel--> CANCELLED         +--cancel---> CANCELLED
 *
 *   REVISION_REQUESTED --create revision--> DRAFT (new version)
 *   APPROVED --commercial reversal--> separate deduction change order
 *
 * Transitions live here, not in route handlers or UI (report §14.4). Any status
 * write goes through `assertTransition`.
 */

export const VERSION_ACTIONS = [
  'SEND',
  'VIEW',
  'APPROVE',
  'DECLINE',
  'REQUEST_REVISION',
  'EXPIRE',
  'CANCEL',
  'SUPERSEDE',
] as const;
export type VersionAction = (typeof VERSION_ACTIONS)[number];

/** Statuses from which no further transition of that version is permitted. */
export const TERMINAL_STATUSES: readonly VersionStatus[] = [
  'APPROVED',
  'DECLINED',
  'CANCELLED',
  'SUPERSEDED',
];

/** Statuses that represent a live approval request the customer can act on. */
export const OPEN_STATUSES: readonly VersionStatus[] = ['SENT', 'VIEWED'];

const TRANSITIONS: Record<VersionStatus, Partial<Record<VersionAction, VersionStatus>>> = {
  DRAFT: {
    SEND: 'SENT',
    CANCEL: 'CANCELLED',
  },
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
    // Re-viewing is idempotent: it stays VIEWED and does not append a new
    // evidence event (report §4.5).
    VIEW: 'VIEWED',
    APPROVE: 'APPROVED',
    DECLINE: 'DECLINED',
    REQUEST_REVISION: 'REVISION_REQUESTED',
    EXPIRE: 'EXPIRED',
    CANCEL: 'CANCELLED',
    SUPERSEDE: 'SUPERSEDED',
  },
  REVISION_REQUESTED: {
    // A revision creates a NEW version; this one is superseded when that happens.
    SUPERSEDE: 'SUPERSEDED',
    CANCEL: 'CANCELLED',
  },
  EXPIRED: {
    // An expired request may be duplicated into a new version, which supersedes it.
    SUPERSEDE: 'SUPERSEDED',
    CANCEL: 'CANCELLED',
  },
  APPROVED: {},
  DECLINED: {},
  CANCELLED: {},
  SUPERSEDED: {},
};

export function isTerminal(status: VersionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isOpenForDecision(status: VersionStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function canTransition(from: VersionStatus, action: VersionAction): boolean {
  return TRANSITIONS[from][action] !== undefined;
}

export function nextStatus(from: VersionStatus, action: VersionAction): VersionStatus | null {
  return TRANSITIONS[from][action] ?? null;
}

/**
 * The single guarded entry point for a status change. Chooses the most specific
 * error code so the client and the public page can explain what happened
 * (report §4.6).
 */
export function assertTransition(from: VersionStatus, action: VersionAction): VersionStatus {
  const to = TRANSITIONS[from][action];
  if (to) return to;

  const isDecisionAction =
    action === 'APPROVE' || action === 'DECLINE' || action === 'REQUEST_REVISION';

  if (isDecisionAction) {
    if (from === 'APPROVED' || from === 'DECLINED') {
      throw new AppError('ALREADY_DECIDED', { details: { currentStatus: from } });
    }
    if (from === 'SUPERSEDED') {
      throw new AppError('VERSION_SUPERSEDED', { details: { currentStatus: from } });
    }
    if (from === 'EXPIRED') {
      throw new AppError('REQUEST_EXPIRED', { details: { currentStatus: from } });
    }
    if (from === 'CANCELLED') {
      throw new AppError('TOKEN_REVOKED', { details: { currentStatus: from } });
    }
    if (from === 'REVISION_REQUESTED') {
      throw new AppError('ALREADY_DECIDED', {
        message: 'A revision has already been requested for this version.',
        details: { currentStatus: from },
      });
    }
  }

  throw new AppError('INVALID_STATE_TRANSITION', {
    details: { currentStatus: from, action },
  });
}

export function decisionAction(type: DecisionType): VersionAction {
  switch (type) {
    case 'APPROVE':
      return 'APPROVE';
    case 'DECLINE':
      return 'DECLINE';
    case 'REQUEST_REVISION':
      return 'REQUEST_REVISION';
    default: {
      const exhaustive: never = type;
      throw new AppError('VALIDATION_FAILED', { details: { type: exhaustive } });
    }
  }
}

/**
 * Only an APPROVE moves money into the project projection. A decline or a
 * revision request records evidence but changes no totals (report §8.4).
 */
export function affectsProjectTotals(type: DecisionType): boolean {
  return type === 'APPROVE';
}

/** A draft is the only version a contractor may edit in place (report §4.4). */
export function isEditable(status: VersionStatus): boolean {
  return status === 'DRAFT';
}

/**
 * Whether a new revision may be created from this version. Report §4.3: an
 * approved request is corrected by a separate linked change or reversal, never
 * by revising it.
 */
export function canCreateRevision(status: VersionStatus): boolean {
  return (
    status === 'SENT' ||
    status === 'VIEWED' ||
    status === 'REVISION_REQUESTED' ||
    status === 'EXPIRED' ||
    status === 'DECLINED'
  );
}

/** Human-readable, non-colour-dependent status label (report §6.9). */
export const STATUS_LABEL: Record<VersionStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Awaiting decision',
  VIEWED: 'Opened by customer',
  REVISION_REQUESTED: 'Revision requested',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  SUPERSEDED: 'Replaced by a newer version',
};

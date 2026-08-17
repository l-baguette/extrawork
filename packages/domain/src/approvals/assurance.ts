import {
  AppError,
  ASSURANCE_COPY,
  assuranceSatisfies,
  type AssuranceLevel,
} from '@extrawork/contracts';

/**
 * Assurance gating for the public decision path — report §3.3, §4.5 and §13.1.
 *
 * Two rules matter and both are enforced here rather than in the route:
 *  1. A decision is refused unless the session's achieved level meets the
 *     level the version requires.
 *  2. The system never silently downgrades. If A1 is required and OTP is
 *     unavailable, the customer sees "verification unavailable" — the request
 *     does not quietly fall back to A0.
 */

export interface PublicSessionAssurance {
  achieved: AssuranceLevel;
  verifiedPhoneE164: string | null;
  verifiedAt: Date | null;
}

export interface AssuranceCapabilities {
  /** OTP provider reachable and the organization is entitled to it. */
  otpAvailable: boolean;
  /** A2 is out of scope for the MVP (report §15.2). */
  esignAvailable: boolean;
}

export function assertAssuranceAvailable(
  required: AssuranceLevel,
  capabilities: AssuranceCapabilities,
): void {
  if (required === 'A1' && !capabilities.otpAvailable) {
    throw new AppError('ASSURANCE_UNAVAILABLE', {
      message:
        'Phone verification is unavailable right now. This request requires it, so a decision ' +
        'cannot be recorded yet. Please try again shortly.',
      details: { requiredAssurance: required },
    });
  }
  if (required === 'A2' && !capabilities.esignAvailable) {
    throw new AppError('ASSURANCE_UNAVAILABLE', {
      message:
        'Licensed electronic signature is not available in this release. Contact the contractor ' +
        'to reissue this request at a supported assurance level.',
      details: { requiredAssurance: required },
    });
  }
}

/** Enforced immediately before the decision is written (report §8.4). */
export function assertAssuranceSatisfied(
  session: PublicSessionAssurance,
  required: AssuranceLevel,
): void {
  if (!assuranceSatisfies(session.achieved, required)) {
    throw new AppError('ASSURANCE_REQUIRED', {
      message: `This request requires ${ASSURANCE_COPY[required].label.toLowerCase()} before a decision can be recorded.`,
      details: { required, achieved: session.achieved },
    });
  }
}

/**
 * What a contractor may select when composing. A2 is never selectable in the
 * MVP, and A1 only when the organization is entitled to OTP approvals.
 */
export function selectableAssuranceLevels(entitlements: {
  otpApprovals: boolean;
}): AssuranceLevel[] {
  const levels: AssuranceLevel[] = ['A0'];
  if (entitlements.otpApprovals) levels.push('A1');
  return levels;
}

export function assertAssuranceSelectable(
  required: AssuranceLevel,
  entitlements: { otpApprovals: boolean },
): void {
  if (required === 'A2') {
    throw new AppError('FEATURE_NOT_ENTITLED', {
      message: ASSURANCE_COPY.A2.summary + ' This is not available in the current release.',
      details: { assurance: 'A2' },
    });
  }
  if (required === 'A1' && !entitlements.otpApprovals) {
    throw new AppError('FEATURE_NOT_ENTITLED', {
      message: 'Phone-verified approval is not included in your plan.',
      details: { assurance: 'A1' },
    });
  }
}

/**
 * The level actually achieved by the decision. Never higher than what the
 * session proved, so evidence cannot overstate what happened.
 */
export function achievedAssurance(session: PublicSessionAssurance): AssuranceLevel {
  return session.achieved;
}

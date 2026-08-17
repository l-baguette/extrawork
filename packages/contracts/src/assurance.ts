import type { AssuranceLevel } from './primitives.js';

/**
 * Single source of truth for how assurance is described to users, in the PDF and
 * in exports. Report §3.3 and §12.4 require honest terminology: A0 is a
 * secure-link record of assent, NOT a government-recognised electronic
 * signature. Every surface reads these strings so wording can be reviewed by
 * counsel in one place and versioned with the evidence template.
 *
 * `TERMS_VERSION` is frozen into each sent snapshot. Changing any user-visible
 * string below REQUIRES a new terms version and a golden-evidence review.
 */
export const TERMS_VERSION = 'approval-terms-in-v1';

export interface AssuranceCopy {
  level: AssuranceLevel;
  /** Short label for badges and tables. */
  label: string;
  /** One-line description of what the evidence actually is. */
  summary: string;
  /** Full sentence for the evidence PDF and the decision receipt. */
  evidenceStatement: string;
  /** What a reader must NOT conclude from this level. */
  limitation: string;
  /** Whether the level can be selected in this release. */
  available: boolean;
}

export const ASSURANCE_COPY: Record<AssuranceLevel, AssuranceCopy> = {
  A0: {
    level: 'A0',
    label: 'Secure link assent',
    summary: 'Approved through a private one-time link, with a typed name and confirmation.',
    evidenceStatement:
      'This decision was recorded when the holder of a private, single-purpose link opened it, ' +
      'typed the name shown below, and confirmed the statement of authority and assent. ' +
      'ExtraWork recorded the exact frozen version, the time, and the network metadata shown in this pack.',
    limitation:
      'This is a record of electronic assent, not a licensed or government-recognised electronic ' +
      'signature. Anyone holding the link could have opened it, so this record attributes the ' +
      'decision to the link recipient rather than proving the identity of the individual.',
    available: true,
  },
  A1: {
    level: 'A1',
    label: 'Phone-verified assent',
    summary: 'Secure link assent plus a one-time code delivered to the recorded approver phone.',
    evidenceStatement:
      'In addition to the secure-link assent recorded below, a one-time code was delivered to the ' +
      'approver phone number on record and entered correctly before the decision was accepted.',
    limitation:
      'Phone verification strengthens attribution but is not a licensed electronic signature. ' +
      'It does not exclude the possibility of a shared, forwarded, or compromised device or SIM.',
    available: true,
  },
  A2: {
    level: 'A2',
    label: 'Licensed electronic signature',
    summary: 'Signed through a licensed e-signature provider that issues its own certificate.',
    evidenceStatement:
      'This decision was signed through a licensed electronic-signature provider. The provider ' +
      'certificate and signed artifact digest are recorded in this pack.',
    limitation:
      'The provider certificate governs the legal characterisation of the signature. ExtraWork ' +
      'records and references it but does not itself certify the signature.',
    available: false,
  },
};

/**
 * Shown above the decision buttons on the public page and reproduced verbatim in
 * the evidence pack. Deliberately plain: it must not overstate legal effect.
 */
export const APPROVAL_DECLARATION =
  'I confirm that I am authorised to approve changes to this project on behalf of the customer, ' +
  'and that I accept the scope, price and schedule impact shown above.';

export const DECLINE_DECLARATION =
  'I confirm that I am declining this change request. No additional work or cost is authorised by this decision.';

export const REVISION_DECLARATION =
  'I am asking the contractor to revise this request. This is not an approval and does not authorise any work or cost.';

/**
 * Rendered on the public page footer and the PDF cover. Report §1.3 and §12.4:
 * the product must not promise enforceability.
 */
export const EVIDENCE_DISCLAIMER =
  'ExtraWork records what was sent, when it was sent, what was shown, and what was decided. ' +
  'It strengthens documentation and attribution. It does not determine whether the underlying ' +
  'contract is enforceable, whether the person deciding held authority, or how a court or ' +
  'arbitrator will treat this record.';

export function assuranceCopy(level: AssuranceLevel): AssuranceCopy {
  return ASSURANCE_COPY[level];
}

/** Ordering used to compare achieved vs required assurance. */
const RANK: Record<AssuranceLevel, number> = { A0: 0, A1: 1, A2: 2 };

export function assuranceSatisfies(achieved: AssuranceLevel, required: AssuranceLevel): boolean {
  return RANK[achieved] >= RANK[required];
}

export function assuranceRank(level: AssuranceLevel): number {
  return RANK[level];
}

/**
 * Who is legally publishing this service, and when the published policies last
 * changed.
 *
 * Lives in `contracts` for the same reason the assurance copy does: it is text
 * with legal weight that both the server and the browser must render
 * identically, and `apps/web` may import this package and no other.
 *
 * The values are deliberately environment-driven rather than hard-coded. A
 * registered address, a working phone number and a named grievance officer are
 * facts about a company, not about a codebase — inventing them here would put a
 * false statement in front of a customer, and a self-hoster would inherit
 * someone else's identity. `assertProductionSafe` in `@extrawork/config`
 * refuses to boot a production API until they are set.
 */

/**
 * Bumped whenever the substance of a published policy changes. Shown on every
 * policy page so a customer can tell which version they agreed to, and so a
 * dispute can be argued against a specific text.
 */
export const POLICY_VERSION = '2026-09-07';

export interface LegalIdentity {
  /** Registered legal name, e.g. "<Company> Private Limited". */
  entityName: string;
  /** Full registered address, newline-separated. */
  address: string;
  /** Monitored support address for general and billing contact. */
  contactEmail: string;
  /** A working telephone number. Required by payment-aggregator onboarding. */
  contactPhone: string;
  /**
   * DPDP Act 2023 s.13 and the IT (Intermediary Guidelines) Rules both require
   * a named human a data principal can escalate to, not a role alias.
   */
  grievanceOfficerName: string;
  grievanceOfficerEmail: string;
  /** GSTIN, shown on invoices and required for an Indian B2B seller. */
  gstin: string | null;
}

/**
 * True when every mandatory field is a real value rather than a placeholder.
 * Pages use this to show an unmistakable "not configured" notice instead of
 * quietly rendering an empty address, which would read as a finished policy.
 */
export function isLegalIdentityConfigured(identity: LegalIdentity): boolean {
  return (
    identity.entityName !== UNSET &&
    identity.address !== UNSET &&
    identity.contactEmail !== UNSET &&
    identity.contactPhone !== UNSET &&
    identity.grievanceOfficerName !== UNSET &&
    identity.grievanceOfficerEmail !== UNSET
  );
}

export const UNSET = 'NOT CONFIGURED';

/**
 * Reads the identity from a plain environment bag.
 *
 * Takes the bag as an argument rather than reaching for `process.env` so the
 * Next.js build can pass its inlined `NEXT_PUBLIC_*` values, which only exist
 * as literals at build time and cannot be read dynamically.
 */
export function legalIdentityFrom(source: Record<string, string | undefined>): LegalIdentity {
  const read = (key: string): string => {
    const value = source[key]?.trim();
    return value ? value : UNSET;
  };
  const gstin = source.NEXT_PUBLIC_LEGAL_GSTIN?.trim();
  return {
    entityName: read('NEXT_PUBLIC_LEGAL_ENTITY_NAME'),
    address: read('NEXT_PUBLIC_LEGAL_ADDRESS'),
    contactEmail: read('NEXT_PUBLIC_LEGAL_CONTACT_EMAIL'),
    contactPhone: read('NEXT_PUBLIC_LEGAL_CONTACT_PHONE'),
    grievanceOfficerName: read('NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER_NAME'),
    grievanceOfficerEmail: read('NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER_EMAIL'),
    gstin: gstin ? gstin : null,
  };
}

/** The environment keys the legal identity is assembled from. */
export const LEGAL_IDENTITY_KEYS = [
  'NEXT_PUBLIC_LEGAL_ENTITY_NAME',
  'NEXT_PUBLIC_LEGAL_ADDRESS',
  'NEXT_PUBLIC_LEGAL_CONTACT_EMAIL',
  'NEXT_PUBLIC_LEGAL_CONTACT_PHONE',
  'NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER_NAME',
  'NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER_EMAIL',
] as const;

/**
 * How long a closed account is recoverable before its data is purged.
 * Mirrors report §9.8 and the `data-subject-request` runbook; the deletion
 * flow, the retention job and the privacy policy must all quote one number.
 */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;

/** Working days a refund takes to reach the original payment method. */
export const REFUND_SETTLEMENT_BUSINESS_DAYS = '5–7';

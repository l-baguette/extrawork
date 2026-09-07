import { legalIdentityFrom, type LegalIdentity } from '@extrawork/contracts';

/**
 * Next.js replaces `process.env.NEXT_PUBLIC_*` at build time only where it can
 * see the literal property access, so each key is spelled out here rather than
 * read from a loop. Everything else about the identity lives in
 * `@extrawork/contracts`.
 */
export function legalIdentity(): LegalIdentity {
  return legalIdentityFrom({
    NEXT_PUBLIC_LEGAL_ENTITY_NAME: process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME,
    NEXT_PUBLIC_LEGAL_ADDRESS: process.env.NEXT_PUBLIC_LEGAL_ADDRESS,
    NEXT_PUBLIC_LEGAL_CONTACT_EMAIL: process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL,
    NEXT_PUBLIC_LEGAL_CONTACT_PHONE: process.env.NEXT_PUBLIC_LEGAL_CONTACT_PHONE,
    NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER_NAME: process.env.NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER_NAME,
    NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER_EMAIL:
      process.env.NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER_EMAIL,
    NEXT_PUBLIC_LEGAL_GSTIN: process.env.NEXT_PUBLIC_LEGAL_GSTIN,
  });
}

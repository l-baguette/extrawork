import Link from 'next/link';
import type { Metadata } from 'next';
import { POLICY_VERSION, isLegalIdentityConfigured } from '@extrawork/contracts';
import { legalIdentity } from '@/lib/legal';

/**
 * The rest of the app is `noindex` because it is a private console. Published
 * policies are the opposite: a customer, a regulator or a payment aggregator
 * has to be able to find and cite them without an account.
 */
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

/**
 * Shared frame for the published policies.
 *
 * These pages are reachable without a session and are the pages a payment
 * aggregator, a regulator or a customer's lawyer will read, so they carry no
 * analytics, no third-party fonts and no scripts — same rule as the approval
 * pages in `/r`.
 */
const POLICIES = [
  { href: '/legal/terms', label: 'Terms of Service' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/refunds', label: 'Refunds & Cancellation' },
  { href: '/legal/cookies', label: 'Cookie Policy' },
  { href: '/legal/contact', label: 'Contact' },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const identity = legalIdentity();
  const configured = isLegalIdentityConfigured(identity);

  return (
    <main className="page">
      {!configured && (
        <div className="banner banner-warn">
          <strong>These policies are not ready to publish.</strong> The company identity, registered
          address, contact number and grievance officer have not been configured, so this page shows
          placeholders. Set the <code className="mono">NEXT_PUBLIC_LEGAL_*</code> variables before
          making this site public.
        </div>
      )}

      <nav aria-label="Policies" className="row-wrap" style={{ gap: 'var(--s3)' }}>
        {POLICIES.map((policy) => (
          <Link key={policy.href} href={policy.href} className="small">
            {policy.label}
          </Link>
        ))}
      </nav>

      {children}

      <p className="small muted">
        Version {POLICY_VERSION}. <Link href="/">Back to ExtraWork</Link>
      </p>
    </main>
  );
}

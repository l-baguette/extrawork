import Link from 'next/link';
import type { Metadata } from 'next';
import { isLegalIdentityConfigured } from '@extrawork/contracts';
import { legalIdentity } from '@/lib/legal';
import { DocNav } from './doc-nav';

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
 * Reachable without a session, and read by people deciding whether to trust the
 * business, so it carries no analytics, no third-party fonts and no scripts —
 * the same rule as the approval pages in `/r`.
 *
 * Note the container is `.doc`, not `.page`. `.page` is 560px because it is
 * sized for the sign-in form; a policy set in it produced a squeezed column and
 * pushed every table straight through the side of its own card.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const configured = isLegalIdentityConfigured(legalIdentity());

  return (
    <main id="main" className="doc">
      <DocNav />

      {!configured && (
        <div className="banner banner-warn" style={{ marginTop: 'var(--s5)' }}>
          <strong>These policies are not ready to publish.</strong> The company identity, registered
          address, contact number and grievance officer have not been configured, so this page shows
          placeholders. Set the <code className="mono">NEXT_PUBLIC_LEGAL_*</code> variables before
          making this site public.
        </div>
      )}

      <div className="doc-body">{children}</div>

      <footer className="doc-foot">
        <Link href="/">← ExtraWork</Link>
      </footer>
    </main>
  );
}

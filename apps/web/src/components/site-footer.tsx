import Link from 'next/link';

/**
 * The published policies, reachable from every page including the approval
 * pages a customer sees.
 *
 * A customer who is about to type their name into a binding approval is a data
 * principal being asked for personal data, so the privacy policy has to be one
 * tap away there too — not only inside the signed-in dashboard.
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Legal">
        <Link href="/legal/terms">Terms</Link>
        <Link href="/legal/privacy">Privacy</Link>
        <Link href="/legal/refunds">Refunds</Link>
        <Link href="/legal/cookies">Cookies</Link>
        <Link href="/legal/contact">Contact</Link>
      </nav>
    </footer>
  );
}

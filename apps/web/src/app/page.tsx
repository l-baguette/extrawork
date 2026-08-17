import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverGet } from '@/lib/server-fetch';

/**
 * The public front door.
 *
 * Signed-in visitors go straight to their dashboard — someone who already has a
 * session has no use for a marketing page. Everyone else gets the shortest
 * possible explanation of what this is, and three ways in.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // `/v1/auth/me` succeeds only with a valid session cookie, which is a
  // cheaper and more honest signal than reading the cookie ourselves — the
  // cookie could be present and expired.
  const session = await serverGet<{ userId: string }>('/v1/auth/me');
  if (session.ok) redirect('/app/dashboard');

  return (
    <main className="page">
      <section className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ marginBottom: 'var(--space-2)' }}>ExtraWork</h1>
        <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
          Extra work, agreed in writing. Your site team sends one WhatsApp message; your client
          approves it on their phone; you get a signed record you can invoice against.
        </p>

        <div className="actions" style={{ justifyContent: 'center' }}>
          <Link href="/sign-in" className="button">
            Sign in
          </Link>
          <p></p>
          <Link href="/register" className="button button-secondary">
            Create an account
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>How it works</h2>
        <ol className="stack">
          <li>
            <strong>Your team texts.</strong> One WhatsApp message describing the extra work, the
            cost and any delay. No app, no login, no forms.
          </li>
          <li>
            <strong>We price and freeze it.</strong> The figures are computed once and locked, so
            what the client sees can never drift from what was recorded.
          </li>
          <li>
            <strong>Your client approves on their phone.</strong> A private link, no account needed.
            They approve, decline, or ask for a change.
          </li>
          <li>
            <strong>You get the evidence.</strong> A PDF with the exact version shown, the time, the
            decision, and a tamper-evident audit trail.
          </li>
        </ol>
      </section>

      <p className="small muted" style={{ textAlign: 'center' }}>
        Already have an approval link from a contractor? Open it directly — you do not need an
        account to review or approve a request.
      </p>
    </main>
  );
}

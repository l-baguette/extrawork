'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, api } from '@/lib/api';

/**
 * Confirming an email address.
 *
 * The token arrives in the URL but is **not** redeemed on page load. Mail
 * scanners and link previewers routinely GET every URL in a message, and a
 * single-use token consumed on load would be burnt by one of them before the
 * recipient ever saw the page. So the link opens a page with a button, and the
 * POST behind that button is what verifies — the same reasoning the sign-in
 * link already follows.
 */
function VerifyEmail() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [stage, setStage] = useState<'ready' | 'done' | 'resend'>('ready');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  async function confirm(): Promise<void> {
    if (busy || !token) return;
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/verify-email', { method: 'POST', body: { token } });
      setStage('done');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'That link could not be confirmed. Request a new one below.',
      );
      setStage('resend');
    } finally {
      setBusy(false);
    }
  }

  async function resend(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/verify-email/resend', { method: 'POST', body: { email: email.trim() } });
      // Same answer whatever the address is; saying "no such account" here
      // would turn this form into a way to test which addresses exist.
      setNotice('If that address still needs confirming, a new link is on its way.');
    } catch {
      setNotice('If that address still needs confirming, a new link is on its way.');
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'done') {
    return (
      <main className="page">
        <div className="card">
          <h1>Email confirmed</h1>
          <p className="muted">
            Your address is confirmed. Sign in to finish setting up your business.
          </p>
          <button className="button" type="button" onClick={() => router.push('/sign-in')}>
            Go to sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="card">
        <h1>Confirm your email</h1>

        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="banner banner-success" role="status">
            {notice}
          </div>
        ) : null}

        {token && stage === 'ready' ? (
          <>
            <p className="muted">
              Confirming this address proves you control it, which is how your account is recovered
              later.
            </p>
            <button className="button" type="button" onClick={() => void confirm()} disabled={busy}>
              {busy ? 'Confirming…' : 'Confirm this address'}
            </button>
          </>
        ) : (
          <form onSubmit={resend} className="stack">
            <p className="muted">
              {token
                ? 'That link has expired or was already used. Enter your address for a new one.'
                : 'Enter the address you registered with and we will send a new confirmation link.'}
            </p>
            <div>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button className="button" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send a new link'}
            </button>
          </form>
        )}

        <p className="small muted" style={{ marginTop: 'var(--s4)' }}>
          Already confirmed? <Link href="/sign-in">Sign in</Link>.
        </p>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}

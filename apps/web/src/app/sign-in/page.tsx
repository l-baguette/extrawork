'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_URL, ApiError, api } from '@/lib/api';

/**
 * Business sign-in — report §6.5: managed authentication with an email magic
 * link, and a session cookie the browser holds. No token ever reaches
 * `localStorage`.
 *
 * The response to "send me a link" is deliberately identical whether or not the
 * address is known, so this page cannot be used to enumerate accounts.
 */
function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(params.get('token') ?? '');
  const [stage, setStage] = useState<'email' | 'code'>(params.get('token') ? 'code' : 'email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    // The page asks what this deployment supports rather than assuming, so a
    // button that cannot work is never shown.
    void fetch(`${API_URL}/v1/auth/methods`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { google?: boolean } | null) => setGoogleAvailable(Boolean(m?.google)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (params.get('error') === 'google_cancelled') {
      setError('That Google sign-in was cancelled. Try again, or use your password.');
    }
  }, [params]);

  async function signInWithPassword(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/password', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      router.push('/app/dashboard');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not sign you in. Check your details and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestLink(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/sign-in', { method: 'POST', body: { email: email.trim() } });
      setNotice(
        'If that address belongs to an ExtraWork account, a sign-in link is on its way. ' +
          'Paste the code from the email below.',
      );
      setStage('code');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send the link.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/verify', { method: 'POST', body: { token: code.trim() } });
      router.push('/app/dashboard');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'That link could not be verified. Request a new one.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="page">
      <div className="card">
        <h1>Sign in to ExtraWork</h1>

        {notice ? (
          <div className="banner banner-info" role="status">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}

        {stage === 'email' ? (
          <>
            {googleAvailable ? (
              <>
                <a
                  className="btn btn-secondary btn-block btn-lg"
                  href={`${API_URL}/v1/auth/google/start`}
                >
                  Continue with Google
                </a>
                <p className="small muted" style={{ textAlign: 'center' }}>
                  or use your email and password
                </p>
              </>
            ) : null}

            <form onSubmit={signInWithPassword} className="stack">
              <div>
                <label htmlFor="email">Work email address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-block btn-lg"
                disabled={busy || email.trim() === '' || password === ''}
                aria-busy={busy}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            {/*
              The magic link stays available: accounts created before passwords
              existed, and anyone who has forgotten theirs, still need a way in.
              There is no password-reset flow yet, so this is it.
            */}
            <form onSubmit={requestLink} className="stack">
              <button
                type="submit"
                className="btn btn-block"
                disabled={busy || email.trim() === ''}
                aria-busy={busy}
              >
                {busy ? 'Sending…' : 'Email me a sign-in link instead'}
              </button>
            </form>

            <p className="small muted" style={{ textAlign: 'center' }}>
              No account yet? <Link href="/register">Create one</Link>.
            </p>
          </>
        ) : (
          <form onSubmit={verify} className="stack">
            <div>
              <label htmlFor="code">Sign-in code from the email</label>
              <input
                id="code"
                type="text"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <p className="hint">
                In local development the link is written to the mail outbox directory and the API
                log rather than being sent.
              </p>
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-block btn-lg"
              disabled={busy || code.trim() === ''}
              aria-busy={busy}
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button type="button" className="btn btn-block" onClick={() => setStage('email')}>
              Use a different address
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

/**
 * `useSearchParams` opts a route into client-side rendering, so Next requires a
 * Suspense boundary around it. The fallback is the same card chrome so the page
 * does not visibly jump.
 */
export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main id="main" className="page">
          <div className="card">
            <h1>Sign in to ExtraWork</h1>
            <p className="muted">Loading…</p>
          </div>
        </main>
      }
    >
      <SignInForm />
    </Suspense>
  );
}

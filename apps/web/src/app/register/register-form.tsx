'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API_URL, ApiError, api } from '@/lib/api';
import { BOT_CHALLENGE_ENABLED, BotChallenge } from '@/components/bot-challenge';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Create an account, then sign straight in.
 *
 * Registration deliberately returns the same response whether or not the
 * address was already taken, so this form cannot be used to discover which
 * emails exist. That means it cannot report "already registered" either — it
 * attempts the sign-in immediately afterwards, and a wrong password on an
 * existing address surfaces as an ordinary sign-in failure.
 */
export function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [sent, setSent] = useState(false);
  const [exists, setExists] = useState(false);
  const [botToken, setBotToken] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`${API_URL}/v1/auth/methods`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { google?: boolean } | null) => setGoogleAvailable(Boolean(m?.google)))
      .catch(() => undefined);
  }, []);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api('/v1/auth/register', {
        method: 'POST',
        body: {
          email: email.trim(),
          password,
          displayName: name.trim(),
          botToken: botToken ?? undefined,
        },
      });
      // No automatic sign-in any more. The account exists but the address is
      // unproved, and password sign-in is refused until it is confirmed —
      // signing in here would simply fail, and doing it silently would leave
      // the person staring at an error for a step that worked.
      setSent(true);
    } catch (cause) {
      setExists(cause instanceof ApiError && cause.code === 'EMAIL_ALREADY_REGISTERED');
      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="card">
        <h1>Check your email</h1>
        <p>
          We have sent a confirmation link to <strong>{email.trim()}</strong>. Open it to prove the
          address is yours, then sign in.
        </p>
        <p className="small muted">
          The link lasts 24 hours. Nothing else happens until you use it — you can close this page.
        </p>
        <p className="small muted">
          Nothing arrived? <Link href="/verify-email">Request a new link</Link>.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h1>Create your ExtraWork account</h1>
      <p className="muted">Free to set up. You can add your projects and team afterwards.</p>

      {googleAvailable ? (
        <>
          <div className="actions" style={{ marginTop: 'var(--space-4)' }}>
            <a className="button button-secondary" href={`${API_URL}/v1/auth/google/start`}>
              Continue with Google
            </a>
          </div>
          <p className="small muted" style={{ textAlign: 'center' }}>
            or use an email and password
          </p>
        </>
      ) : null}

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="reg-name">Your name</label>
          <input
            id="reg-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={120}
          />
        </div>

        <div className="field">
          <label htmlFor="reg-email">Email</label>
          <input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        <div className="field">
          <label htmlFor="reg-password">Password</label>
          <input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            aria-describedby="reg-password-help"
          />
          <p id="reg-password-help" className="small muted">
            At least {MIN_PASSWORD_LENGTH} characters. Length matters far more than symbols.
          </p>
        </div>

        {error ? (
          <p role="alert" className="error-text">
            {error}
            {exists ? (
              <>
                {' '}
                <Link href="/sign-in">Go to sign in</Link>.
              </>
            ) : null}
          </p>
        ) : null}

        <BotChallenge onToken={setBotToken} />

        <div className="actions">
          <button
            type="submit"
            className="button"
            disabled={busy || (BOT_CHALLENGE_ENABLED && !botToken)}
          >
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>

      <p className="small muted">
        Already have an account? <Link href="/sign-in">Sign in</Link>.
      </p>
    </section>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL, ApiError, api } from '@/lib/api';

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
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleAvailable, setGoogleAvailable] = useState(false);

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
        body: { email: email.trim(), password, displayName: name.trim() },
      });
      await api('/v1/auth/password', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      router.push('/app/dashboard');
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.code === 'UNAUTHENTICATED'
            ? 'That email is already registered. Try signing in instead.'
            : cause.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
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
          </p>
        ) : null}

        <div className="actions">
          <button type="submit" className="button" disabled={busy}>
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

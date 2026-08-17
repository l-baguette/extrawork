'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';

/**
 * Organization setup — report §6.2 `/app/onboarding`: business identity,
 * timezone, currency, first project.
 *
 * Creating the organization, the owner membership and the trial subscription
 * happens in one API transaction, so a half-created tenant cannot exist.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/v1/organizations', {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: {
          displayName: displayName.trim(),
          ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
          ...(gstin.trim() ? { gstin: gstin.trim().toUpperCase() } : {}),
          timezone: 'Asia/Kolkata',
          defaultCurrency: 'INR',
        },
      });
      router.push('/app/projects/new');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Setup could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <h1 style={{ marginBottom: 'var(--space-3)' }}>Set up your business</h1>
      <p className="muted">
        This name appears on every approval link and evidence pack your customers see.
      </p>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <form onSubmit={submit} className="card stack">
        <div>
          <label htmlFor="display-name">Business name</label>
          <input
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Shree Interiors"
            required
          />
        </div>
        <div>
          <label htmlFor="legal-name">Registered legal name (optional)</label>
          <input
            id="legal-name"
            value={legalName}
            onChange={(event) => setLegalName(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="gstin">GSTIN (optional)</label>
          <input
            id="gstin"
            value={gstin}
            onChange={(event) => setGstin(event.target.value)}
            placeholder="29AABCS1429B1ZK"
          />
          <p className="hint">
            Shown on evidence packs. ExtraWork does not issue statutory tax invoices.
          </p>
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-block btn-lg"
          disabled={busy || displayName.trim() === ''}
          aria-busy={busy}
        >
          {busy ? 'Setting up…' : 'Continue'}
        </button>
      </form>
    </main>
  );
}

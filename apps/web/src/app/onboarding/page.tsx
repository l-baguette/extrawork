'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BUSINESS_TYPE_LABELS,
  COLLABORATOR_PARTY_LABELS,
  type AcceptedInvitationDto,
  type BusinessType,
  type PendingInvitationDto,
} from '@extrawork/contracts';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { formatDate } from '@/lib/format';

/**
 * Organization setup — report §6.2 `/app/onboarding`: business identity,
 * timezone, currency, first project.
 *
 * Creating the organization, the owner membership and the subscription happens
 * in one API transaction, so a half-created tenant cannot exist.
 *
 * Spec 2026-10-12, D1: someone invited to a project — typically a contractor
 * with no firm on ExtraWork — lands here after signing up. Their invitations
 * come first, so joining the project never requires creating a business they
 * do not need. Setting up their own business stays available below.
 */

const BUSINESS_TYPES = Object.entries(BUSINESS_TYPE_LABELS) as Array<[BusinessType, string]>;

export default function OnboardingPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [invitations, setInvitations] = useState<PendingInvitationDto[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ items: PendingInvitationDto[] }>('/v1/invitations/pending')
      .then((result) => {
        if (!cancelled) setInvitations(result.items);
      })
      .catch(() => {
        // Signed out or unreachable: the setup form below still works, and the
        // invitation email holds the link either way.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function accept(invitation: PendingInvitationDto): Promise<void> {
    if (accepting) return;
    setAccepting(invitation.id);
    setInviteError(null);
    try {
      const accepted = await api<AcceptedInvitationDto>('/v1/invitations/accept-pending', {
        method: 'POST',
        body: { invitationId: invitation.id },
      });
      router.push(`/app/projects/${accepted.projectId}`);
      router.refresh();
    } catch (caught) {
      setAccepting(null);
      setInviteError(
        caught instanceof ApiError ? caught.message : 'Could not accept. Please try again.',
      );
    }
  }

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
          ...(businessType ? { businessType } : {}),
          timezone: 'Asia/Kolkata',
          defaultCurrency: 'INR',
        },
      });
      // Straight to settings: the business now exists but holds only a name.
      // GSTIN, contact number, timezone and retention are all still blank, and
      // the contact number in particular is printed in every customer message
      // as the channel they can verify the request through.
      router.push('/app/settings');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Setup could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      {invitations.length > 0 ? (
        <section style={{ marginBottom: 'var(--s6)' }} aria-labelledby="invited-heading">
          <h1 id="invited-heading" style={{ marginBottom: 'var(--space-3)' }}>
            You have been invited
          </h1>
          <p className="muted">
            Join the project you were invited to. You do not need to set up a business of your own
            for this.
          </p>
          {inviteError ? (
            <div className="banner banner-error" role="alert">
              {inviteError}
            </div>
          ) : null}
          <ul className="invite-list">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="card invite-card">
                <div>
                  <strong>{invitation.projectTitle}</strong>
                  <div className="small muted">
                    {invitation.organizationName}
                    {invitation.invitedByName ? ` · invited by ${invitation.invitedByName}` : ''}
                  </div>
                  <div className="small muted">
                    As {COLLABORATOR_PARTY_LABELS[invitation.party].toLowerCase()} · open until{' '}
                    {formatDate(invitation.expiresAt)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void accept(invitation)}
                  disabled={accepting !== null}
                  aria-busy={accepting === invitation.id}
                >
                  {accepting === invitation.id ? 'Joining…' : 'Accept'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h1 style={{ marginBottom: 'var(--space-3)' }}>
        {invitations.length > 0 ? 'Or set up your own business' : 'Set up your business'}
      </h1>
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
          <label htmlFor="business-type">What kind of business is it?</label>
          <select
            id="business-type"
            value={businessType}
            onChange={(event) => setBusinessType(event.target.value as BusinessType | '')}
          >
            <option value="">Choose one (optional)</option>
            {BUSINESS_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
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
          className={
            invitations.length > 0 ? 'btn btn-block btn-lg' : 'btn btn-primary btn-block btn-lg'
          }
          disabled={busy || displayName.trim() === ''}
          aria-busy={busy}
        >
          {busy ? 'Setting up…' : 'Set up my own business'}
        </button>
      </form>
    </main>
  );
}

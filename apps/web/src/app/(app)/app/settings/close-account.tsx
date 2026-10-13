'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { ACCOUNT_DELETION_GRACE_DAYS, type OrganizationDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * Closing the account.
 *
 * Two things are deliberately awkward here. The owner has to type the business
 * name, and the consequences are spelled out *before* the control rather than
 * in a modal that appears after the click — a confirmation people have already
 * decided to dismiss is not a confirmation.
 *
 * The one thing this screen must not do is imply that every trace disappears.
 * Recorded decisions survive, because they are the customer's evidence too, and
 * a page that promised otherwise would be making a promise the database is
 * built to refuse.
 */
export function CloseAccount({ organization }: { organization: OrganizationDto }) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = organization.status === 'CLOSED';

  async function close(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/v1/organizations/closure', {
        method: 'POST',
        body: { confirmName, reason: reason.trim() || undefined },
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not close the account.');
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/organizations/closure', { method: 'DELETE' });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not reopen the account.');
    } finally {
      setBusy(false);
    }
  }

  if (closed) {
    return (
      <div className="panel panel-pad stack">
        <p className="error-text">
          This account is closed and scheduled for deletion
          {organization.purgeAfter ? ` on ${formatDay(organization.purgeAfter)}` : ''}.
        </p>
        <p className="small">
          Until then everything stays readable and exportable, but no new requests can be sent.
          Reopening restores the account exactly as it was.
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={reopen} disabled={busy}>
            {busy ? 'Reopening…' : 'Reopen this account'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="panel panel-pad stack" onSubmit={close}>
      <p className="small">
        Closing keeps your account recoverable for{' '}
        <strong>{ACCOUNT_DELETION_GRACE_DAYS} days</strong>, then deletes it. During that window you
        can still sign in, read everything and take an export — but you cannot send new requests.
      </p>

      <div className="panel panel-pad">
        <p className="small" style={{ marginTop: 0 }}>
          <strong>What deletion removes:</strong> your business profile, team, customers and their
          contact details, projects, drafts and attachments.
        </p>
        <p className="small" style={{ marginBottom: 0 }}>
          <strong>What it cannot remove:</strong> change requests you already sent and the decisions
          your customers made on them. Those are the contractual record your customer relies on as
          much as you do, and they are append-only by design. The{' '}
          <Link href="/legal/privacy">Privacy Policy</Link> sets out exactly what is kept and why.
        </p>
      </div>

      <div className="field">
        <label htmlFor="close-confirm">
          Type <strong>{organization.displayName}</strong> to confirm
        </label>
        <input
          id="close-confirm"
          className="input-mono"
          value={confirmName}
          onChange={(event) => setConfirmName(event.target.value)}
          autoComplete="off"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="close-reason">Why are you leaving? (optional)</label>
        <input
          id="close-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
        />
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="actions">
        <button
          type="submit"
          className="btn btn-danger"
          disabled={busy || confirmName.trim() !== organization.displayName.trim()}
        >
          {busy ? 'Closing…' : 'Close this account'}
        </button>
      </div>
    </form>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

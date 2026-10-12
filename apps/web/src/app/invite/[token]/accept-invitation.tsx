'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AcceptedInvitationDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * The Accept button. On success the API has already moved the session into
 * the host workspace, so the project opens inside it.
 */
export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; mismatch: boolean } | null>(null);

  async function accept(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await api<AcceptedInvitationDto>('/v1/invitations/accept', {
        method: 'POST',
        body: { token },
      });
      router.push(`/app/projects/${accepted.projectId}`);
      router.refresh();
    } catch (caught) {
      setBusy(false);
      if (caught instanceof ApiError) {
        setError({
          message: caught.message,
          mismatch: caught.code === 'INVITATION_EMAIL_MISMATCH',
        });
      } else {
        setError({ message: 'Could not accept the invitation. Try again.', mismatch: false });
      }
    }
  }

  async function switchAccount(): Promise<void> {
    try {
      await api('/v1/auth/sign-out', { method: 'POST' });
    } finally {
      // Back to this page signed out, where it offers sign-in for the right address.
      router.refresh();
    }
  }

  return (
    <div className="stack">
      {error ? (
        <div className="banner banner-error" role="alert">
          {error.message}
          {error.mismatch ? (
            <>
              {' '}
              <button type="button" className="btn btn-sm btn-quiet" onClick={switchAccount}>
                Sign out and use another account
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className="btn btn-primary btn-block btn-lg"
        onClick={() => void accept()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Joining…' : 'Accept and open the project'}
      </button>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { COLLABORATOR_PARTY_LABELS, type PendingInvitationDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * Invitations waiting for a signed-in member — spec 2026-10-12, D1.
 *
 * A designer who already has a workspace can be invited onto another firm's
 * project; the email may be buried, so the shell says so. Fetched once when the
 * shell mounts (it stays mounted across navigation), and dismissible for the
 * browser session: the dismissal remembers which invitations were showing, so
 * a new one brings the banner back.
 */

const DISMISSED_KEY = 'ew_pending_invites_dismissed';

function readDismissed(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function PendingInvitationsBanner() {
  const [items, setItems] = useState<PendingInvitationDto[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ items: PendingInvitationDto[] }>('/v1/invitations/pending')
      .then((result) => {
        if (cancelled) return;
        const dismissed = readDismissed();
        setItems(result.items.filter((item) => !dismissed.has(item.id)));
      })
      .catch(() => {
        // Not worth an error on every page: the email still holds the link.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  function dismiss(): void {
    try {
      const dismissed = readDismissed();
      for (const item of items) dismissed.add(item.id);
      window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
    } catch {
      // Private mode: dismissing still works for this page view.
    }
    setItems([]);
  }

  async function accept(item: PendingInvitationDto): Promise<void> {
    if (accepting) return;
    setAccepting(item.id);
    setError(null);
    try {
      const accepted = await api<{ organizationId: string; projectId: string }>(
        '/v1/invitations/accept-pending',
        { method: 'POST', body: { invitationId: item.id } },
      );
      // The session now points at the other workspace; a full load makes sure
      // nothing cached from this one is shown inside it.
      window.location.assign(`/app/projects/${accepted.projectId}`);
    } catch (caught) {
      setAccepting(null);
      setError(caught instanceof ApiError ? caught.message : 'Could not accept. Try again.');
    }
  }

  return (
    <div className="banner banner-info invite-banner" role="status">
      <div className="invite-banner-body">
        <strong>
          {items.length === 1
            ? 'You have been invited to a project.'
            : `You have been invited to ${items.length} projects.`}
        </strong>
        <ul className="invite-banner-list">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                {item.projectTitle} <span className="muted">· {item.organizationName}</span>
                <span className="small muted">
                  {' '}
                  · as {COLLABORATOR_PARTY_LABELS[item.party].toLowerCase()}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void accept(item)}
                disabled={accepting !== null}
                aria-busy={accepting === item.id}
              >
                {accepting === item.id ? 'Joining…' : 'Accept'}
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <button type="button" className="btn btn-sm btn-quiet" onClick={dismiss}>
        Not now
      </button>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { ROOM_SUGGESTIONS, type PortalChangeRequestResultDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * "Ask for a change" — the homeowner's one action on the portal (spec
 * 2026-10-12, D5). It reaches the designer as a request to review, priced and
 * sent back for approval; nothing changes on the project because of it. Kept
 * to one required field: a homeowner on a phone should be able to type one
 * sentence and be done.
 */
export function AskForChange({ token }: { token: string }) {
  const [description, setDescription] = useState('');
  const [room, setRoom] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<PortalChangeRequestResultDto | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<PortalChangeRequestResultDto>(
        `/public/v1/portal/${encodeURIComponent(token)}/requests`,
        {
          method: 'POST',
          body: {
            description: description.trim(),
            ...(room.trim() ? { room: room.trim() } : {}),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          },
        },
      );
      setSent(result);
      setDescription('');
      setRoom('');
      setReason('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not send. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="ask-heading">
      <h2 id="ask-heading">Ask for a change</h2>
      {sent ? (
        <div className="banner banner-success" role="status">
          {sent.message}
        </div>
      ) : null}
      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}
      <form onSubmit={submit} className="stack">
        <div className="field">
          <label htmlFor="ask-description">What would you like changed?</label>
          <textarea
            id="ask-description"
            rows={3}
            required
            maxLength={4000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="For example: a second power point beside the bed"
          />
        </div>
        <div className="field">
          <label htmlFor="ask-room">Where (optional)</label>
          <input
            id="ask-room"
            list="ask-room-suggestions"
            maxLength={80}
            value={room}
            onChange={(event) => setRoom(event.target.value)}
          />
          <datalist id="ask-room-suggestions">
            {ROOM_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="ask-reason">Why (optional)</label>
          <input
            id="ask-reason"
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <p className="hint">
          Your designer will review it and send you the price and timing to approve. Nothing changes
          until you approve it.
        </p>
        <div className="actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || description.trim().length === 0}
            aria-busy={busy}
          >
            {busy ? 'Sending…' : 'Send to my designer'}
          </button>
        </div>
      </form>
    </section>
  );
}

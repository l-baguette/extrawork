'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';

/**
 * Close a finished project, or reopen one — a snag list after handover, a
 * phase two. Closing asks for a reason because it starts the retention clock
 * and stops new requests; the reason goes into the audit record.
 */
export function ProjectLifecycle({ projectId, closed }: { projectId: string; closed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const trimmed = reason.trim();
    if (!closed && !trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/projects/${projectId}/${closed ? 'reopen' : 'close'}`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
        body: trimmed ? { reason: trimmed } : {},
      });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="lifecycle">
      <h2 id="lifecycle">{closed ? 'Reopen this project' : 'Close this project'}</h2>
      <p className="small muted">
        {closed
          ? 'Reopening lets the team raise and send requests again. The record so far is unchanged.'
          : 'Closing keeps the whole record readable and downloadable, and stops new requests. Requests still waiting on the homeowner must be decided or cancelled first.'}
      </p>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {open ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor="lifecycle-reason">
              {closed ? 'Why is it reopening? (optional)' : 'Why is it closing?'}
            </label>
            <input
              id="lifecycle-reason"
              type="text"
              maxLength={2000}
              required={!closed}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={closed ? 'Snag list after handover' : 'Handed over to the homeowner'}
            />
          </div>
          <div className="actions">
            <button
              type="submit"
              className={closed ? 'btn btn-primary' : 'btn btn-danger'}
              disabled={busy || (!closed && !reason.trim())}
            >
              {busy ? 'Saving…' : closed ? 'Reopen project' : 'Close project'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {closed ? 'Reopen…' : 'Close…'}
        </button>
      )}
    </section>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { browserApiUrl } from '@/lib/api';

interface SimSender {
  id: string;
  kind: 'EMPLOYEE' | 'CONTACT';
  name: string;
  phoneE164: string;
  organizationName: string;
  detail: string | null;
}

interface SimAttachment {
  base64: string;
  mimeType: string;
  filename: string;
  byteSize: number;
}

/** Mirrors the API's cap on simulated attachments. */
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

interface OutboxRecord {
  id: string;
  sentAt: string;
  to: string | null;
  toName: string;
  purpose: string;
  body: string;
}

interface SendResult {
  status: string;
  reply: string;
  changeOrderId: string | null;
  approvalUrl: string | null;
  duplicate: boolean;
  mediaStored?: number;
}

/** Reads as the sender sees it: what they get told, and whether it worked. */
const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  ACCEPTED: { label: 'Request raised', tone: 'chip-approved' },
  SAVED: { label: 'Saved to the project', tone: 'chip-approved' },
  AWAITING_CHOICE: { label: 'Asked which project', tone: 'chip-pending' },
  ANSWERED: { label: 'Answered', tone: 'chip-approved' },
  RECEIVED: { label: 'Received', tone: 'chip-pending' },
  REJECTED_UNKNOWN_SENDER: { label: 'Number not recognised', tone: 'chip-declined' },
  REJECTED_NOT_AUTHORIZED: { label: 'Project not resolved', tone: 'chip-declined' },
  REJECTED_UNPARSEABLE: { label: 'Could not read the message', tone: 'chip-draft' },
  REJECTED_POLICY: { label: 'Refused by policy', tone: 'chip-declined' },
};

const EXAMPLE = `Project: Tower 4
What: Two extra power points in the kitchen
Why: Client changed the appliance layout
Cost: 15800
Days: 2`;

export function SimulatorConsole() {
  const apiUrl = browserApiUrl();
  const [senders, setSenders] = useState<SimSender[]>([]);
  const [attachment, setAttachment] = useState<SimAttachment | null>(null);
  const [from, setFrom] = useState('');
  const [body, setBody] = useState(EXAMPLE);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxRecord[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);

  const refreshOutbox = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/webhooks/v1/simulator/outbox?limit=20`);
      if (!response.ok) return;
      const data = (await response.json()) as { items: OutboxRecord[] };
      setOutbox([...data.items].reverse());
    } catch {
      // The console is a dev aid; a failed poll is not worth an error banner.
    }
  }, [apiUrl]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`${apiUrl}/webhooks/v1/simulator/senders`);
        if (!response.ok) {
          setAvailable(false);
          return;
        }
        const data = (await response.json()) as { items: SimSender[] };
        setSenders(data.items);
        setFrom((current) => current || (data.items[0]?.phoneE164 ?? ''));
        setAvailable(true);
      } catch {
        setAvailable(false);
      }
    })();
    void refreshOutbox();
  }, [apiUrl, refreshOutbox]);

  async function send(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`${apiUrl}/webhooks/v1/simulator/whatsapp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          body,
          ...(attachment
            ? {
                media: [
                  {
                    base64: attachment.base64,
                    mimeType: attachment.mimeType,
                    filename: attachment.filename,
                  },
                ],
              }
            : {}),
        }),
      });
      const data = (await response.json()) as SendResult & {
        error?: { message: string };
      };
      if (!response.ok) {
        setError(data.error?.message ?? 'That message could not be delivered.');
        return;
      }
      setResult(data);
      setAttachment(null);
      // The customer message is delivered by the worker, so it lands a moment
      // after the reply. One delayed refresh is enough to show it.
      await refreshOutbox();
      setTimeout(() => void refreshOutbox(), 2500);
    } catch {
      setError(`Could not reach the API at ${apiUrl}. Open ${apiUrl}/healthz to check it.`);
    } finally {
      setBusy(false);
    }
  }

  if (available === false) {
    return (
      <div className="card">
        <h2>The simulator is switched off</h2>
        <p className="muted">
          These endpoints only exist when the API runs with <code>WHATSAPP_DRIVER=simulator</code>{' '}
          outside production. Set it in <code>.env</code> and restart the API.
        </p>
      </div>
    );
  }

  const selected = senders.find((s) => s.phoneE164 === from);

  function pickFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError('Pick a file under 2 MB — the simulator keeps attachments small.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      setAttachment({
        base64: url.slice(url.indexOf(',') + 1),
        mimeType: file.type || 'application/octet-stream',
        filename: file.name,
        byteSize: file.size,
      });
      setError(null);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Send as site team or a homeowner</h2>

        <form onSubmit={send}>
          <div className="field">
            <label htmlFor="sim-from">From (their WhatsApp number)</label>
            {senders.length > 0 ? (
              <select id="sim-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                {senders.map((sender) => (
                  <option key={`${sender.kind}:${sender.id}`} value={sender.phoneE164}>
                    {sender.name} — {sender.phoneE164} ({sender.organizationName})
                  </option>
                ))}
                <option value="+919999900000">An unregistered number</option>
              </select>
            ) : (
              <>
                <input
                  id="sim-from"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder="98765 43210"
                  inputMode="tel"
                />
                <p className="small muted">
                  No site team or homeowner numbers yet. Add one on{' '}
                  <Link href="/app/employees">Employees</Link> or a customer first, or type any
                  number to see what an unrecognised sender gets told.
                </p>
              </>
            )}
            {selected?.detail ? <p className="small muted">{selected.detail}</p> : null}
          </div>

          <div className="field">
            <label htmlFor="sim-body">Message</label>
            <textarea
              id="sim-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              style={{ fontFamily: 'var(--font-mono, monospace)' }}
            />
            <p className="small muted">
              Any order, any case. Try a change (<code>can we add a light in the bedroom</code>), a
              plain note, an ambiguous amount like <code>15-20k</code>, or a word: <code>help</code>
              , <code>projects</code>, <code>status</code>, <code>contracts</code>,{' '}
              <code>request</code>, <code>file</code>.
            </p>
          </div>

          <div className="field">
            <label htmlFor="sim-file">Attachment (optional, under 2 MB)</label>
            <input
              id="sim-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={pickFile}
            />
            {attachment ? (
              <p className="small muted">
                {attachment.filename} · {Math.ceil(attachment.byteSize / 1024)} KB{' '}
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => setAttachment(null)}
                >
                  Remove
                </button>
              </p>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="error-text">
              {error}
            </p>
          ) : null}

          <div className="actions">
            <button
              type="submit"
              className="button"
              disabled={busy || !from || (!body.trim() && !attachment)}
            >
              {busy ? 'Sending…' : 'Send message'}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setBody(EXAMPLE)}
              disabled={busy}
            >
              Reset example
            </button>
          </div>
        </form>
      </section>

      {result ? (
        <section className="card">
          <h2>
            What the sender gets back{' '}
            <span className={`chip ${STATUS_COPY[result.status]?.tone ?? 'chip-draft'}`}>
              {STATUS_COPY[result.status]?.label ?? result.status}
            </span>
          </h2>
          {result.duplicate ? (
            <p className="small muted">
              This message id had already been processed, so the stored outcome was replayed rather
              than creating a second request.
            </p>
          ) : null}

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: 'var(--color-surface-2, rgba(0,0,0,0.04))',
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {result.reply}
          </pre>

          {result.mediaStored ? (
            <p className="small muted">
              {result.mediaStored} attachment{result.mediaStored === 1 ? '' : 's'} fetched and
              queued for scanning (the worker scans it).
            </p>
          ) : null}

          {result.approvalUrl ? (
            <p>
              <a href={result.approvalUrl} target="_blank" rel="noreferrer" className="button">
                Open the customer’s approval link
              </a>
            </p>
          ) : null}
          {result.changeOrderId ? (
            <p className="small">
              <Link href={`/app/changes/${result.changeOrderId}`}>
                See it in the contractor dashboard
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="card">
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Messages sent on WhatsApp</h2>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => void refreshOutbox()}
          >
            Refresh
          </button>
        </div>

        {outbox.length === 0 ? (
          <p className="muted">
            Nothing sent yet. An accepted request messages the customer a moment later — the worker
            delivers it, so give it a second and refresh.
          </p>
        ) : (
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {outbox.map((record) => (
              <li
                key={record.id}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-3)',
                }}
              >
                <div className="small muted">
                  To {record.toName} · {record.to} · {record.purpose}
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{record.body}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

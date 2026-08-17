'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ChangeOrderDto,
  EvidenceDocumentDto,
  RemindResultSchema,
  SendResultDto,
} from '@extrawork/contracts';
import type { z } from 'zod';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { SharePanel } from '@/features/composer/share-panel';

type RemindResult = z.infer<typeof RemindResultSchema>;

/**
 * The actions available on a change, gated by its state — report §4.3.
 *
 * The UI hides what is not permitted, but the backend is authoritative
 * (report §3.2), so a state the server rejects surfaces as an error here rather
 * than being silently swallowed.
 */
export function ChangeActions({ change }: { change: ChangeOrderDto }) {
  const router = useRouter();
  const version = change.currentVersion;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reminder, setReminder] = useState<RemindResult | null>(null);
  const [sendResult, setSendResult] = useState<SendResultDto | null>(null);
  const [evidence, setEvidence] = useState<EvidenceDocumentDto | null>(null);

  const isOpen = version.status === 'SENT' || version.status === 'VIEWED';
  const isDraft = version.status === 'DRAFT';
  const canRevise = ['SENT', 'VIEWED', 'REVISION_REQUESTED', 'EXPIRED', 'DECLINED'].includes(
    version.status,
  );
  const isDecided = ['APPROVED', 'DECLINED', 'REVISION_REQUESTED'].includes(version.status);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? `${caught.message} (reference ${caught.requestId})`
          : 'That action could not be completed.',
      );
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (sendResult) {
    return (
      <SharePanel
        result={sendResult}
        changeOrderId={change.id}
        onDone={() => {
          setSendResult(null);
          router.refresh();
        }}
      />
    );
  }

  return (
    <section className="card" aria-labelledby="actions-heading">
      <h2 id="actions-heading">Actions</h2>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="stack">
        {isDraft ? (
          <>
            <a className="btn btn-block" href={`/app/projects/${change.projectId}/changes/new`}>
              Continue editing this draft
            </a>
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={busy !== null}
              onClick={() =>
                void run('send', async () => {
                  const result = await api<SendResultDto>(`/v1/change-orders/${change.id}/send`, {
                    method: 'POST',
                    idempotencyKey: newIdempotencyKey(),
                    body: { channel: 'WHATSAPP_NATIVE_SHARE' },
                  });
                  setSendResult(result);
                })
              }
            >
              {busy === 'send' ? 'Sending…' : 'Freeze and send'}
            </button>
          </>
        ) : null}

        {isOpen ? (
          <button
            type="button"
            className="btn btn-block"
            disabled={busy !== null}
            onClick={() =>
              void run('remind', async () => {
                const result = await api<RemindResult>(`/v1/change-orders/${change.id}/reminders`, {
                  method: 'POST',
                  idempotencyKey: newIdempotencyKey(),
                  body: { channel: 'WHATSAPP_NATIVE_SHARE' },
                });
                setReminder(result);
              })
            }
          >
            {busy === 'remind' ? 'Preparing…' : 'Send a reminder'}
          </button>
        ) : null}

        {canRevise ? (
          <button
            type="button"
            className="btn btn-block"
            disabled={busy !== null}
            onClick={() =>
              void run('revise', async () => {
                await api(`/v1/change-orders/${change.id}/revisions`, {
                  method: 'POST',
                  idempotencyKey: newIdempotencyKey(),
                  body: {},
                });
                router.refresh();
              })
            }
          >
            {busy === 'revise' ? 'Creating…' : 'Create a new version'}
          </button>
        ) : null}

        {isDecided ? (
          <button
            type="button"
            className="btn btn-block"
            disabled={busy !== null}
            onClick={() =>
              void run('evidence', async () => {
                const result = await api<EvidenceDocumentDto>(
                  `/v1/change-orders/${change.id}/evidence`,
                );
                setEvidence(result);
                if (result.downloadUrl) window.location.href = result.downloadUrl;
              })
            }
          >
            {busy === 'evidence' ? 'Preparing…' : 'Download the evidence pack'}
          </button>
        ) : null}

        {(isDraft || isOpen) && version.status !== 'CANCELLED' ? (
          <button
            type="button"
            className="btn btn-danger btn-block"
            disabled={busy !== null}
            onClick={() => {
              const reason = window.prompt('Why are you cancelling this request?');
              if (!reason) return;
              void run('cancel', async () => {
                await api(`/v1/change-orders/${change.id}/cancel`, {
                  method: 'POST',
                  idempotencyKey: newIdempotencyKey(),
                  body: { reason },
                });
                router.refresh();
              });
            }}
          >
            Cancel this request
          </button>
        ) : null}
      </div>

      {reminder ? (
        <div className="banner banner-info" style={{ marginTop: 'var(--space-4)' }}>
          <p>
            <strong>Reminder ready to send.</strong> ExtraWork does not message your customer
            automatically — send this from your own WhatsApp.
          </p>
          {reminder.whatsappUrl ? (
            <a
              className="btn btn-primary btn-block"
              href={reminder.whatsappUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}

      {evidence && !evidence.downloadUrl ? (
        <div className="banner banner-info" style={{ marginTop: 'var(--space-4)' }} role="status">
          The evidence pack is still being prepared ({evidence.status.toLowerCase()}). The decision
          itself is already recorded — refresh in a moment to download it.
        </div>
      ) : null}
    </section>
  );
}

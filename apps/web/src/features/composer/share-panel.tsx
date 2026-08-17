'use client';

import { useState } from 'react';
import type { SendResultDto } from '@extrawork/contracts';
import { api } from '@/lib/api';

/**
 * Native WhatsApp share — report §10.3 Phase 0.
 *
 * The backend has already frozen the version and minted the link. This panel
 * hands the contractor a `https://wa.me/...` deep link so they send from their
 * own WhatsApp account, and records SHARE_INTENT_OPENED — never MESSAGE_SENT,
 * because the application cannot observe delivery.
 *
 * Report §6.8 requires the fallbacks: if the native launch fails, Copy link,
 * SMS and email are all present, not hidden behind the WhatsApp button.
 */
export function SharePanel({
  result,
  changeOrderId,
  onDone,
}: {
  result: SendResultDto;
  changeOrderId: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  async function recordIntent(channel: string): Promise<void> {
    setShared(true);
    // Best-effort: failing to record the intent must never block the send the
    // contractor is about to make.
    await api(`/v1/change-orders/${changeOrderId}/share-intent`, {
      method: 'POST',
      body: { channel },
    }).catch(() => undefined);
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(result.approvalUrl);
      setCopied(true);
      void recordIntent('COPY_LINK');
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Clipboard can be blocked; the link is visible below to select manually.
      setCopied(false);
    }
  }

  return (
    <section className="card" aria-labelledby="share-heading">
      <div className="banner banner-success" role="status">
        <h2 id="share-heading" style={{ fontSize: '1.05rem' }}>
          Version frozen and ready to send
        </h2>
        <p className="small" style={{ marginBottom: 0 }}>
          {result.versionNumber === 1 ? 'Version 1' : `Version ${result.versionNumber}`} is locked.
          It cannot be edited — any further change creates a new version.
        </p>
      </div>

      <p>
        Now send it to your customer. ExtraWork opens WhatsApp with the message ready; you send it
        from your own number.
      </p>

      {result.share.whatsappUrl ? (
        <a
          className="btn btn-primary btn-block btn-lg"
          href={result.share.whatsappUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => void recordIntent('WHATSAPP_NATIVE_SHARE')}
        >
          Open WhatsApp
        </a>
      ) : (
        <div className="banner banner-warn">
          This contact has no phone number on file, so WhatsApp is unavailable. Use the link or
          email instead.
        </div>
      )}

      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-block" onClick={() => void copyLink()}>
          {copied ? 'Link copied' : 'Copy the link'}
        </button>

        {result.share.mailtoUrl ? (
          <a
            className="btn btn-block"
            href={result.share.mailtoUrl}
            onClick={() => void recordIntent('EMAIL')}
          >
            Send by email
          </a>
        ) : null}

        {result.share.smsUrl ? (
          <a
            className="btn btn-block"
            href={result.share.smsUrl}
            onClick={() => void recordIntent('SMS')}
          >
            Send by SMS
          </a>
        ) : null}
      </div>

      <details style={{ marginTop: 'var(--space-4)' }}>
        <summary className="small muted">Show the link</summary>
        <p
          className="small"
          style={{
            wordBreak: 'break-all',
            background: 'var(--surface-3)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius)',
            marginTop: 'var(--space-2)',
          }}
        >
          {result.approvalUrl}
        </p>
        <p className="small muted">
          This link is shown once. ExtraWork stores only a hash of it, so it cannot be recovered
          later — but you can always send a reminder or a new version.
        </p>
      </details>

      <button
        type="button"
        className="btn btn-block"
        style={{ marginTop: 'var(--space-4)' }}
        onClick={onDone}
      >
        {shared ? 'Done' : 'I will send it later'}
      </button>
    </section>
  );
}

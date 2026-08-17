'use client';

import { useState } from 'react';
import { ASSURANCE_COPY, EVIDENCE_DISCLAIMER, type RequestTemplateDto } from '@extrawork/contracts';
import { ApiError, api } from '@/lib/api';

/**
 * Editor plus live preview. The preview matters more than it looks: the owner
 * is writing copy that gets frozen into a contract their customer agrees to, so
 * seeing it rendered as the customer will is the difference between careful
 * wording and guesswork.
 */
export function TemplateEditor({ initial }: { initial: RequestTemplateDto }) {
  const [heading, setHeading] = useState(initial.heading);
  const [intro, setIntro] = useState(initial.intro);
  const [termsBody, setTermsBody] = useState(initial.termsBody);
  const [paymentNote, setPaymentNote] = useState(initial.paymentNote ?? '');
  const [footerNote, setFooterNote] = useState(initial.footerNote ?? '');
  const [version, setVersion] = useState(initial.templateVersion);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api<RequestTemplateDto>('/v1/settings/request-template', {
        method: 'PATCH',
        body: {
          heading: heading.trim(),
          intro: intro.trim(),
          termsBody: termsBody.trim(),
          paymentNote: paymentNote.trim() === '' ? null : paymentNote.trim(),
          footerNote: footerNote.trim() === '' ? null : footerNote.trim(),
        },
      });
      setVersion(updated.templateVersion);
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const a0 = ASSURANCE_COPY.A0;

  return (
    <>
      <section className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="tpl-heading">Heading</label>
            <input
              id="tpl-heading"
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              maxLength={200}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="tpl-intro">Introduction</label>
            <textarea
              id="tpl-intro"
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="field">
            <label htmlFor="tpl-terms">Terms</label>
            <textarea
              id="tpl-terms"
              value={termsBody}
              onChange={(e) => setTermsBody(e.target.value)}
              rows={6}
              maxLength={20000}
              aria-describedby="tpl-terms-help"
            />
            <p id="tpl-terms-help" className="small muted">
              Your own conditions for extra work. This is frozen into each request when it is sent.
            </p>
          </div>

          <div className="field">
            <label htmlFor="tpl-payment">Payment note (optional)</label>
            <input
              id="tpl-payment"
              value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
              maxLength={2000}
              placeholder="Billed with the next running account bill"
            />
          </div>

          <div className="field">
            <label htmlFor="tpl-footer">Footer note (optional)</label>
            <input
              id="tpl-footer"
              value={footerNote}
              onChange={(e) => setFooterNote(e.target.value)}
              maxLength={2000}
            />
          </div>

          {error ? (
            <p role="alert" className="error-text">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p role="status" className="small">
              Saved. New requests will use version {version}.
            </p>
          ) : null}

          <div className="actions">
            <button type="submit" className="button" disabled={busy}>
              {busy ? 'Saving…' : 'Save wording'}
            </button>
          </div>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <h2>Preview</h2>
        <p className="small muted">This is what your customer sees.</p>

        <div
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            marginTop: 'var(--space-3)',
          }}
        >
          <h3>{heading || 'Approval requested for additional work'}</h3>
          {intro ? <p>{intro}</p> : null}

          <p className="small muted">
            [ Work details, cost and photos appear here for the actual request ]
          </p>

          {termsBody ? (
            <>
              <h4>Terms</h4>
              <p style={{ whiteSpace: 'pre-wrap' }}>{termsBody}</p>
            </>
          ) : null}
          {paymentNote ? <p className="small">{paymentNote}</p> : null}
          {footerNote ? <p className="small muted">{footerNote}</p> : null}
        </div>
      </section>

      <section className="card">
        <h2>What we tell your customer about this record</h2>
        <p className="small muted">
          This wording is fixed and cannot be edited. It states honestly what an approval through
          ExtraWork is, and what it is not — which is what makes the record worth relying on.
        </p>

        <dl style={{ marginTop: 'var(--space-3)' }}>
          <dt>
            <strong>{a0.label}</strong>
          </dt>
          <dd className="small" style={{ marginBottom: 'var(--space-3)' }}>
            {a0.evidenceStatement}
          </dd>

          <dt>
            <strong>Limitation</strong>
          </dt>
          <dd className="small" style={{ marginBottom: 'var(--space-3)' }}>
            {a0.limitation}
          </dd>

          <dt>
            <strong>Disclaimer</strong>
          </dt>
          <dd className="small">{EVIDENCE_DISCLAIMER}</dd>
        </dl>
      </section>
    </>
  );
}

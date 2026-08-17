'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  signerNameMatches,
  type DecisionReceiptDto,
  type DecisionType,
  type PublicRequestDto,
} from '@extrawork/contracts';
import { ApiError, apiRequest, newIdempotencyKey } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { establishPublicSession } from '@/lib/public-session';
import { OtpStep } from './otp-step';

/**
 * The decision interaction — report §6.7 and §4.5.
 *
 *  - Approve, Decline and Request revision are equally prominent. The decline
 *    control is never hidden or de-emphasised, and no consent is pre-selected.
 *  - The final action goes through a confirmation screen that restates the
 *    exact decision.
 *  - Double submission is prevented in the UI, but correctness rests on backend
 *    idempotency: the key is minted once per user intent and reused across
 *    retries, so a double-tap or a flaky network cannot create two decisions.
 *  - A network failure never implies the decision was recorded (report §13.1).
 */

type Stage = 'choose' | 'verify' | 'confirm' | 'done';

interface Props {
  token: string;
  request: PublicRequestDto;
}

export function DecisionPanel({ token, request }: Props) {
  const [stage, setStage] = useState<Stage>('choose');
  const [type, setType] = useState<DecisionType | null>(null);
  const [signerName, setSignerName] = useState('');
  const [comment, setComment] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [assurance, setAssurance] = useState(request.assurance.achieved);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{
    name?: string;
    comment?: string;
    accept?: string;
  }>({});
  const [receipt, setReceipt] = useState<DecisionReceiptDto | null>(null);

  // One key per intent. Reused on every retry so the server collapses repeats
  // into a single decision (report §7.6).
  const idempotencyKey = useRef<string>(newIdempotencyKey());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // The page was server-rendered, so the public session cookies were issued to
  // the Next.js server rather than to this browser. Establish them here before
  // the customer can submit anything (see lib/public-session).
  useEffect(() => {
    let cancelled = false;
    void establishPublicSession(token).then((state) => {
      if (cancelled) return;
      setCsrfToken(state.csrfToken);
      setSessionError(state.error);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const needsVerification =
    request.assurance.required !== 'A0' && !satisfies(assurance, request.assurance.required);

  // Move focus to the new heading on every stage change so a screen-reader user
  // and a keyboard user both land in the right place (report §6.9).
  useEffect(() => {
    headingRef.current?.focus();
  }, [stage]);

  const declaration = useMemo(() => {
    if (type === 'APPROVE') return request.declarations.approve;
    if (type === 'DECLINE') return request.declarations.decline;
    return request.declarations.requestRevision;
  }, [type, request.declarations]);

  function choose(next: DecisionType): void {
    setType(next);
    setError(null);
    setFieldError({});
    // A fresh intent gets a fresh key: changing the decision is a new command.
    idempotencyKey.current = newIdempotencyKey();
    setStage(needsVerification ? 'verify' : 'confirm');
  }

  function validate(): boolean {
    const errors: typeof fieldError = {};
    if (signerName.trim().length < 2) errors.name = 'Enter your full name.';
    else if (!signerNameMatches(signerName, request.approver.name)) {
      // Checked here purely so the customer is told before submitting; the
      // server enforces the same rule and is what actually decides.
      errors.name = `This request was sent to ${request.approver.name}. Enter that name to sign.`;
    }
    if (type === 'REQUEST_REVISION' && comment.trim().length === 0) {
      errors.comment = 'Tell the contractor what needs to change.';
    }
    if (!accepted) errors.accept = 'Tick the box to confirm.';
    setFieldError(errors);
    return Object.keys(errors).length === 0;
  }

  async function submit(): Promise<void> {
    if (!type || submitting) return;
    if (!validate()) return;

    setSubmitting(true);
    setError(null);
    try {
      const { data } = await apiRequest<DecisionReceiptDto>(
        `/public/v1/requests/${encodeURIComponent(token)}/decisions`,
        {
          method: 'POST',
          idempotencyKey: idempotencyKey.current,
          ifMatch: request.etag,
          ...(csrfToken ? { csrfToken } : {}),
          body: {
            type,
            signerName: signerName.trim(),
            ...(comment.trim() ? { comment: comment.trim() } : {}),
            declarationAccepted: true,
          },
        },
      );
      setReceipt(data);
      setStage('done');
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === 'done' && receipt) {
    return <Receipt receipt={receipt} />;
  }

  return (
    <section className="card" aria-labelledby="decide-heading">
      {stage === 'choose' ? (
        <>
          <h2 id="decide-heading" ref={headingRef} tabIndex={-1}>
            Your decision
          </h2>
          <p className="small muted">Choose one. You can add a note on the next screen.</p>
          <div className="stack">
            <button
              type="button"
              className="btn btn-approve btn-block btn-lg"
              onClick={() => choose('APPROVE')}
            >
              Approve this change
            </button>
            <button
              type="button"
              className="btn btn-block btn-lg"
              onClick={() => choose('REQUEST_REVISION')}
            >
              Ask for a change to this request
            </button>
            <button
              type="button"
              className="btn btn-danger btn-block btn-lg"
              onClick={() => choose('DECLINE')}
            >
              Decline
            </button>
          </div>
        </>
      ) : null}

      {stage === 'verify' && type ? (
        <OtpStep
          token={token}
          maskedContact={request.approver.maskedContact}
          csrfToken={csrfToken}
          onVerified={(level) => {
            setAssurance(level);
            setStage('confirm');
          }}
          onCancel={() => setStage('choose')}
        />
      ) : null}

      {stage === 'confirm' && type ? (
        <>
          <h2 id="decide-heading" ref={headingRef} tabIndex={-1}>
            {type === 'APPROVE'
              ? 'Confirm your approval'
              : type === 'DECLINE'
                ? 'Confirm you are declining'
                : 'Ask for a revision'}
          </h2>

          <div className="banner banner-info" role="note">
            <strong>{request.change.number}</strong> · {request.change.title}
            <div className="tabular" style={{ marginTop: 4 }}>
              {type === 'APPROVE' ? (
                <>
                  {formatMoney(request.commercial.totalDeltaMinor, request.commercial.currency)} ·
                  new contract total{' '}
                  {formatMoney(
                    request.commercial.revisedContractTotalMinor,
                    request.commercial.currency,
                  )}
                </>
              ) : (
                'No cost or schedule change is authorised by this decision.'
              )}
            </div>
          </div>

          {(error ?? sessionError) ? (
            <div className="banner banner-error" role="alert">
              {error ?? sessionError}
            </div>
          ) : null}

          <div className="stack">
            <div>
              <label htmlFor="signer-name">Your full name</label>
              <input
                id="signer-name"
                type="text"
                autoComplete="name"
                enterKeyHint="done"
                value={signerName}
                onChange={(event) => setSignerName(event.target.value)}
                aria-invalid={fieldError.name ? 'true' : undefined}
                aria-describedby={
                  fieldError.name ? 'signer-name-error signer-name-help' : 'signer-name-help'
                }
              />
              {/*
                The typed name is the signature, and the server checks it
                against the recorded approver. Saying whose name is expected
                before they type is the difference between a clear instruction
                and a rejection they cannot explain.
              */}
              <p className="small muted" id="signer-name-help">
                This request was sent to <strong>{request.approver.name}</strong>. Enter that name
                to sign.
              </p>
              {fieldError.name ? (
                <p className="field-error" id="signer-name-error">
                  {fieldError.name}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="comment">
                {type === 'REQUEST_REVISION' ? 'What needs to change?' : 'Add a note (optional)'}
              </label>
              <textarea
                id="comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                aria-invalid={fieldError.comment ? 'true' : undefined}
                aria-describedby={fieldError.comment ? 'comment-error' : undefined}
              />
              {fieldError.comment ? (
                <p className="field-error" id="comment-error">
                  {fieldError.comment}
                </p>
              ) : null}
            </div>

            <div>
              {/* Never pre-checked — report §6.7 forbids preselected consent. */}
              <label className="checkbox" htmlFor="declaration">
                <input
                  id="declaration"
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  aria-invalid={fieldError.accept ? 'true' : undefined}
                  aria-describedby={fieldError.accept ? 'declaration-error' : undefined}
                />
                <span>{declaration}</span>
              </label>
              {fieldError.accept ? (
                <p className="field-error" id="declaration-error">
                  {fieldError.accept}
                </p>
              ) : null}
            </div>
          </div>

          <div className="sticky-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setStage('choose')}
              disabled={submitting}
            >
              Back
            </button>
            <button
              type="button"
              className={`btn btn-block ${type === 'APPROVE' ? 'btn-approve' : 'btn-primary'}`}
              onClick={() => void submit()}
              disabled={submitting || !csrfToken}
              aria-busy={submitting}
            >
              {submitting ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Recording…
                </>
              ) : type === 'APPROVE' ? (
                'Approve'
              ) : type === 'DECLINE' ? (
                'Decline'
              ) : (
                'Send request'
              )}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Receipt({ receipt }: { receipt: DecisionReceiptDto }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <section className="card" aria-labelledby="receipt-heading">
      <div className="banner banner-success" role="status">
        <h2 id="receipt-heading" ref={heading} tabIndex={-1} style={{ fontSize: '1.05rem' }}>
          {receipt.type === 'APPROVE'
            ? 'Approved. Thank you.'
            : receipt.type === 'DECLINE'
              ? 'Declined. Thank you.'
              : 'Sent back to the contractor.'}
        </h2>
        <p className="small" style={{ marginBottom: 0 }}>
          Recorded {new Date(receipt.occurredAt).toLocaleString('en-IN')}
        </p>
      </div>

      <table className="totals">
        <tbody>
          <tr>
            <td>Receipt reference</td>
            <td className="tabular">
              <strong>{receipt.receiptId}</strong>
            </td>
          </tr>
          <tr>
            <td>Name given</td>
            <td>{receipt.signerName}</td>
          </tr>
          <tr>
            <td>Change</td>
            <td>
              {receipt.changeNumber} · v{receipt.versionNumber}
            </td>
          </tr>
          {receipt.type === 'APPROVE' ? (
            <tr>
              <td>New contract total</td>
              <td className="tabular">
                {formatMoney(receipt.revisedContractTotalMinor, receipt.currency)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <p className="small muted">
        Keep the receipt reference. {receipt.organizationName} has been notified.
      </p>

      {/* Report §13.1: the PDF is asynchronous and its absence never blocks or
          invalidates a recorded decision. */}
      {receipt.evidenceUrl ? (
        <a className="btn btn-block" href={receipt.evidenceUrl}>
          Download the record (PDF)
        </a>
      ) : (
        <p className="small muted">
          A PDF copy of this record is being prepared. Your decision is already recorded.
        </p>
      )}

      <p className="small muted" style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}>
        {receipt.assuranceLimitation}
      </p>
    </section>
  );
}

function satisfies(achieved: string, required: string): boolean {
  const rank: Record<string, number> = { A0: 0, A1: 1, A2: 2 };
  return (rank[achieved] ?? 0) >= (rank[required] ?? 0);
}

/**
 * Turns an API failure into something a customer can act on. The wording is
 * careful never to suggest a decision was recorded when it was not.
 */
function messageFor(caught: unknown): string {
  if (!(caught instanceof ApiError)) {
    return 'Something went wrong and your decision was NOT recorded. Please try again.';
  }
  switch (caught.code) {
    case 'ALREADY_DECIDED':
      return 'A decision has already been recorded for this request. Refresh the page to see it.';
    case 'VERSION_SUPERSEDED':
      return 'The contractor has sent a newer version of this request. Ask them for the latest link — this one is no longer current.';
    case 'REQUEST_EXPIRED':
      return 'This link has expired. Ask the contractor to send a new one.';
    case 'TOKEN_REVOKED':
      return 'This link is no longer active. Ask the contractor to send a new one.';
    case 'ETAG_MISMATCH':
      return 'This request changed since you opened it. Refresh the page and review it again before deciding.';
    case 'ASSURANCE_REQUIRED':
      return 'Please complete phone verification before recording your decision.';
    case 'ASSURANCE_UNAVAILABLE':
      return 'Phone verification is unavailable right now, and this request requires it. Your decision was NOT recorded. Please try again shortly.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'SERVICE_UNAVAILABLE':
      return 'Could not reach ExtraWork, so your decision was NOT recorded. Check your connection and try again.';
    default:
      return `${caught.message} Your decision was not recorded. (Reference ${caught.requestId})`;
  }
}

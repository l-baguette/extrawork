'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssuranceLevel, OtpChallengeSchema } from '@extrawork/contracts';
import type { z } from 'zod';
import { ApiError, apiRequest } from '@/lib/api';

/**
 * A1 phone verification — report §3.3 and §4.5.
 *
 * The OTP raises the *session's* assurance level; the decision is only accepted
 * afterwards. Report §13.1 is explicit that the system must never silently
 * downgrade to A0 when verification is unavailable, so a provider failure here
 * blocks the decision and says so plainly.
 */

type Challenge = z.infer<typeof OtpChallengeSchema>;

interface Props {
  token: string;
  maskedContact: string;
  /** Double-submit value for this public session; see lib/public-session. */
  csrfToken: string | null;
  onVerified: (level: AssuranceLevel) => void;
  onCancel: () => void;
}

export function OtpStep({ token, maskedContact, csrfToken, onVerified, onCancel }: Props) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  // Drives the resend countdown without re-rendering the whole page.
  useEffect(() => {
    if (!resendAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  async function requestCode(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiRequest<Challenge>(
        `/public/v1/requests/${encodeURIComponent(token)}/otp`,
        {
          method: 'POST',
          body: { channel: 'SMS' },
          ...(csrfToken ? { csrfToken } : {}),
        },
      );
      setChallenge(data);
      setResendAt(new Date(data.resendAvailableAt).getTime());
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'ASSURANCE_UNAVAILABLE'
          ? 'Verification is unavailable right now. This request requires it, so no decision can be recorded yet. Please try again shortly.'
          : caught instanceof ApiError
            ? caught.message
            : 'Could not send the code. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    if (!challenge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiRequest<{
        verified: boolean;
        assuranceAchieved: AssuranceLevel;
        attemptsRemaining: number;
      }>(`/public/v1/requests/${encodeURIComponent(token)}/otp/verify`, {
        method: 'POST',
        body: { challengeId: challenge.challengeId, code },
        ...(csrfToken ? { csrfToken } : {}),
      });
      if (data.verified) {
        onVerified(data.assuranceAchieved);
        return;
      }
      setError(`That code is not correct. ${data.attemptsRemaining} attempts remaining.`);
      setCode('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not check the code.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  const secondsToResend = resendAt ? Math.max(0, Math.ceil((resendAt - now) / 1000)) : 0;

  return (
    <>
      <h2 ref={heading} tabIndex={-1}>
        Verify it is you
      </h2>
      <p className="small muted">
        This request needs a one-time code. We will send it to {maskedContact}.
      </p>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      {!challenge ? (
        <div className="sticky-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => void requestCode()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="otp-code">6-digit code</label>
            <input
              id="otp-code"
              // `one-time-code` lets iOS and Android offer the SMS code directly.
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ fontSize: '1.5rem', letterSpacing: '0.4em', textAlign: 'center' }}
            />
            <p className="hint">Sent to {challenge.maskedDestination}</p>
          </div>

          <button
            type="button"
            className="btn"
            onClick={() => void requestCode()}
            disabled={busy || secondsToResend > 0}
            style={{ marginTop: 'var(--space-3)' }}
          >
            {secondsToResend > 0 ? `Resend in ${secondsToResend}s` : 'Resend code'}
          </button>

          <div className="sticky-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => void verify()}
              disabled={busy || code.length !== 6}
              aria-busy={busy}
            >
              {busy ? 'Checking…' : 'Verify'}
            </button>
          </div>
        </>
      )}
    </>
  );
}

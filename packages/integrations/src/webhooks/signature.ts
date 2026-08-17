import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@extrawork/contracts';

/**
 * Webhook signature verification — report §12.1: "Webhook signature
 * verification using raw request body and constant-time compare", and §13.2:
 * "Verify signature first, then insert raw event".
 *
 * Every function here takes the RAW body buffer. Verifying a re-serialised JSON
 * body is a classic bypass, so the API keeps the raw bytes and never re-encodes
 * before this point.
 */

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length does not leak through timing alone.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Meta / WhatsApp Cloud API: `X-Hub-Signature-256: sha256=<hex hmac>` over the
 * raw body, keyed by the app secret.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  headerValue: string | undefined,
  appSecret: string,
): boolean {
  if (!headerValue?.startsWith('sha256=')) return false;
  const provided = headerValue.slice('sha256='.length);
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return constantTimeEqual(provided, expected);
}

/** Razorpay: `X-Razorpay-Signature` is a hex HMAC-SHA256 of the raw body. */
export function verifyRazorpaySignature(
  rawBody: Buffer,
  headerValue: string | undefined,
  webhookSecret: string,
): boolean {
  if (!headerValue) return false;
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return constantTimeEqual(headerValue, expected);
}

/**
 * Meta's GET challenge for webhook setup (report §10.3). Returns the challenge
 * to echo, or null when the verify token does not match.
 */
export function resolveMetaChallenge(
  query: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string },
  expectedVerifyToken: string,
): string | null {
  if (query['hub.mode'] !== 'subscribe') return null;
  if (!query['hub.verify_token'] || !query['hub.challenge']) return null;
  if (!constantTimeEqual(query['hub.verify_token'], expectedVerifyToken)) return null;
  return query['hub.challenge'];
}

export function assertSignatureValid(valid: boolean, provider: string): void {
  if (!valid) {
    throw new AppError('WEBHOOK_SIGNATURE_INVALID', { details: { provider } });
  }
}

/**
 * Replay protection. Signature validity alone does not stop a captured payload
 * being resent; the webhook inbox's unique `(provider, account, event id)` is
 * the durable defence, and this adds a timestamp window where the provider
 * supplies one.
 */
export function assertTimestampFresh(
  timestampSeconds: number | undefined,
  toleranceSeconds = 300,
  now: number = Date.now(),
): void {
  if (timestampSeconds === undefined) return;
  const ageSeconds = Math.abs(now / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) {
    throw new AppError('WEBHOOK_SIGNATURE_INVALID', {
      message: 'Webhook timestamp is outside the accepted window.',
      details: { ageSeconds: Math.round(ageSeconds) },
    });
  }
}

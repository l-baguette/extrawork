import { createHash } from 'node:crypto';

/**
 * Log redaction. Report §11.5 forbids plaintext tokens, scope descriptions,
 * phone numbers, addresses, photographs and signed URLs from logs, and §3.4
 * forbids the approval token from appearing anywhere but the intended link.
 *
 * This is defence in depth: call sites are expected not to log these, and this
 * scrubs them if one ever does.
 */

/** Keys whose value is replaced wholesale, matched case-insensitively. */
export const REDACTED_KEYS = new Set(
  [
    'token',
    'plainToken',
    'approvalToken',
    'receiptToken',
    'approvalUrl',
    'uploadUrl',
    'downloadUrl',
    'evidenceUrl',
    'signedUrl',
    'whatsappUrl',
    'mailtoUrl',
    'smsUrl',
    'password',
    'secret',
    'apiKey',
    'accessToken',
    'refreshToken',
    'authorization',
    'cookie',
    'setCookie',
    'sessionId',
    // OTP material only. Plain `code` is deliberately NOT redacted: it is the
    // stable machine error code that every log line and runbook depends on
    // (report §7.2), and redacting it makes production failures undebuggable.
    'otp',
    'otpCode',
    'codeHash',
    'verificationCode',
    'phone',
    'phoneE164',
    'contactPhone',
    'email',
    'emailNormalized',
    'contactEmail',
    'siteAddress',
    'siteAddressJson',
    'scope',
    'scopeDescription',
    'signerName',
    'signerComment',
    'comment',
    'notes',
    'messageText',
    'canonicalSnapshot',
  ].map((k) => k.toLowerCase()),
);

const REDACTION = '[redacted]';
const MAX_DEPTH = 8;

/** Matches an approval or receipt link anywhere in a free-text string. */
const LINK_PATTERN = /(https?:\/\/[^\s"']*\/(?:r|receipt)\/)[A-Za-z0-9_-]{16,}/g;
/** Matches a bare 43-character URL-safe base64 token (32 bytes). */
const BARE_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{43}\b/g;

export function redactString(value: string): string {
  return value.replace(LINK_PATTERN, '$1[redacted]').replace(BARE_TOKEN_PATTERN, REDACTION);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[buffer:${value.byteLength}]`;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTION : redact(raw, depth + 1);
  }
  return out;
}

/**
 * Pseudonymises an organization id for log correlation without putting a
 * tenant-linkable identifier into log storage (report §11.5).
 */
export function pseudonymousId(value: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${value}`).digest('base64url').slice(0, 16);
}

/**
 * Keyed hash for IP addresses stored as decision evidence (report §12.3:
 * "hash or truncate IP for routine analytics").
 */
export function privacyHash(value: string, secret: string): Buffer {
  return createHash('sha256').update(`${secret}:${value}`).digest();
}

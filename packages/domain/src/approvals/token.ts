import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '@extrawork/contracts';

/**
 * Public-token security — report §3.4.
 *
 *  - 32 random bytes from a CSPRNG;
 *  - the URL-safe base64 token is returned exactly once, only the SHA-256 is stored;
 *  - bound to one change-order version and one intended approver;
 *  - expires with the request deadline, capped by a configured maximum lifetime;
 *  - revoked when the version is superseded, cancelled or decided;
 *  - never logged, never in analytics, never in a referrer.
 *
 * Nothing in this module accepts a logger, and the token value never leaves the
 * return value of `generateApprovalToken`.
 */

export const TOKEN_BYTES = 32;
/** base64url of 32 bytes, unpadded. */
export const TOKEN_LENGTH = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface GeneratedToken {
  /** Show once, put in the link, then discard. */
  plaintext: string;
  /** The only representation that is persisted. */
  hash: Buffer;
}

export function generateApprovalToken(): GeneratedToken {
  const raw = randomBytes(TOKEN_BYTES);
  const plaintext = raw.toString('base64url');
  return { plaintext, hash: hashToken(plaintext) };
}

export function hashToken(plaintext: string): Buffer {
  return createHash('sha256').update(plaintext, 'utf8').digest();
}

/** Cheap shape check before touching the database, to blunt enumeration. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** Constant-time comparison for any hash equality check. */
export function hashesEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface TokenRecord {
  id: string;
  versionId: string;
  approverContactId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export type TokenRevocationReason =
  | 'DECIDED'
  | 'SUPERSEDED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'LEAKED'
  | 'MANUAL';

/**
 * Validates a resolved token record. Distinguishes expiry from revocation so
 * the public page can explain the situation accurately (report §13.1: the page
 * must never imply a decision was recorded, and must explain replacement).
 */
export function assertTokenUsable(token: TokenRecord, now: Date = new Date()): void {
  if (token.revokedAt) {
    if (token.revokedReason === 'SUPERSEDED') {
      throw new AppError('VERSION_SUPERSEDED');
    }
    if (token.revokedReason === 'DECIDED') {
      throw new AppError('ALREADY_DECIDED');
    }
    throw new AppError('TOKEN_REVOKED', { details: { reason: token.revokedReason } });
  }
  if (token.expiresAt.getTime() <= now.getTime()) {
    throw new AppError('REQUEST_EXPIRED', {
      details: { expiresAt: token.expiresAt.toISOString() },
    });
  }
}

/**
 * Caps a requested expiry at the configured maximum lifetime and refuses one in
 * the past (report §3.4).
 */
export function resolveExpiry(
  requested: Date | null,
  now: Date,
  maxLifetimeDays: number,
  defaultDays: number,
): Date {
  const maxAllowed = new Date(now.getTime() + maxLifetimeDays * 86_400_000);
  if (!requested) {
    const fallback = new Date(now.getTime() + defaultDays * 86_400_000);
    return fallback > maxAllowed ? maxAllowed : fallback;
  }
  if (requested.getTime() <= now.getTime()) {
    throw new AppError('VALIDATION_FAILED', { message: 'The expiry date must be in the future' });
  }
  return requested > maxAllowed ? maxAllowed : requested;
}

/** Builds the single URL the token may ever appear in. */
export function buildApprovalUrl(webBaseUrl: string, plaintext: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/r/${plaintext}`;
}

export function buildReceiptUrl(webBaseUrl: string, receiptToken: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/r/receipt/${receiptToken}`;
}

/**
 * Receipt tokens are separate from approval tokens: the approval token is
 * revoked at decision time, but the customer still needs to reach their
 * receipt (report §6.2 `/r/{token}/complete`).
 */
export function generateReceiptToken(): GeneratedToken {
  return generateApprovalToken();
}

/**
 * Short, human-quotable reference for support ("receipt EW-R-7K2Q4M"). Derived
 * from the decision id, so it leaks nothing and needs no extra storage.
 */
export function receiptDisplayId(decisionId: string): string {
  const digest = createHash('sha256').update(decisionId).digest('base64url');
  const body = digest
    .replace(/[^A-HJ-NP-Z2-9]/gi, '')
    .toUpperCase()
    .slice(0, 6);
  return `EW-R-${body.padEnd(6, 'X')}`;
}

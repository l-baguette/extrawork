import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { AppError } from '@extrawork/contracts';

/**
 * Public-token security — report §3.4.
 *
 *  - 32 random bytes from a CSPRNG;
 *  - the token record stores only SHA-256; automated delivery queues an
 *    authenticated ciphertext that is erased when its job completes;
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

const APPROVAL_LINK_CIPHER_VERSION = 'ewal1';
const APPROVAL_LINK_NONCE_BYTES = 12;
const APPROVAL_LINK_TAG_BYTES = 16;
const APPROVAL_LINK_KEY_CONTEXT = 'extrawork:approval-link:aes-256-gcm:v1\0';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface GeneratedToken {
  /** Show once, put in the link, then discard. */
  plaintext: string;
  /** The only representation persisted in the approval-token record. */
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

export interface ApprovalLinkCipherContext {
  organizationId: string;
  versionId: string;
}

/**
 * Authenticated encryption for the one durable hop that needs the approval
 * link: API transaction -> worker job. The database stores ciphertext only,
 * and the authentication data binds it to one tenant and version so a copied
 * payload cannot be replayed against another request.
 */
export function encryptApprovalUrl(
  approvalUrl: string,
  secret: string,
  context: ApprovalLinkCipherContext,
): string {
  assertApprovalLinkSecret(secret);
  const nonce = randomBytes(APPROVAL_LINK_NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', approvalLinkKey(secret), nonce);
  cipher.setAAD(approvalLinkAad(context));
  const ciphertext = Buffer.concat([cipher.update(approvalUrl, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    APPROVAL_LINK_CIPHER_VERSION,
    nonce.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export function decryptApprovalUrl(
  sealed: string,
  secret: string,
  context: ApprovalLinkCipherContext,
): string {
  assertApprovalLinkSecret(secret);
  try {
    const [version, nonceEncoded, ciphertextEncoded, tagEncoded, extra] = sealed.split('.');
    if (
      version !== APPROVAL_LINK_CIPHER_VERSION ||
      !nonceEncoded ||
      !ciphertextEncoded ||
      !tagEncoded ||
      extra
    ) {
      throw new Error('invalid envelope');
    }

    const nonce = Buffer.from(nonceEncoded, 'base64url');
    const ciphertext = Buffer.from(ciphertextEncoded, 'base64url');
    const tag = Buffer.from(tagEncoded, 'base64url');
    if (
      nonce.byteLength !== APPROVAL_LINK_NONCE_BYTES ||
      tag.byteLength !== APPROVAL_LINK_TAG_BYTES ||
      ciphertext.byteLength === 0
    ) {
      throw new Error('invalid envelope');
    }

    const decipher = createDecipheriv('aes-256-gcm', approvalLinkKey(secret), nonce);
    decipher.setAAD(approvalLinkAad(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Do not include the envelope, key, or low-level crypto error in a job log.
    throw new Error('Encrypted approval link is invalid or belongs to another request');
  }
}

function approvalLinkKey(secret: string): Buffer {
  return createHash('sha256').update(APPROVAL_LINK_KEY_CONTEXT).update(secret).digest();
}

function approvalLinkAad(context: ApprovalLinkCipherContext): Buffer {
  return Buffer.from(
    JSON.stringify([APPROVAL_LINK_CIPHER_VERSION, context.organizationId, context.versionId]),
    'utf8',
  );
}

function assertApprovalLinkSecret(secret: string): void {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Approval-link encryption secret must contain at least 32 bytes');
  }
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
/**
 * How long a decided link keeps rendering its receipt — report §6.7.
 *
 * A customer who approved extra work has a legitimate reason to come back to
 * the link: it is the only copy of the terms they agreed to that they hold. So
 * the link outlives the decision rather than dying with it.
 *
 * But it cannot outlive it forever, which is what it did before this existed:
 * `findByToken` applies no time bound, so a decided link rendered the customer's
 * name, the approver's masked contact, the full scope and the amount to anyone
 * holding the URL, indefinitely. Six months is long enough to cover an invoice
 * dispute and short enough that a link in an old phone backup stops being a
 * disclosure. After it, the record is still complete in the owner's evidence
 * pack — it is only the public URL that closes.
 */
export const DECIDED_LINK_RETENTION_DAYS = 180;

/**
 * Whether a decided request may still be shown on its public link.
 *
 * Read-only by construction: the state machine already refuses a second
 * decision on a terminal version, so this governs visibility alone.
 */
export function decidedLinkStillVisible(
  decidedAt: Date,
  now: Date = new Date(),
  retentionDays: number = DECIDED_LINK_RETENTION_DAYS,
): boolean {
  return now.getTime() - decidedAt.getTime() <= retentionDays * 86_400_000;
}

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

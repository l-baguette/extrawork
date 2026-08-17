import { describe, expect, it } from 'vitest';
import { AppError } from '@extrawork/contracts';
import {
  TOKEN_LENGTH,
  assertTokenUsable,
  buildApprovalUrl,
  generateApprovalToken,
  hashToken,
  hashesEqual,
  isWellFormedToken,
  receiptDisplayId,
  resolveExpiry,
  type TokenRecord,
} from '@extrawork/domain';

/**
 * Public-token security — report §3.4 and §14.5 ("Token expiry/revocation and
 * assurance rules").
 */

function token(overrides: Partial<TokenRecord> = {}): TokenRecord {
  return {
    id: 'token-1',
    versionId: 'version-1',
    approverContactId: 'contact-1',
    expiresAt: new Date('2026-09-01T00:00:00Z'),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

describe('token generation', () => {
  it('produces a 43-character URL-safe base64 token from 32 random bytes', () => {
    const generated = generateApprovalToken();
    expect(generated.plaintext).toHaveLength(TOKEN_LENGTH);
    expect(generated.plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // URL-safe: no characters that would need percent-encoding in a WhatsApp link.
    expect(generated.plaintext).not.toMatch(/[+/=]/);
  });

  it('stores only the SHA-256 of the token', () => {
    const generated = generateApprovalToken();
    expect(generated.hash).toHaveLength(32);
    expect(generated.hash.equals(hashToken(generated.plaintext))).toBe(true);
    // The hash must not be reversible to the plaintext by simple encoding.
    expect(generated.hash.toString('base64url')).not.toBe(generated.plaintext);
  });

  it('never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateApprovalToken().plaintext);
    expect(seen.size).toBe(500);
  });

  it('rejects malformed tokens before any database lookup', () => {
    expect(isWellFormedToken(generateApprovalToken().plaintext)).toBe(true);
    expect(isWellFormedToken('short')).toBe(false);
    expect(isWellFormedToken(`${'a'.repeat(42)}!`)).toBe(false);
    expect(isWellFormedToken("' OR 1=1--")).toBe(false);
    expect(isWellFormedToken(null)).toBe(false);
    expect(isWellFormedToken(123)).toBe(false);
  });

  it('compares hashes in constant time and length-safely', () => {
    const a = hashToken('one');
    expect(hashesEqual(a, hashToken('one'))).toBe(true);
    expect(hashesEqual(a, hashToken('two'))).toBe(false);
    expect(hashesEqual(a, Buffer.alloc(8))).toBe(false);
  });
});

describe('token usability', () => {
  const now = new Date('2026-08-14T00:00:00Z');

  it('accepts a live token', () => {
    expect(() => assertTokenUsable(token(), now)).not.toThrow();
  });

  it('reports expiry distinctly from revocation', () => {
    expect(() =>
      assertTokenUsable(token({ expiresAt: new Date('2026-08-13T23:59:59Z') }), now),
    ).toThrowError(expect.objectContaining({ code: 'REQUEST_EXPIRED' }));
  });

  it('maps a supersede revocation to VERSION_SUPERSEDED', () => {
    expect(() =>
      assertTokenUsable(token({ revokedAt: now, revokedReason: 'SUPERSEDED' }), now),
    ).toThrowError(expect.objectContaining({ code: 'VERSION_SUPERSEDED' }));
  });

  it('maps a decision revocation to ALREADY_DECIDED', () => {
    expect(() =>
      assertTokenUsable(token({ revokedAt: now, revokedReason: 'DECIDED' }), now),
    ).toThrowError(expect.objectContaining({ code: 'ALREADY_DECIDED' }));
  });

  it('treats any other revocation as TOKEN_REVOKED', () => {
    expect(() =>
      assertTokenUsable(token({ revokedAt: now, revokedReason: 'LEAKED' }), now),
    ).toThrowError(expect.objectContaining({ code: 'TOKEN_REVOKED' }));
  });

  it('treats expiry exactly at the boundary as expired', () => {
    expect(() => assertTokenUsable(token({ expiresAt: now }), now)).toThrow(AppError);
  });
});

describe('expiry resolution', () => {
  const now = new Date('2026-08-14T00:00:00Z');

  it('applies the default when none is requested', () => {
    const resolved = resolveExpiry(null, now, 30, 14);
    expect(resolved.toISOString()).toBe('2026-08-28T00:00:00.000Z');
  });

  it('caps a request at the configured maximum lifetime', () => {
    // Report §3.4: "Expire it according to the request deadline, with a maximum
    // configured lifetime."
    const resolved = resolveExpiry(new Date('2027-01-01T00:00:00Z'), now, 30, 14);
    expect(resolved.toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });

  it('caps the default too when the maximum is shorter', () => {
    const resolved = resolveExpiry(null, now, 3, 14);
    expect(resolved.toISOString()).toBe('2026-08-17T00:00:00.000Z');
  });

  it('rejects an expiry in the past', () => {
    expect(() => resolveExpiry(new Date('2026-08-13T00:00:00Z'), now, 30, 14)).toThrow(AppError);
  });
});

describe('links', () => {
  it('places the token in the single URL it may appear in', () => {
    const generated = generateApprovalToken();
    expect(buildApprovalUrl('https://app.example.com', generated.plaintext)).toBe(
      `https://app.example.com/r/${generated.plaintext}`,
    );
  });

  it('tolerates a trailing slash on the base URL', () => {
    expect(buildApprovalUrl('https://app.example.com/', 'abc')).toBe(
      'https://app.example.com/r/abc',
    );
  });
});

describe('receipt reference', () => {
  it('is deterministic, short and free of ambiguous characters', () => {
    const id = receiptDisplayId('019fffbd-ccf5-7523-afba-720f39b990da');
    expect(id).toBe(receiptDisplayId('019fffbd-ccf5-7523-afba-720f39b990da'));
    expect(id).toMatch(/^EW-R-[A-HJ-NP-Z2-9X]{6}$/);
    // 0/O and 1/I are excluded so a customer can read it over the phone.
    expect(id.slice(5)).not.toMatch(/[O0I1]/);
  });

  it('differs between decisions', () => {
    expect(receiptDisplayId('a')).not.toBe(receiptDisplayId('b'));
  });
});

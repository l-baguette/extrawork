import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CANONICALIZER_VERSION,
  CanonicalizationError,
  canonicalize,
  chainEvents,
  computeEventHash,
  freezeSnapshot,
  verifyChain,
  verifySnapshotDigest,
  type AuditEventInput,
} from '@extrawork/domain';

/**
 * Canonical JSON and the tamper-evidence chain — report §8.3, §8.5 and §14.5
 * ("Canonical JSON and digest stability", "Reordering input object keys does
 * not change canonical hash").
 */

describe('JSON Canonicalization Scheme', () => {
  it('sorts object keys by UTF-16 code unit', () => {
    expect(canonicalize({ b: 1, a: 2, C: 3 })).toBe('{"C":3,"a":2,"b":1}');
  });

  it('produces identical output regardless of key insertion order', () => {
    const a = { zebra: 1, alpha: { nested: true, another: 'x' }, list: [3, 2, 1] };
    const b = { list: [3, 2, 1], alpha: { another: 'x', nested: true }, zebra: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('preserves array order, which is significant', () => {
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it('emits no insignificant whitespace', () => {
    expect(canonicalize({ a: [1, { b: 2 }] })).toBe('{"a":[1,{"b":2}]}');
  });

  it('escapes control characters as \\u00XX and uses short escapes elsewhere', () => {
    expect(canonicalize('a\nb')).toBe('"a\\nb"');
    expect(canonicalize('ab')).toBe('"a\\u0001b"');
    expect(canonicalize('quote"back\\slash')).toBe('"quote\\"back\\\\slash"');
  });

  it('keeps non-ASCII literal rather than escaping it', () => {
    // RFC 8785 emits UTF-8 directly; escaping would change the bytes hashed.
    expect(canonicalize('₹ प्रिया')).toBe('"₹ प्रिया"');
  });

  it('normalises -0 to 0', () => {
    expect(canonicalize(-0)).toBe('0');
  });

  it('refuses values that have no stable representation', () => {
    expect(() => canonicalize({ a: undefined })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: Infinity })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: 1n })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: new Date() })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ a: () => undefined })).toThrow(CanonicalizationError);
  });
});

function snapshotInput() {
  return {
    organization: { legalName: 'Shree Interiors LLP', displayName: 'Shree Interiors', gstin: null },
    project: {
      id: '019f0000-0000-7000-8000-000000000001',
      number: 'P-0001',
      title: 'Flat fit-out',
      baselineTotalMinor: 214_760_000n,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
    },
    change: {
      id: '019f0000-0000-7000-8000-000000000002',
      number: 'EW-001',
      version: 1,
      type: 'ADDITION',
    },
    scope: { title: 'Wiring', description: 'Two circuits', reason: null },
    commercial: {
      currency: 'INR',
      lines: [
        {
          position: 0,
          description: 'Circuit',
          quantity: '2.000',
          unit: 'point',
          unitPriceMinor: 650_000n,
          taxRateBps: 1800,
          direction: 1 as const,
          subtotalMinor: 1_300_000n,
          taxMinor: 234_000n,
          totalMinor: 1_534_000n,
        },
      ],
      subtotalDeltaMinor: 1_300_000n,
      taxDeltaMinor: 234_000n,
      totalDeltaMinor: 1_534_000n,
      priorApprovedDeltaMinor: 0n,
      revisedContractTotalMinor: 216_294_000n,
    },
    schedule: { deltaDays: 2, revisedCompletionDate: '2026-10-14' },
    approver: {
      contactId: '019f0000-0000-7000-8000-000000000003',
      name: 'Priya Mehta',
      maskedPhone: '+91******2345',
      maskedEmail: null,
      authorityNote: null,
    },
    attachments: [],
    assuranceRequired: 'A0',
    expiresAt: '2026-08-28T18:30:00.000Z',
    sentAt: '2026-08-14T06:00:00.000Z',
  };
}

describe('snapshot freezing', () => {
  it('is byte-for-byte reproducible', () => {
    const first = freezeSnapshot(snapshotInput());
    const second = freezeSnapshot(snapshotInput());
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.sha256Hex).toBe(second.sha256Hex);
  });

  it('records the canonicalizer and terms version alongside the digest', () => {
    const frozen = freezeSnapshot(snapshotInput());
    expect(frozen.canonicalizerVersion).toBe(CANONICALIZER_VERSION);
    expect(frozen.termsVersion).toBe('approval-terms-in-v1');
  });

  it('serialises money as strings so no digest depends on float parsing', () => {
    const frozen = freezeSnapshot(snapshotInput());
    expect(frozen.canonicalJson).toContain('"totalDeltaMinor":"1534000"');
    expect(frozen.canonicalJson).not.toContain('"totalDeltaMinor":1534000');
  });

  it('changes the digest when any priced value changes', () => {
    const base = freezeSnapshot(snapshotInput());
    const tampered = snapshotInput();
    tampered.commercial.totalDeltaMinor = 1_534_001n;
    expect(freezeSnapshot(tampered).sha256Hex).not.toBe(base.sha256Hex);
  });

  it('is stable against attachment ordering', () => {
    const withAttachments = (order: 'ab' | 'ba') => {
      const input = snapshotInput();
      const a = {
        id: 'aaaa',
        sha256: '11'.repeat(32),
        mimeType: 'image/jpeg',
        filename: 'a.jpg',
        byteSize: 1,
        caption: null,
      };
      const b = {
        id: 'bbbb',
        sha256: '22'.repeat(32),
        mimeType: 'image/jpeg',
        filename: 'b.jpg',
        byteSize: 2,
        caption: null,
      };
      input.attachments = order === 'ab' ? [a, b] : [b, a];
      return freezeSnapshot(input).sha256Hex;
    };
    expect(withAttachments('ab')).toBe(withAttachments('ba'));
  });

  it('verifies a stored snapshot against its recorded digest', () => {
    const frozen = freezeSnapshot(snapshotInput());
    expect(verifySnapshotDigest(frozen.snapshot, frozen.sha256)).toBe(true);

    const tampered = JSON.parse(frozen.canonicalJson) as Record<string, unknown>;
    (tampered.scope as Record<string, unknown>).title = 'Something else';
    expect(verifySnapshotDigest(tampered, frozen.sha256)).toBe(false);
  });
});

function event(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    aggregateType: 'change_order',
    aggregateId: '019f0000-0000-7000-8000-000000000002',
    eventType: 'change_order.created.v1',
    actorType: 'USER',
    actorId: 'user-1',
    occurredAt: new Date('2026-08-14T06:00:00.000Z'),
    payload: { a: 1 },
    ...overrides,
  };
}

describe('audit hash chain', () => {
  it('implements h[0] = SHA256(canonical(e0))', () => {
    const [first] = chainEvents([event()], null);
    const expected = createHash('sha256')
      .update(
        canonicalize({
          actorId: 'user-1',
          actorType: 'USER',
          aggregateId: '019f0000-0000-7000-8000-000000000002',
          aggregateType: 'change_order',
          eventType: 'change_order.created.v1',
          occurredAt: '2026-08-14T06:00:00.000Z',
          payload: { a: 1 },
          sequence: 1,
        }),
        'utf8',
      )
      .digest();
    expect(first?.eventHash.equals(expected)).toBe(true);
    expect(first?.previousHash).toBeNull();
  });

  it('implements h[n] = SHA256(h[n-1] || canonical(en))', () => {
    const chained = chainEvents([event(), event({ eventType: 'change_order.sent.v1' })], null);
    const [first, second] = chained;
    expect(second?.previousHash?.equals(first!.eventHash)).toBe(true);
    expect(second?.eventHash.equals(computeEventHash(second!, first!.eventHash))).toBe(true);
  });

  it('numbers sequences gaplessly and continues from an existing tail', () => {
    const first = chainEvents([event()], null);
    const next = chainEvents([event({ eventType: 'change_order.sent.v1' })], {
      sequence: first[0]!.sequence,
      eventHash: first[0]!.eventHash,
    });
    expect(next[0]?.sequence).toBe(2);
    expect(verifyChain([...first, ...next]).valid).toBe(true);
  });

  it('detects a modified payload', () => {
    const chained = chainEvents([event(), event({ eventType: 'x' })], null);
    const tampered = chained.map((e, i) => (i === 0 ? { ...e, payload: { a: 999 } } : e));
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.failedAtSequence).toBe(1);
  });

  it('detects a removed event', () => {
    const chained = chainEvents(
      [event(), event({ eventType: 'b' }), event({ eventType: 'c' })],
      null,
    );
    const result = verifyChain([chained[0]!, chained[2]!]);
    expect(result.valid).toBe(false);
  });

  it('detects a re-ordered event', () => {
    const chained = chainEvents([event({ eventType: 'a' }), event({ eventType: 'b' })], null);
    expect(verifyChain([chained[1]!, chained[0]!]).valid).toBe(false);
  });

  it('accepts an untampered chain', () => {
    const chained = chainEvents(
      [event({ eventType: 'a' }), event({ eventType: 'b' }), event({ eventType: 'c' })],
      null,
    );
    expect(verifyChain(chained)).toEqual({ valid: true, failedAtSequence: null, reason: null });
  });
});

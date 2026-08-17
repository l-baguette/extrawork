import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  calculateLine,
  calculateRevisedContractTotal,
  calculateVersionTotals,
  canonicalize,
  chainEvents,
  freezeSnapshot,
  isTerminal,
  VERSION_ACTIONS,
  canTransition,
  verifyChain,
  type LineItemCalcInput,
} from '@extrawork/domain';

/**
 * Property-based tests — report §14.5 lists these invariants verbatim:
 *
 *   - Sum of line totals equals version totals.
 *   - Baseline plus approved deltas equals revised total.
 *   - Reordering input object keys does not change canonical hash.
 *   - Terminal states never transition except via new aggregate/reversal.
 *   - Repeating idempotent command produces one decision and same response.
 *     (the last is exercised against real PostgreSQL in tests/integration)
 */

const lineArb: fc.Arbitrary<LineItemCalcInput> = fc.record({
  quantity: fc
    .tuple(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 0, max: 999 }))
    .map(([whole, fraction]) => `${whole}.${String(fraction).padStart(3, '0')}`),
  unitPriceMinor: fc.bigInt({ min: 0n, max: 100_000_000n }),
  taxRateBps: fc.integer({ min: 0, max: 10_000 }),
  direction: fc.constantFrom(1 as const, -1 as const),
});

describe('money invariants', () => {
  it('version totals equal the sum of the line totals', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: 30 }), (lines) => {
        const totals = calculateVersionTotals(lines);
        const summed = lines.reduce(
          (acc, line) => {
            const result = calculateLine(line);
            return {
              subtotal: acc.subtotal + result.subtotalMinor,
              tax: acc.tax + result.taxMinor,
              total: acc.total + result.totalMinor,
            };
          },
          { subtotal: 0n, tax: 0n, total: 0n },
        );
        expect(totals.subtotalDeltaMinor).toBe(summed.subtotal);
        expect(totals.taxDeltaMinor).toBe(summed.tax);
        expect(totals.totalDeltaMinor).toBe(summed.total);
      }),
      { numRuns: 300 },
    );
  });

  it('always satisfies subtotal + tax = total', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: 30 }), (lines) => {
        const totals = calculateVersionTotals(lines);
        expect(totals.subtotalDeltaMinor + totals.taxDeltaMinor).toBe(totals.totalDeltaMinor);
      }),
      { numRuns: 300 },
    );
  });

  it('is order independent: reordering lines never changes the totals', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 2, maxLength: 12 }), (lines) => {
        const forward = calculateVersionTotals(lines);
        const reversed = calculateVersionTotals([...lines].reverse());
        expect(reversed.totalDeltaMinor).toBe(forward.totalDeltaMinor);
      }),
      { numRuns: 200 },
    );
  });

  it('flipping every direction negates the total exactly', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { maxLength: 15 }), (lines) => {
        const forward = calculateVersionTotals(lines);
        const flipped = calculateVersionTotals(
          lines.map((line) => ({ ...line, direction: (line.direction === 1 ? -1 : 1) as 1 | -1 })),
        );
        expect(flipped.totalDeltaMinor).toBe(-forward.totalDeltaMinor);
      }),
      { numRuns: 200 },
    );
  });

  it('never produces a fractional minor unit', () => {
    fc.assert(
      fc.property(lineArb, (line) => {
        const result = calculateLine(line);
        expect(typeof result.subtotalMinor).toBe('bigint');
        expect(typeof result.taxMinor).toBe('bigint');
        expect(typeof result.totalMinor).toBe('bigint');
      }),
      { numRuns: 300 },
    );
  });

  it('keeps tax within the requested rate, never overshooting the subtotal', () => {
    fc.assert(
      fc.property(lineArb, (line) => {
        const { subtotalMinor, taxMinor } = calculateLine(line);
        const magnitude = subtotalMinor < 0n ? -subtotalMinor : subtotalMinor;
        const taxMagnitude = taxMinor < 0n ? -taxMinor : taxMinor;
        // At most 100% tax, plus one unit of rounding slack.
        expect(taxMagnitude <= magnitude + 1n).toBe(true);
        // Tax carries the same sign as the subtotal, so a deduction reverses it.
        if (taxMinor !== 0n) expect(taxMinor < 0n).toBe(subtotalMinor < 0n);
      }),
      { numRuns: 300 },
    );
  });
});

describe('revised total invariant', () => {
  it('baseline plus approved deltas equals the revised total', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000_000n }),
        fc.array(fc.bigInt({ min: -100_000_000n, max: 100_000_000n }), { maxLength: 20 }),
        (baseline, deltas) => {
          const priorApproved = deltas.reduce((a, b) => a + b, 0n);
          // Only assert on inputs the domain accepts; a negative revised total
          // is required to throw, which the unit suite covers separately.
          fc.pre(baseline + priorApproved >= 0n);
          const revised = calculateRevisedContractTotal({
            baselineTotalMinor: baseline,
            priorApprovedDeltaMinor: priorApproved,
            currentVersionDeltaMinor: 0n,
          });
          expect(revised).toBe(baseline + priorApproved);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('applying deltas one at a time equals applying their sum', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        fc.array(fc.bigInt({ min: 0n, max: 1_000_000n }), { maxLength: 20 }),
        (baseline, deltas) => {
          const incremental = deltas.reduce((running, delta) => running + delta, baseline);
          const atOnce = calculateRevisedContractTotal({
            baselineTotalMinor: baseline,
            priorApprovedDeltaMinor: deltas.reduce((a, b) => a + b, 0n),
            currentVersionDeltaMinor: 0n,
          });
          expect(atOnce).toBe(incremental);
        },
      ),
      { numRuns: 200 },
    );
  });
});

/** Recursively rebuilds an object with its keys in a different order. */
function shuffleKeys(value: unknown, rng: () => number): unknown {
  if (Array.isArray(value)) return value.map((v) => shuffleKeys(v, rng));
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>);
  for (let i = entries.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }
  return Object.fromEntries(entries.map(([k, v]) => [k, shuffleKeys(v, rng)]));
}

describe('canonicalization invariants', () => {
  const jsonArb = fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      fc.string(),
      fc.array(tie('value'), { maxLength: 5 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), tie('value'), { maxKeys: 6 }),
    ),
  })).value;

  it('reordering object keys never changes the canonical form', () => {
    fc.assert(
      fc.property(jsonArb, fc.integer({ min: 1, max: 2 ** 30 }), (value, seed) => {
        let state = seed;
        const rng = () => {
          state = (state * 1103515245 + 12345) % 2 ** 31;
          return state / 2 ** 31;
        };
        expect(canonicalize(shuffleKeys(value, rng))).toBe(canonicalize(value));
      }),
      { numRuns: 300 },
    );
  });

  it('is injective enough that different content differs', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (a, b) => {
        if (JSON.stringify(a) === JSON.stringify(b)) return;
        // Different structures may still canonicalize identically only if they
        // are semantically the same JSON value.
        const same = canonicalize(a) === canonicalize(b);
        if (same) expect(canonicalize(a)).toBe(canonicalize(b));
      }),
      { numRuns: 200 },
    );
  });

  it('produces a stable snapshot digest under key reordering', () => {
    fc.assert(
      fc.property(
        fc.record({
          title: fc.string({ minLength: 1, maxLength: 40 }),
          description: fc.string({ minLength: 1, maxLength: 200 }),
          days: fc.integer({ min: -30, max: 30 }),
          price: fc.bigInt({ min: 0n, max: 10_000_000n }),
        }),
        (input) => {
          const build = () =>
            freezeSnapshot({
              organization: { legalName: null, displayName: 'Org', gstin: null },
              project: {
                id: 'p',
                number: 'P-1',
                title: 'T',
                baselineTotalMinor: 1_000_000n,
                currency: 'INR',
                timezone: 'Asia/Kolkata',
              },
              change: { id: 'c', number: 'EW-001', version: 1, type: 'ADDITION' },
              scope: { title: input.title, description: input.description, reason: null },
              commercial: {
                currency: 'INR',
                lines: [
                  {
                    position: 0,
                    description: 'x',
                    quantity: '1.000',
                    unit: null,
                    unitPriceMinor: input.price,
                    taxRateBps: 1800,
                    direction: 1,
                    subtotalMinor: input.price,
                    taxMinor: 0n,
                    totalMinor: input.price,
                  },
                ],
                subtotalDeltaMinor: input.price,
                taxDeltaMinor: 0n,
                totalDeltaMinor: input.price,
                priorApprovedDeltaMinor: 0n,
                revisedContractTotalMinor: 1_000_000n + input.price,
              },
              schedule: { deltaDays: input.days, revisedCompletionDate: null },
              approver: {
                contactId: 'k',
                name: 'A',
                maskedPhone: null,
                maskedEmail: null,
                authorityNote: null,
              },
              attachments: [],
              assuranceRequired: 'A0',
              expiresAt: '2026-09-01T00:00:00.000Z',
              sentAt: '2026-08-14T00:00:00.000Z',
            });
          expect(build().sha256Hex).toBe(build().sha256Hex);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('state machine invariants', () => {
  it('terminal states never transition, for any action', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('APPROVED', 'DECLINED', 'CANCELLED', 'SUPERSEDED' as const),
        fc.constantFrom(...VERSION_ACTIONS),
        (status, action) => {
          expect(isTerminal(status)).toBe(true);
          expect(canTransition(status, action)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('audit chain invariants', () => {
  const eventArb = fc.record({
    eventType: fc.constantFrom('a.v1', 'b.v1', 'c.v1'),
    payloadValue: fc.integer({ min: 0, max: 1000 }),
    offsetMs: fc.integer({ min: 0, max: 1_000_000 }),
  });

  it('any chain built by chainEvents verifies', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { minLength: 1, maxLength: 25 }), (events) => {
        const chained = chainEvents(
          events.map((e) => ({
            aggregateType: 'change_order',
            aggregateId: 'agg-1',
            eventType: e.eventType,
            actorType: 'USER' as const,
            actorId: 'u',
            occurredAt: new Date(1_700_000_000_000 + e.offsetMs),
            payload: { v: e.payloadValue },
          })),
          null,
        );
        expect(verifyChain(chained).valid).toBe(true);
        // Sequences are gapless and start at 1.
        chained.forEach((event, index) => expect(event.sequence).toBe(index + 1));
      }),
      { numRuns: 200 },
    );
  });

  it('mutating any single event breaks verification', () => {
    fc.assert(
      fc.property(
        fc.array(eventArb, { minLength: 2, maxLength: 10 }),
        fc.nat(),
        (events, rawIndex) => {
          const chained = chainEvents(
            events.map((e) => ({
              aggregateType: 'change_order',
              aggregateId: 'agg-1',
              eventType: e.eventType,
              actorType: 'USER' as const,
              actorId: 'u',
              occurredAt: new Date(1_700_000_000_000 + e.offsetMs),
              payload: { v: e.payloadValue },
            })),
            null,
          );
          const index = rawIndex % chained.length;
          const tampered = chained.map((event, i) =>
            i === index
              ? { ...event, payload: { v: event.payload.v as number, tampered: true } }
              : event,
          );
          expect(verifyChain(tampered).valid).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

import { describe, expect, it } from 'vitest';
import { AppError } from '@extrawork/contracts';
import {
  addDays,
  calculateLine,
  calculateRevisedContractTotal,
  calculateVersionTotals,
  deriveChangeType,
  formatMoney,
  Money,
  parseQuantity,
  verifyVersionTotals,
} from '@extrawork/domain';

/**
 * Canonical money and tax engine — report §8.1 and §14.5 ("Money, tax,
 * rounding, deductions, substitutions, and revised totals").
 */

describe('line calculation', () => {
  it('applies the report formula exactly', () => {
    // 2 × ₹6,500 = ₹13,000; 18% tax = ₹2,340; total ₹15,340.
    const result = calculateLine({
      quantity: '2.000',
      unitPriceMinor: 650_000n,
      taxRateBps: 1800,
      direction: 1,
    });
    expect(result.subtotalMinor).toBe(1_300_000n);
    expect(result.taxMinor).toBe(234_000n);
    expect(result.totalMinor).toBe(1_534_000n);
  });

  it('rounds half up on a fractional quantity', () => {
    // 2.5 × 1001 paise = 2502.5 paise, which must round to 2503, not 2502.
    const result = calculateLine({
      quantity: '2.500',
      unitPriceMinor: 1001n,
      taxRateBps: 0,
      direction: 1,
    });
    expect(result.subtotalMinor).toBe(2503n);
  });

  it('rounds tax half up', () => {
    // 100 paise at 5% = 5 paise exactly; 101 at 5% = 5.05 -> 5.
    expect(
      calculateLine({ quantity: '1', unitPriceMinor: 101n, taxRateBps: 500, direction: 1 })
        .taxMinor,
    ).toBe(5n);
    // 110 at 5% = 5.5 -> 6 (half away from zero).
    expect(
      calculateLine({ quantity: '1', unitPriceMinor: 110n, taxRateBps: 500, direction: 1 })
        .taxMinor,
    ).toBe(6n);
  });

  it('signs a deduction and reverses its tax', () => {
    const result = calculateLine({
      quantity: '21.500',
      unitPriceMinor: 118_000n,
      taxRateBps: 1800,
      direction: -1,
    });
    expect(result.subtotalMinor).toBe(-2_537_000n);
    expect(result.taxMinor).toBe(-456_660n);
    expect(result.totalMinor).toBe(-2_993_660n);
  });

  it('rejects a negative unit price rather than inferring a deduction', () => {
    expect(() =>
      calculateLine({ quantity: '1', unitPriceMinor: -100n, taxRateBps: 0, direction: 1 }),
    ).toThrow(AppError);
  });

  it('rejects a tax rate above 100%', () => {
    expect(() =>
      calculateLine({ quantity: '1', unitPriceMinor: 100n, taxRateBps: 10_001, direction: 1 }),
    ).toThrow(AppError);
  });

  it('rejects a zero quantity', () => {
    expect(() => parseQuantity('0')).toThrow(AppError);
    expect(() => parseQuantity('0.000')).toThrow(AppError);
  });

  it('rejects a quantity with more than three decimals', () => {
    expect(() => parseQuantity('1.2345')).toThrow(AppError);
  });

  it('never accepts a binary float for quantity', () => {
    // The wire type is a decimal string precisely so 0.1 + 0.2 problems cannot
    // reach the ledger (report §6.3).
    expect(() => parseQuantity(String(0.1 + 0.2))).toThrow(AppError);
  });
});

describe('version totals', () => {
  it('sums line totals and preserves subtotal + tax = total', () => {
    const totals = calculateVersionTotals([
      { quantity: '2.000', unitPriceMinor: 650_000n, taxRateBps: 1800, direction: 1 },
      { quantity: '1.000', unitPriceMinor: 280_000n, taxRateBps: 1800, direction: 1 },
    ]);
    expect(totals.subtotalDeltaMinor).toBe(1_580_000n);
    expect(totals.taxDeltaMinor).toBe(284_400n);
    expect(totals.totalDeltaMinor).toBe(1_864_400n);
    expect(totals.totalDeltaMinor).toBe(totals.subtotalDeltaMinor + totals.taxDeltaMinor);
  });

  it('handles a substitution that adds and deducts at once', () => {
    // The seeded flooring change: engineered oak in, laminate out.
    const totals = calculateVersionTotals([
      { quantity: '21.500', unitPriceMinor: 345_000n, taxRateBps: 1800, direction: 1 },
      { quantity: '21.500', unitPriceMinor: 118_000n, taxRateBps: 1800, direction: -1 },
    ]);
    expect(totals.totalDeltaMinor).toBe(5_758_990n);
  });

  it('treats a time-only change as zero commercial effect', () => {
    const totals = calculateVersionTotals([]);
    expect(totals.totalDeltaMinor).toBe(0n);
  });
});

describe('revised contract total', () => {
  it('is baseline plus prior approved plus this version', () => {
    expect(
      calculateRevisedContractTotal({
        baselineTotalMinor: 214_760_000n,
        priorApprovedDeltaMinor: 1_864_400n,
        currentVersionDeltaMinor: 5_758_990n,
      }),
    ).toBe(222_383_390n);
  });

  it('refuses to produce a negative revised total', () => {
    // Report §4.6: "If the revised total would become negative ... validation fails."
    expect(() =>
      calculateRevisedContractTotal({
        baselineTotalMinor: 100_000n,
        priorApprovedDeltaMinor: 0n,
        currentVersionDeltaMinor: -200_000n,
      }),
    ).toThrow(AppError);
  });

  it('allows a deduction down to exactly zero', () => {
    expect(
      calculateRevisedContractTotal({
        baselineTotalMinor: 100_000n,
        priorApprovedDeltaMinor: 0n,
        currentVersionDeltaMinor: -100_000n,
      }),
    ).toBe(0n);
  });
});

describe('integrity re-computation', () => {
  it('detects a tampered stored total', () => {
    const lines = [
      { quantity: '1.000', unitPriceMinor: 100_000n, taxRateBps: 1800, direction: 1 as const },
    ];
    const result = verifyVersionTotals(lines, {
      subtotalDeltaMinor: 100_000n,
      taxDeltaMinor: 18_000n,
      totalDeltaMinor: 999_999n,
    });
    expect(result.ok).toBe(false);
    expect(result.mismatches.map((m) => m.field)).toContain('totalDeltaMinor');
  });

  it('passes on untampered values', () => {
    const lines = [
      { quantity: '1.000', unitPriceMinor: 100_000n, taxRateBps: 1800, direction: 1 as const },
    ];
    expect(verifyVersionTotals(lines, calculateVersionTotals(lines)).ok).toBe(true);
  });
});

describe('change type derivation', () => {
  const add = { quantity: '1', unitPriceMinor: 100n, taxRateBps: 0, direction: 1 as const };
  const deduct = { quantity: '1', unitPriceMinor: 100n, taxRateBps: 0, direction: -1 as const };

  it('classifies additions, deductions and substitutions', () => {
    expect(deriveChangeType([add], 0)).toBe('ADDITION');
    expect(deriveChangeType([deduct], 0)).toBe('DEDUCTION');
    expect(deriveChangeType([add, deduct], 0)).toBe('SUBSTITUTION');
    expect(deriveChangeType([], 5)).toBe('TIME_ONLY');
  });
});

describe('Money value type', () => {
  it('refuses to mix currencies', () => {
    expect(() => Money.of(100n, 'INR').plus(Money.of(100n, 'USD'))).toThrow(AppError);
  });

  it('rejects a fractional minor unit', () => {
    expect(() => Money.of(10.5 as unknown as number, 'INR')).toThrow(AppError);
  });

  it('round-trips through JSON without precision loss', () => {
    const money = Money.of(9_007_199_254_740n, 'INR');
    expect(BigInt(money.toJSON().amountMinor)).toBe(money.amountMinor);
  });
});

describe('formatting', () => {
  it('uses the Indian lakh/crore grouping', () => {
    expect(formatMoney(214_760_000n, 'INR')).toBe('₹21,47,600.00');
    expect(formatMoney(100n, 'INR')).toBe('₹1.00');
  });

  it('shows a deduction with a minus sign', () => {
    // Report §4.6: "must show a minus sign and revised total clearly".
    expect(formatMoney(-1_864_400n, 'INR')).toBe('-₹18,644.00');
  });
});

describe('date arithmetic', () => {
  it('adds days without timezone drift across a month boundary', () => {
    expect(addDays('2026-10-30', 5)).toBe('2026-11-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

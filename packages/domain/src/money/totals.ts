import { AppError } from '@extrawork/contracts';
import { Decimal, parseQuantity, roundHalfUpToBigint } from './money.js';

/**
 * The canonical money and tax engine — report §8.1.
 *
 *   raw_subtotal_minor = round_half_up(decimal(quantity) * unit_price_minor)
 *   signed_subtotal    = direction_sign * raw_subtotal_minor
 *   tax_minor          = round_half_up(signed_subtotal * tax_rate_bps / 10000)
 *   line_total_minor   = signed_subtotal + tax_minor
 *
 *   version_delta          = sum(line_total_minor)
 *   revised_contract_total = baseline_total + prior_approved_delta + version_delta
 *
 * This is the only implementation. The API, the PDF, exports and the preview
 * all call it (ADR-005), so a displayed number can never drift from a stored one.
 */

export interface LineItemCalcInput {
  /** Decimal string, e.g. "2.500". Never a float. */
  quantity: string;
  /** Non-negative minor units; sign comes from `direction`. */
  unitPriceMinor: bigint;
  /** Basis points, 0..10000. */
  taxRateBps: number;
  /** +1 adds to the contract, -1 deducts. */
  direction: 1 | -1;
}

export interface LineItemCalcResult {
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

export function calculateLine(input: LineItemCalcInput): LineItemCalcResult {
  if (input.unitPriceMinor < 0n) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Unit price cannot be negative; use direction -1 for a deduction',
    });
  }
  if (!Number.isInteger(input.taxRateBps) || input.taxRateBps < 0 || input.taxRateBps > 10_000) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Tax rate must be between 0 and 10000 basis points',
      details: { taxRateBps: input.taxRateBps },
    });
  }
  if (input.direction !== 1 && input.direction !== -1) {
    throw new AppError('VALIDATION_FAILED', { message: 'Line direction must be 1 or -1' });
  }

  const quantity = parseQuantity(input.quantity);
  if (quantity.isNegative()) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Quantity cannot be negative; use direction -1 for a deduction',
    });
  }

  const rawSubtotal = roundHalfUpToBigint(
    quantity.times(new Decimal(input.unitPriceMinor.toString())),
  );
  const signedSubtotal = BigInt(input.direction) * rawSubtotal;

  // Tax is computed on the already-signed subtotal so a deduction reverses tax too.
  const taxMinor = roundHalfUpToBigint(
    new Decimal(signedSubtotal.toString()).times(input.taxRateBps).dividedBy(10_000),
  );

  return {
    subtotalMinor: signedSubtotal,
    taxMinor,
    totalMinor: signedSubtotal + taxMinor,
  };
}

export interface VersionTotals {
  subtotalDeltaMinor: bigint;
  taxDeltaMinor: bigint;
  totalDeltaMinor: bigint;
}

export function calculateVersionTotals(lines: readonly LineItemCalcInput[]): VersionTotals {
  let subtotal = 0n;
  let tax = 0n;
  let total = 0n;
  for (const line of lines) {
    const result = calculateLine(line);
    subtotal += result.subtotalMinor;
    tax += result.taxMinor;
    total += result.totalMinor;
  }
  // Invariant the database also enforces as a CHECK constraint.
  if (total !== subtotal + tax) {
    throw new AppError('INTERNAL_ERROR', { message: 'Version totals failed their own invariant' });
  }
  return { subtotalDeltaMinor: subtotal, taxDeltaMinor: tax, totalDeltaMinor: total };
}

export interface RevisedTotalInput {
  baselineTotalMinor: bigint;
  priorApprovedDeltaMinor: bigint;
  currentVersionDeltaMinor: bigint;
}

/**
 * Report §8.1 aggregate rule. Rejects a negative revised total per §4.6 — a
 * contract cannot be worth less than nothing.
 */
export function calculateRevisedContractTotal(input: RevisedTotalInput): bigint {
  const revised =
    input.baselineTotalMinor + input.priorApprovedDeltaMinor + input.currentVersionDeltaMinor;
  if (revised < 0n) {
    throw new AppError('NEGATIVE_REVISED_TOTAL', {
      details: {
        baselineTotalMinor: Number(input.baselineTotalMinor),
        priorApprovedDeltaMinor: Number(input.priorApprovedDeltaMinor),
        currentVersionDeltaMinor: Number(input.currentVersionDeltaMinor),
      },
    });
  }
  return revised;
}

/**
 * Recomputes stored values and compares. Report §8.1: "On every read the
 * application may recompute and compare. A mismatch triggers a high-severity
 * integrity alert and blocks new evidence generation until repaired."
 */
export interface IntegrityCheckResult {
  ok: boolean;
  mismatches: Array<{ field: string; stored: string; recomputed: string }>;
}

export function verifyVersionTotals(
  lines: readonly LineItemCalcInput[],
  stored: VersionTotals,
): IntegrityCheckResult {
  const recomputed = calculateVersionTotals(lines);
  const mismatches: IntegrityCheckResult['mismatches'] = [];
  for (const field of ['subtotalDeltaMinor', 'taxDeltaMinor', 'totalDeltaMinor'] as const) {
    if (recomputed[field] !== stored[field]) {
      mismatches.push({
        field,
        stored: stored[field].toString(),
        recomputed: recomputed[field].toString(),
      });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Derives the change type from the line composition when the caller has not
 * pinned one. Time-only means no commercial effect at all.
 */
export function deriveChangeType(
  lines: readonly LineItemCalcInput[],
  scheduleDeltaDays: number,
): 'ADDITION' | 'DEDUCTION' | 'SUBSTITUTION' | 'TIME_ONLY' {
  if (lines.length === 0) return 'TIME_ONLY';
  const hasAddition = lines.some((l) => l.direction === 1);
  const hasDeduction = lines.some((l) => l.direction === -1);
  if (hasAddition && hasDeduction) return 'SUBSTITUTION';
  if (hasDeduction) return 'DEDUCTION';
  if (hasAddition) return 'ADDITION';
  return scheduleDeltaDays === 0 ? 'TIME_ONLY' : 'TIME_ONLY';
}

/** Adds a signed day delta to a YYYY-MM-DD date without timezone drift. */
export function addDays(isoDate: string, days: number): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('VALIDATION_FAILED', { message: `Not a valid date: ${isoDate}` });
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

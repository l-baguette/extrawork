// Named import, not default: decimal.js declares a class, a namespace and a
// default export under the same name, and under Node's NodeNext resolution a
// default import binds to the namespace rather than the constructor.
import { Decimal } from 'decimal.js';
import { AppError } from '@extrawork/contracts';

/**
 * Canonical money type. Report §8.1 and §14.4: money is a signed 64-bit integer
 * count of minor units, and JavaScript `number` is never used for currency
 * arithmetic. All arithmetic here is bigint; Decimal appears only where a
 * quantity (a non-integer) multiplies a rate, and the result is rounded back to
 * an integer immediately.
 */

// Decimal.js configured once for the whole domain: enough precision for
// quantity x rate on any realistic contract, and explicit half-up rounding.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });

/** Minor units per major unit. INR paise = 100. */
export const MINOR_UNITS: Record<string, number> = {
  INR: 100,
  USD: 100,
  EUR: 100,
  GBP: 100,
  AED: 100,
};

export function minorUnitScale(currency: string): number {
  return MINOR_UNITS[currency] ?? 100;
}

/** Postgres bigint bounds. Exceeding these is a domain error, not an overflow. */
const INT64_MAX = 9_223_372_036_854_775_807n;
const INT64_MIN = -9_223_372_036_854_775_808n;

export class Money {
  readonly amountMinor: bigint;
  readonly currency: string;

  private constructor(amountMinor: bigint, currency: string) {
    this.amountMinor = amountMinor;
    this.currency = currency;
  }

  static of(amountMinor: bigint | number, currency: string): Money {
    const value = typeof amountMinor === 'bigint' ? amountMinor : toIntegerBigint(amountMinor);
    assertInt64(value);
    return new Money(value, normalizeCurrency(currency));
  }

  static zero(currency: string): Money {
    return new Money(0n, normalizeCurrency(currency));
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountMinor + other.amountMinor, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountMinor - other.amountMinor, this.currency);
  }

  negated(): Money {
    return Money.of(-this.amountMinor, this.currency);
  }

  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  isNegative(): boolean {
    return this.amountMinor < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  toJSON(): { amountMinor: number; currency: string } {
    return { amountMinor: this.toNumber(), currency: this.currency };
  }

  /**
   * Safe for the wire because minor-unit totals are far inside 2^53; throws
   * rather than silently losing precision if that ever stops being true.
   */
  toNumber(): number {
    if (
      this.amountMinor > BigInt(Number.MAX_SAFE_INTEGER) ||
      this.amountMinor < BigInt(-Number.MAX_SAFE_INTEGER)
    ) {
      throw new AppError('INTERNAL_ERROR', {
        message: 'Monetary amount exceeds the safe JSON integer range',
      });
    }
    return Number(this.amountMinor);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new AppError('CURRENCY_MISMATCH', {
        details: { expected: this.currency, received: other.currency },
      });
    }
  }
}

export function normalizeCurrency(currency: string): string {
  const upper = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) {
    throw new AppError('VALIDATION_FAILED', { message: `Invalid currency code: ${currency}` });
  }
  return upper;
}

function toIntegerBigint(value: number): bigint {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Monetary amounts must be whole minor units',
      details: { received: value },
    });
  }
  return BigInt(value);
}

function assertInt64(value: bigint): void {
  if (value > INT64_MAX || value < INT64_MIN) {
    throw new AppError('VALIDATION_FAILED', { message: 'Monetary amount is out of range' });
  }
}

/**
 * Round-half-up to a whole minor unit. Report §8.1 specifies half-up
 * explicitly; Decimal's ROUND_HALF_UP rounds away from zero for negatives,
 * which is what "half up" means for a signed deduction here (a -0.5 paise
 * remainder favours the customer being charged less is NOT the rule — the rule
 * is symmetric magnitude rounding, applied to the already-signed value).
 */
export function roundHalfUpToBigint(value: Decimal): bigint {
  return BigInt(value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
}

/** Parses the wire decimal-string quantity. Never accepts a float. */
export function parseQuantity(quantity: string): Decimal {
  if (!/^-?\d{1,15}(\.\d{1,3})?$/.test(quantity)) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Quantity must be a decimal string with at most 3 decimal places',
      details: { quantity },
    });
  }
  const decimal = new Decimal(quantity);
  if (decimal.isZero()) {
    throw new AppError('VALIDATION_FAILED', { message: 'Quantity cannot be zero' });
  }
  return decimal;
}

/** Formats a bigint minor amount for display in a given locale. */
export function formatMoney(
  amountMinor: bigint | number,
  currency: string,
  locale = 'en-IN',
): string {
  const scale = minorUnitScale(currency);
  const minor = typeof amountMinor === 'bigint' ? amountMinor : BigInt(Math.trunc(amountMinor));
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const major = abs / BigInt(scale);
  const remainder = abs % BigInt(scale);
  const digits = String(scale).length - 1;
  const majorFormatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(major);
  const symbol = currencySymbol(currency);
  const fraction = digits > 0 ? `.${String(remainder).padStart(digits, '0')}` : '';
  return `${negative ? '-' : ''}${symbol}${majorFormatted}${fraction}`;
}

export function currencySymbol(currency: string): string {
  switch (currency) {
    case 'INR':
      return '₹';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    default:
      return `${currency} `;
  }
}

export { Decimal };

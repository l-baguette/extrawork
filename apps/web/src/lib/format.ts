/**
 * Locale-aware formatting — report §6.9 (ICU message catalogues and
 * locale-aware number/date formatting) and §8.1 (money is never a float).
 *
 * Every amount that crosses the wire is an integer count of minor units, so
 * formatting divides with integer arithmetic and never with `/ 100`.
 */

export const DEFAULT_LOCALE = 'en-IN';
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

const MINOR_SCALE: Record<string, number> = { INR: 100, USD: 100, EUR: 100, GBP: 100, AED: 100 };

function symbolFor(currency: string): string {
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

export function formatMoney(
  amountMinor: number,
  currency = 'INR',
  options: { locale?: string; showSign?: boolean } = {},
): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const scale = MINOR_SCALE[currency] ?? 100;
  const negative = amountMinor < 0;
  const abs = Math.abs(Math.trunc(amountMinor));
  const major = Math.floor(abs / scale);
  const minor = abs % scale;
  const digits = String(scale).length - 1;

  const majorText = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(major);
  const fraction = digits > 0 ? `.${String(minor).padStart(digits, '0')}` : '';
  const sign = negative ? '−' : options.showSign && amountMinor > 0 ? '+' : '';
  return `${sign}${symbolFor(currency)}${majorText}${fraction}`;
}

/** Compact form for dashboard tiles: ₹2.15L, ₹1.2Cr — familiar in India. */
export function formatMoneyCompact(amountMinor: number, currency = 'INR'): string {
  const scale = MINOR_SCALE[currency] ?? 100;
  const major = Math.abs(Math.trunc(amountMinor)) / scale;
  const sign = amountMinor < 0 ? '−' : '';
  const symbol = symbolFor(currency);
  if (major >= 10_000_000) return `${sign}${symbol}${(major / 10_000_000).toFixed(2)}Cr`;
  if (major >= 100_000) return `${sign}${symbol}${(major / 100_000).toFixed(2)}L`;
  if (major >= 1_000) return `${sign}${symbol}${(major / 1_000).toFixed(1)}K`;
  return formatMoney(amountMinor, currency);
}

export function formatDate(
  value: string | Date | null | undefined,
  options: { timezone?: string; locale?: string; withTime?: boolean } = {},
): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(options.locale ?? DEFAULT_LOCALE, {
    timeZone: options.timezone ?? DEFAULT_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(options.withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

/** "in 3 days" / "2 hours ago", for expiry and decision timing. */
export function formatRelative(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const deltaMs = date.getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(deltaMs) >= ms || unit === 'minute') {
      return formatter.format(Math.round(deltaMs / ms), unit);
    }
  }
  return formatter.format(0, 'minute');
}

export function formatScheduleDelta(days: number): string {
  if (days === 0) return 'No change to the completion date';
  const magnitude = Math.abs(days);
  const noun = magnitude === 1 ? 'day' : 'days';
  return days > 0 ? `Adds ${magnitude} ${noun}` : `Saves ${magnitude} ${noun}`;
}

export function formatTaxRate(bps: number): string {
  if (bps === 0) return 'No tax';
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/**
 * Parses a rupee amount typed by a contractor into integer paise.
 * Accepts "1,50,000", "150000.50", "₹1500". Returns null when unparseable so
 * the caller can show a validation error rather than silently storing zero.
 */
export function parseMoneyToMinor(input: string, currency = 'INR'): number | null {
  const scale = MINOR_SCALE[currency] ?? 100;
  const cleaned = input.replace(/[₹$€£,\s]/g, '').trim();
  if (cleaned === '') return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const [wholeText = '0', fractionText = ''] = cleaned.replace('-', '').split('.');
  const digits = String(scale).length - 1;
  const whole = Number.parseInt(wholeText || '0', 10);
  const fraction = Number.parseInt(fractionText.padEnd(digits, '0').slice(0, digits) || '0', 10);
  if (Number.isNaN(whole) || Number.isNaN(fraction)) return null;
  const total = whole * scale + fraction;
  return cleaned.startsWith('-') ? -total : total;
}

/** Renders integer paise back into an editable rupee string. */
export function minorToInput(amountMinor: number, currency = 'INR'): string {
  const scale = MINOR_SCALE[currency] ?? 100;
  const digits = String(scale).length - 1;
  const negative = amountMinor < 0;
  const abs = Math.abs(Math.trunc(amountMinor));
  const whole = Math.floor(abs / scale);
  const fraction = abs % scale;
  const text =
    fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(digits, '0')}`;
  return negative ? `-${text}` : text;
}

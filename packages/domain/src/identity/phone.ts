import parsePhoneNumberFromString, { type CountryCode } from 'libphonenumber-js';
import { AppError } from '@extrawork/contracts';

/**
 * Normalization and masking — report §9.5 and §12.3.
 *
 * Indian ten-digit entry is accepted and normalised with country confirmation
 * (report §2.2); everything is stored as E.164.
 */

export const DEFAULT_COUNTRY: CountryCode = 'IN';

export function normalizePhone(input: string, country: CountryCode = DEFAULT_COUNTRY): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AppError('VALIDATION_FAILED', { message: 'Phone number is required' });
  }
  const parsed = parsePhoneNumberFromString(trimmed, country);
  if (!parsed || !parsed.isValid()) {
    throw new AppError('VALIDATION_FAILED', {
      message:
        'That phone number does not look valid. Include the country code, e.g. +91 98765 43210.',
    });
  }
  return parsed.number;
}

export function tryNormalizePhone(
  input: string | null | undefined,
  country: CountryCode = DEFAULT_COUNTRY,
): string | null {
  if (!input) return null;
  try {
    return normalizePhone(input, country);
  } catch {
    return null;
  }
}

/** Report §9.5: trim and lowercase only. Dots and plus tags are significant. */
export function normalizeEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new AppError('VALIDATION_FAILED', { message: 'That email address does not look valid' });
  }
  return trimmed;
}

export function tryNormalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    return normalizeEmail(input);
  } catch {
    return null;
  }
}

/** `+919876543210` -> `+91******3210` (report §8.3 snapshot example). */
export function maskPhone(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const parsed = parsePhoneNumberFromString(e164);
  const countryCode = parsed?.countryCallingCode ? `+${parsed.countryCallingCode}` : '';
  const national = parsed?.nationalNumber ?? e164.replace(/^\+/, '');
  const last4 = national.slice(-4);
  const hiddenCount = Math.max(national.length - 4, 0);
  return `${countryCode}${'*'.repeat(hiddenCount)}${last4}`;
}

/** `priya.sharma@example.com` -> `p***a@example.com`. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  if (local.length <= 2) return `${local[0] ?? '*'}***@${domain}`;
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`;
}

/** One string for whichever channel the approver actually has. */
export function maskedContactLabel(phoneE164: string | null, email: string | null): string {
  const phone = maskPhone(phoneE164);
  if (phone) return phone;
  const masked = maskEmail(email);
  return masked ?? 'contact on file';
}

/**
 * Search normalization: strip accents and punctuation for the search document
 * without touching the display value (report §9.5).
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Duplicate-candidate score (report §9.5). Suggestions only — merging is always
 * an explicit human action.
 */
export interface DuplicateSignal {
  samePhone: boolean;
  sameEmail: boolean;
  nameSimilarity: number;
}

export function duplicateScore(signal: DuplicateSignal): number {
  if (signal.samePhone) return 1;
  if (signal.sameEmail) return 0.9;
  return Math.min(signal.nameSimilarity, 0.85);
}

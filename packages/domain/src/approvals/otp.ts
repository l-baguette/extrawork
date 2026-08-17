import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { AppError } from '@extrawork/contracts';

/**
 * OTP challenge primitives for A1 assurance — report §3.3, §7.7 and §12.2.
 *
 * The plaintext code is returned once so a provider can deliver it, and only a
 * salted hash is stored. The code is never logged (report §11.5: "OTP delivery
 * and verification without logging code").
 */

export const OTP_DIGITS = 6;

export interface GeneratedOtp {
  /** Hand straight to the delivery provider; never persist or log. */
  code: string;
  codeHash: Buffer;
  salt: string;
}

export function generateOtp(salt: string): GeneratedOtp {
  const max = 10 ** OTP_DIGITS;
  const code = String(randomInt(0, max)).padStart(OTP_DIGITS, '0');
  return { code, codeHash: hashOtp(code, salt), salt };
}

export function hashOtp(code: string, salt: string): Buffer {
  return createHash('sha256').update(`${salt}:${code}`).digest();
}

export interface OtpChallengeState {
  id: string;
  codeHash: Buffer;
  salt: string;
  expiresAt: Date;
  attemptCount: number;
  maxAttempts: number;
  consumedAt: Date | null;
}

export interface OtpVerifyOutcome {
  verified: boolean;
  attemptsRemaining: number;
}

/**
 * Verifies in constant time and distinguishes "wrong" from "expired" from
 * "locked out", because a customer needs to know which it is — while the count
 * of remaining attempts is the only extra information disclosed.
 */
export function verifyOtp(
  challenge: OtpChallengeState,
  submittedCode: string,
  now: Date = new Date(),
): OtpVerifyOutcome {
  if (challenge.consumedAt) {
    throw new AppError('OTP_EXPIRED', { message: 'That code has already been used.' });
  }
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    throw new AppError('OTP_EXPIRED');
  }
  if (challenge.attemptCount >= challenge.maxAttempts) {
    throw new AppError('OTP_ATTEMPTS_EXCEEDED');
  }
  if (!/^\d{6}$/.test(submittedCode)) {
    return {
      verified: false,
      attemptsRemaining: challenge.maxAttempts - challenge.attemptCount - 1,
    };
  }

  const submittedHash = hashOtp(submittedCode, challenge.salt);
  const matches =
    submittedHash.length === challenge.codeHash.length &&
    timingSafeEqual(submittedHash, challenge.codeHash);

  return {
    verified: matches,
    attemptsRemaining: matches
      ? challenge.maxAttempts - challenge.attemptCount
      : challenge.maxAttempts - challenge.attemptCount - 1,
  };
}

/**
 * Report §7.7 OTP limits: 3 per 15 minutes and 10 per day, keyed by contact
 * plus IP. Returns the instant at which a resend becomes allowed.
 */
export interface OtpRateState {
  sentInWindow: number;
  sentToday: number;
  lastSentAt: Date | null;
}

export const OTP_WINDOW_LIMIT = 3;
export const OTP_WINDOW_MINUTES = 15;
export const OTP_DAILY_LIMIT = 10;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export function assertOtpSendAllowed(state: OtpRateState, now: Date = new Date()): Date {
  if (state.sentToday >= OTP_DAILY_LIMIT) {
    throw new AppError('RATE_LIMITED', {
      message: 'Too many verification codes requested today. Try again tomorrow.',
    });
  }
  if (state.sentInWindow >= OTP_WINDOW_LIMIT) {
    throw new AppError('RATE_LIMITED', {
      message: `Too many verification codes requested. Wait a few minutes and try again.`,
    });
  }
  if (state.lastSentAt) {
    const nextAllowed = new Date(state.lastSentAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000);
    if (nextAllowed > now) {
      throw new AppError('RATE_LIMITED', {
        message: 'Please wait a moment before requesting another code.',
        details: { retryAfterSeconds: Math.ceil((nextAllowed.getTime() - now.getTime()) / 1000) },
      });
    }
  }
  return new Date(now.getTime() + OTP_RESEND_COOLDOWN_SECONDS * 1000);
}

import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { AppError } from '@extrawork/contracts';

/**
 * `promisify` resolves to scrypt's three-argument overload and drops the
 * options parameter, so the cost settings below would be silently ignored.
 * Wrapping it by hand keeps them.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Password hashing for first-party accounts.
 *
 * scrypt from Node's standard library, rather than a dependency. It is a
 * memory-hard KDF designed for exactly this, it is specified in RFC 7914, and
 * avoiding a native module keeps the install reproducible across the machines
 * this runs on. Argon2id would be a defensible alternative; scrypt at these
 * parameters is not the weak link in this system.
 *
 * The stored form carries its own parameters:
 *
 *     scrypt$16384$8$1$<salt-b64>$<hash-b64>
 *
 * so the cost can be raised later and old hashes still verify. A verify that
 * succeeds against outdated parameters is a signal to re-hash on next login;
 * `needsRehash` reports it.
 */

/** CPU/memory cost. 16384 is the RFC's interactive-login recommendation. */
const N = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Node's scrypt refuses to allocate beyond this, and the default ceiling sits
 * below what N=16384 needs. Stated explicitly rather than left to a default
 * that differs between Node versions.
 */
const MAX_MEMORY = 64 * 1024 * 1024;

export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(plaintext.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });

  return [
    'scrypt',
    N,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Constant-time verification.
 *
 * Returns false rather than throwing on a malformed stored value: a corrupt
 * hash must read as "wrong password", never as an error that distinguishes one
 * account from another.
 */
export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const n = Number.parseInt(nRaw as string, 10);
  const r = Number.parseInt(rRaw as string, 10);
  const p = Number.parseInt(pRaw as string, 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashB64 as string, 'base64');
  } catch {
    return false;
  }

  try {
    const derived = await scrypt(
      plaintext.normalize('NFKC'),
      Buffer.from(saltB64 as string, 'base64'),
      expected.length,
      { N: n, r, p, maxmem: MAX_MEMORY },
    );
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash used weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number.parseInt(parts[1] as string, 10) < N;
}

/**
 * The rules a new password must satisfy.
 *
 * Deliberately short. Length is what actually resists offline cracking;
 * character-class rules mostly push people toward `Password1!` and a sticky
 * note. The one substantive extra check is against the handful of passwords
 * that appear at the top of every breach corpus.
 */
const OBVIOUS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  'qwertyui',
  'qwerty123',
  'letmein1',
  'iloveyou',
  'admin123',
  'welcome1',
]);

export const MIN_PASSWORD_LENGTH = 8;

export function assertUsablePassword(plaintext: string, email?: string): void {
  const value = plaintext.normalize('NFKC');

  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new AppError('VALIDATION_FAILED', {
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  }
  if (value.length > 200) {
    throw new AppError('VALIDATION_FAILED', { message: 'That password is too long.' });
  }
  if (OBVIOUS.has(value.toLowerCase())) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'That password appears in every breach list. Choose something else.',
    });
  }
  // A password that is the email address is a password an attacker already has.
  if (email && value.toLowerCase() === email.toLowerCase()) {
    throw new AppError('VALIDATION_FAILED', {
      message: 'Your password cannot be your email address.',
    });
  }
}

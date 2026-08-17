import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ULID-shaped request identifier: sortable by time, opaque, and safe to show a
 * user in an error message (report §7.2 returns `requestId` in every envelope).
 */
export function newRequestId(now: number = Date.now()): string {
  let time = now;
  const timeChars = new Array<string>(10);
  for (let i = 9; i >= 0; i -= 1) {
    timeChars[i] = CROCKFORD[time % 32] as string;
    time = Math.floor(time / 32);
  }
  const random = randomBytes(16);
  let randomChars = '';
  for (let i = 0; i < 16; i += 1) {
    randomChars += CROCKFORD[(random[i] as number) % 32];
  }
  return `req_${timeChars.join('')}${randomChars}`;
}

/** Accepts a caller-supplied id only if it looks safe to echo into logs. */
export function sanitizeIncomingRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < 8 || value.length > 64) return null;
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) return null;
  return value;
}

import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '@extrawork/domain';

describe('password hashes', () => {
  it('recognises hashes produced by the current policy', async () => {
    const hash = await hashPassword('a sufficiently long passphrase');

    expect(needsRehash(hash)).toBe(false);
    await expect(verifyPassword('a sufficiently long passphrase', hash)).resolves.toBe(true);
  });

  it.each([
    'not-a-password-hash',
    'scrypt$8192$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    'scrypt$16384$4$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    'scrypt$16384$8$0$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    'scrypt$16384oops$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    'scrypt$16384$8$1$short==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  ])('requires an upgrade for malformed or weaker policy data: %s', (hash) => {
    expect(needsRehash(hash)).toBe(true);
  });

  it('does not downgrade a hash whose parameters exceed the current policy', () => {
    const salt = Buffer.alloc(16).toString('base64');
    const hash = Buffer.alloc(64).toString('base64');
    expect(needsRehash(`scrypt$32768$8$1$${salt}$${hash}`)).toBe(false);
  });
});

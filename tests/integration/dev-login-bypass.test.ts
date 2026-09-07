import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@extrawork/domain';
import type { Container } from '@extrawork/runtime';
import { createTestContainer, createTenant, truncateAll } from '@extrawork/testkit';
import { AuthService, localAuthSubject, type AuthProvider } from '@extrawork/application';

/**
 * The `test@gmail.com` convenience bypass is a deliberate backdoor for local
 * testing: any password signs that address in. It is gated on
 * `APP_ENV !== 'production'`.
 *
 * A comment saying so is not a guarantee — a refactor that drops the gate looks
 * harmless in review and turns a known account into an unauthenticated door.
 * This pins the gate, so removing it fails here instead of in the wild.
 *
 * If the bypass is ever deleted (it should be, before launch), delete this file
 * with it — the first test will fail and say so.
 */

let container: Container;

const BYPASS_EMAIL = 'test@gmail.com';
const REAL_PASSWORD = 'a-real-password-nobody-guesses';

/** The provider is irrelevant to password verification; a stub keeps this local. */
const stubProvider: AuthProvider = {
  name: 'stub',
  async beginSignIn() {
    return null;
  },
  async completeSignIn() {
    throw new Error('not used');
  },
};

function authServiceForEnv(appEnv: 'local' | 'production'): AuthService {
  const appContext = {
    ...container.appContext,
    env: { ...container.appContext.env, APP_ENV: appEnv },
  };
  return new AuthService(appContext, stubProvider);
}

async function createBypassAccount(organizationId: string): Promise<void> {
  const passwordHash = await hashPassword(REAL_PASSWORD);
  await container.uow.transaction(async (tx) => {
    const user = await container.repos.identity.upsertUser(tx, {
      provider: 'local',
      subject: localAuthSubject(BYPASS_EMAIL),
      email: BYPASS_EMAIL,
      displayName: 'Test Owner',
    });
    await container.repos.identity.setPassword(tx, user.id, passwordHash);
    await container.repos.identity.markEmailVerified(tx, user.id, new Date());
    await container.repos.organizations.addMembership(tx, {
      organizationId,
      userId: user.id,
      role: 'ADMIN',
    });
  });
}

beforeAll(() => {
  container = createTestContainer();
});

afterAll(async () => {
  await container.close();
});

beforeEach(async () => {
  await truncateAll(container);
  const tenant = await createTenant(container, { name: 'Alpha Interiors' });
  await createBypassAccount(tenant.organizationId);
});

describe('development login bypass', () => {
  it('accepts any password for the test account outside production', async () => {
    const identity = await authServiceForEnv('local').verifyPassword(
      BYPASS_EMAIL,
      'not-the-password',
    );
    expect(identity).not.toBeNull();
  });

  it('REFUSES the same wrong password when APP_ENV is production', async () => {
    const identity = await authServiceForEnv('production').verifyPassword(
      BYPASS_EMAIL,
      'not-the-password',
    );
    expect(identity).toBeNull();
  });

  it('still accepts the real password in production', async () => {
    const identity = await authServiceForEnv('production').verifyPassword(
      BYPASS_EMAIL,
      REAL_PASSWORD,
    );
    expect(identity).not.toBeNull();
  });

  it('does not extend the bypass to any other address', async () => {
    const identity = await authServiceForEnv('local').verifyPassword(
      'someone.else@gmail.com',
      'not-the-password',
    );
    expect(identity).toBeNull();
  });
});

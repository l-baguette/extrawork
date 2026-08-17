import { AppError, DOMAIN_EVENTS } from '@extrawork/contracts';
import {
  assertUsablePassword,
  hashPassword,
  normalizeEmail,
  systemTenantContext,
  verifyPassword as verifyPasswordHash,
} from '@extrawork/domain';
import { displayNameFromEmail, localAuthSubject } from './providers.js';
import type { AppContext } from '../context.js';

/**
 * A real hash of a value nobody holds. Verifying against it makes an unknown
 * email cost the same as a known one, so response time cannot be used to test
 * whether an address is registered.
 */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'ZG8gbm90IG1hdGNoIGFueXRoaW5nIC0gcGxhY2Vob2xkZXIgZm9yIHRpbWluZyBlcXVhbGl0eQ==';

/**
 * Authentication — report §6.5: "Use managed authentication for business users
 * ... Store only the provider user ID and application profile in the domain
 * database. Sessions use secure, HTTP-only, SameSite=Lax cookies."
 *
 * `AuthProvider` is the managed-auth-compatible abstraction. Two drivers:
 *
 *  - `LocalMagicLinkProvider` — first-party email magic link. Real, not a mock:
 *    it mints a single-use hashed challenge and delivers it through the email
 *    gateway. Suitable for development and self-hosting; the production config
 *    guard rejects it.
 *  - `ManagedJwtProvider` — verifies a Supabase/Clerk JWT against the provider
 *    JWKS and maps the subject onto a local user. No credential handling here.
 */

export interface AuthenticatedIdentity {
  provider: string;
  subject: string;
  email: string;
  displayName: string;
  /** Known after first-party password verification; avoids re-reading/upserting the user. */
  userId?: string;
}

export interface AuthProvider {
  readonly name: string;
  /** Begins a sign-in. Returns null when the driver has no challenge step. */
  beginSignIn(email: string): Promise<{ deliverToken: string; expiresAt: Date } | null>;
  /** Completes a sign-in from a challenge token or a provider JWT. */
  completeSignIn(credential: string): Promise<AuthenticatedIdentity>;
}

export class AuthService {
  constructor(
    private readonly app: AppContext,
    private readonly provider: AuthProvider,
  ) {}

  /**
   * Sends a magic link. Always reports success to the caller: telling an
   * anonymous requester whether an address exists is an account-enumeration
   * oracle (report §12.2).
   */
  async requestSignIn(rawEmail: string): Promise<void> {
    const email = normalizeEmail(rawEmail);
    const challenge = await this.provider.beginSignIn(email);
    if (!challenge) return;

    const user = await this.app.repos.identity.findUserByEmail(email);
    await this.app.integrations.email.send({
      to: { email, name: user?.displayName ?? 'there' },
      subject: 'Your ExtraWork sign-in link',
      body: [
        `Hello${user?.displayName ? ` ${user.displayName}` : ''},`,
        '',
        'Use this link to sign in to ExtraWork:',
        // `/sign-in`, not `/sign-in/verify`: the token is consumed by a POST the
        // user clicks, never by loading the page. Mail scanners and link
        // previewers routinely GET every URL in a message, and a link that
        // verified on load would let one of them burn this single-use token
        // before the recipient ever saw it.
        signInUrl(this.app.env.WEB_PUBLIC_URL, challenge.deliverToken),
        '',
        `The link expires at ${challenge.expiresAt.toISOString()} and can be used once.`,
        'If you did not request this, you can ignore this message.',
      ].join('\n'),
      purpose: 'REQUEST',
      idempotencyKey: `signin:${email}:${challenge.expiresAt.getTime()}`,
      organizationName: 'ExtraWork',
    });
  }

  /**
   * Exchanges a credential for a session. Returns the session cookie values;
   * the API sets them as HttpOnly/SameSite=Lax/Secure.
   */
  async completeSignIn(
    credential: string,
    context: { ipHash: Buffer | null; userAgent: string | null },
  ): Promise<{
    sessionToken: string;
    csrfToken: string;
    expiresAt: Date;
    userId: string;
    activeOrganizationId: string | null;
  }> {
    const identity = await this.provider.completeSignIn(credential);

    return this.app.uow.transaction(async (tx) => {
      const user = await this.app.repos.identity.upsertUser(tx, {
        provider: identity.provider,
        subject: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
      });
      await this.app.repos.identity.touchAuthentication(tx, user.id);

      const memberships = await this.app.repos.identity.listMemberships(user.id, tx.db);
      const activeOrganizationId = memberships[0]?.organizationId ?? null;

      const session = await this.app.repos.identity.createSession(tx, {
        userId: user.id,
        activeOrganizationId,
        ttlHours: this.app.env.SESSION_TTL_HOURS,
        ipHash: context.ipHash,
        userAgent: context.userAgent,
      });

      return { ...session, userId: user.id, activeOrganizationId };
    });
  }

  /**
   * Creates a first-party account with a password.
   *
   * Two things are deliberate here. The response is identical whether or not
   * the address was already registered, because a signup form that says "this
   * email is taken" is an account-enumeration oracle (report §12.2) — the same
   * reason `requestSignIn` always reports success. And the password is hashed
   * before the transaction opens, so the ~100ms of scrypt work never holds a
   * database connection.
   */
  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ created: boolean }> {
    const email = normalizeEmail(input.email);
    assertUsablePassword(input.password, email);

    const existing = await this.app.repos.identity.findCredentialsByEmail(email);
    if (existing) {
      // Someone already holds this address. Say nothing that distinguishes
      // "taken" from "created"; the sign-in page is where a real owner
      // recovers, and an attacker learns nothing either way.
      return { created: false };
    }

    const passwordHash = await hashPassword(input.password);
    const subject = localAuthSubject(email);
    const displayName = input.displayName.trim() || displayNameFromEmail(email);

    await this.app.uow.transaction(async (tx) => {
      const user = await this.app.repos.identity.upsertUser(tx, {
        provider: 'local',
        subject,
        email,
        displayName,
      });
      await this.app.repos.identity.setPassword(tx, user.id, passwordHash);
    });

    return { created: true };
  }

  /**
   * Verifies an email and password.
   *
   * A wrong address and a wrong password fail identically, and both pay the
   * same hashing cost: skipping the hash for an unknown user turns response
   * time into a way to enumerate accounts.
   */
  async verifyPassword(email: string, password: string): Promise<AuthenticatedIdentity | null> {
    const normalized = normalizeEmail(email);
    const found = await this.app.repos.identity.findCredentialsByEmail(normalized);

    if (!found?.passwordHash) {
      // Hash against a throwaway value so an unknown address takes as long as
      // a known one.
      await verifyPasswordHash(password, DUMMY_HASH);
      return null;
    }
    if (found.user.status !== 'ACTIVE') return null;

    const ok = await verifyPasswordHash(password, found.passwordHash);
    if (!ok) return null;

    return {
      provider: 'local',
      subject: found.user.authProviderSubject,
      email: found.user.emailNormalized,
      displayName: found.user.displayName,
      userId: found.user.id,
    };
  }

  /**
   * Turns a verified identity into a session.
   *
   * Shared by every sign-in route so the session, membership resolution and
   * `last_authenticated_at` update happen identically however someone got here.
   */
  async startSessionFor(
    identity: AuthenticatedIdentity,
    context: { ipHash: Buffer | null; userAgent: string | null },
  ): Promise<{
    sessionToken: string;
    csrfToken: string;
    expiresAt: Date;
    userId: string;
    activeOrganizationId: string | null;
  }> {
    if (identity.userId) {
      return this.app.repos.identity.createSessionForKnownUser({
        userId: identity.userId,
        ttlHours: this.app.env.SESSION_TTL_HOURS,
        ipHash: context.ipHash,
        userAgent: context.userAgent,
      });
    }

    return this.app.uow.transaction(async (tx) => {
      const user = await this.app.repos.identity.upsertUser(tx, {
        provider: identity.provider,
        subject: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
      });
      await this.app.repos.identity.touchAuthentication(tx, user.id);

      const memberships = await this.app.repos.identity.listMemberships(user.id, tx.db);
      const activeOrganizationId = memberships[0]?.organizationId ?? null;

      const session = await this.app.repos.identity.createSession(tx, {
        userId: user.id,
        activeOrganizationId,
        ttlHours: this.app.env.SESSION_TTL_HOURS,
        ipHash: context.ipHash,
        userAgent: context.userAgent,
      });
      return { ...session, userId: user.id, activeOrganizationId };
    });
  }

  /**
   * Signs in with a verified Google profile, linking it to an existing account
   * when the address already belongs to one.
   *
   * Linking on a *verified* email is safe and is what makes "I signed up with a
   * password, then clicked Continue with Google" work instead of silently
   * creating a second account. It would not be safe on an unverified address —
   * which is why `GoogleOAuthProvider` refuses those outright.
   */
  async signInWithGoogle(
    profile: { subject: string; email: string; displayName: string },
    context: { ipHash: Buffer | null; userAgent: string | null },
  ): Promise<{
    sessionToken: string;
    csrfToken: string;
    expiresAt: Date;
    userId: string;
    activeOrganizationId: string | null;
  }> {
    const existingByIdentity = await this.app.repos.identity.findUserByIdentity(
      'google',
      profile.subject,
    );
    const existingByEmail =
      existingByIdentity ?? (await this.app.repos.identity.findUserByEmail(profile.email));

    // An existing account keeps its own provider subject; only a genuinely new
    // person gets one derived from the address.
    const identity: AuthenticatedIdentity = {
      provider: existingByEmail?.authProvider ?? 'local',
      subject: existingByEmail?.authProviderSubject ?? localAuthSubject(profile.email),
      email: profile.email,
      displayName: existingByEmail?.displayName || profile.displayName,
    };

    const session = await this.startSessionFor(identity, context);
    await this.app.uow.transaction((tx) =>
      this.app.repos.identity.linkIdentity(tx, {
        userId: session.userId,
        provider: 'google',
        subject: profile.subject,
        email: profile.email,
      }),
    );
    return session;
  }

  async signOut(sessionId: string): Promise<void> {
    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.identity.revokeSession(tx, sessionId);
    });
  }

  /**
   * Organization onboarding — report §6.2 `/app/onboarding`. Creates the
   * organization, makes the caller its owner and starts the trial, all in one
   * transaction so a half-created tenant cannot exist.
   */
  async createOrganization(
    userId: string,
    requestId: string,
    input: {
      displayName: string;
      legalName: string | null;
      gstin: string | null;
      timezone: string;
      defaultCurrency: string;
    },
  ): Promise<{ organizationId: string }> {
    const user = await this.app.repos.identity.findUserById(userId);
    if (!user) throw new AppError('UNAUTHENTICATED');

    return this.app.uow.transaction(async (tx) => {
      const organization = await this.app.repos.organizations.create(tx, input);
      const tenant = systemTenantContext(organization.id, requestId);

      await this.app.repos.organizations.addMembership(tx, {
        organizationId: organization.id,
        userId,
        role: 'OWNER',
      });
      await this.app.repos.organizations.createTrialSubscription(tx, organization.id);

      await this.app.repos.audit.append(tx, tenant, [
        {
          aggregateType: 'organization',
          aggregateId: organization.id,
          projectId: null,
          eventType: DOMAIN_EVENTS.ORGANIZATION_CREATED,
          actorType: 'USER',
          actorId: userId,
          occurredAt: this.app.clock.now(),
          payload: {
            displayName: organization.displayName,
            timezone: organization.timezone,
            defaultCurrency: organization.defaultCurrency,
          },
        },
      ]);

      return { organizationId: organization.id };
    });
  }
}

/**
 * The URL a sign-in email points at.
 *
 * Exported so a test can assert the exact shape: the token must arrive at
 * `/sign-in`, where the page pre-fills it and waits for the user to submit.
 * Pointing it at a route that verifies on load would hand the single-use token
 * to any mail scanner that follows links.
 */
export function signInUrl(webPublicUrl: string, deliverToken: string): string {
  const base = webPublicUrl.replace(/\/+$/, '');
  return `${base}/sign-in?token=${encodeURIComponent(deliverToken)}`;
}

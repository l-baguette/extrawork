import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError, type MembershipRole } from '@extrawork/contracts';
import {
  isReadOnly,
  type PlanCode,
  type SubscriptionState,
  type SubscriptionStatus,
} from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull } from '../row-types.js';

/**
 * Identity, sessions and membership — report §7.1 (Identity module), §6.5
 * (sessions) and §12.1 (short session lifetime with revocation on membership
 * removal).
 *
 * The domain database stores only the provider subject and an application
 * profile; the managed provider owns credentials (report §6.5).
 */

export function hashOpaqueToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function generateOpaqueToken(bytes = 32): { token: string; hash: Buffer } {
  const token = randomBytes(bytes).toString('base64url');
  return { token, hash: hashOpaqueToken(token) };
}

export interface UserRow {
  id: string;
  authProvider: string;
  authProviderSubject: string;
  emailNormalized: string;
  displayName: string;
  status: string;
  lastAuthenticatedAt: Date | null;
}

export interface MembershipRow {
  organizationId: string;
  userId: string;
  role: MembershipRole;
  status: string;
  organizationName: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  activeOrganizationId: string | null;
  authenticatedAt: Date;
  expiresAt: Date;
  csrfTokenHash: Buffer;
}

/**
 * Everything the API needs to authorize one business request. Keeping this as
 * one database projection is especially important when the API and Postgres
 * are in different regions: authorization has one network round trip instead
 * of separate session, membership, organization, grant and subscription
 * lookups.
 */
export interface AuthenticatedSessionContext {
  session: SessionRow;
  organizationId: string | null;
  membershipRole: MembershipRole | null;
  membershipStatus: string | null;
  organizationStatus: string | null;
  organizationTimezone: string | null;
  projectGrants: string[];
  readOnly: boolean | null;
}

export class IdentityRepository {
  constructor(private readonly db: Database) {}

  async findUserBySubject(provider: string, subject: string): Promise<UserRow | null> {
    const result = await this.db.execute<UserRecord>(sql`
      SELECT id, auth_provider, auth_provider_subject, email_normalized,
             display_name, status, last_authenticated_at
      FROM users
      WHERE auth_provider = ${provider} AND auth_provider_subject = ${subject}
    `);
    return mapUser(result.rows[0]);
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const result = await this.db.execute<UserRecord>(sql`
      SELECT id, auth_provider, auth_provider_subject, email_normalized,
             display_name, status, last_authenticated_at
      FROM users WHERE email_normalized = ${email}
    `);
    return mapUser(result.rows[0]);
  }

  /**
   * A user plus their password hash, for the sign-in path only.
   *
   * Deliberately a separate method from `findUserByEmail`: the hash must reach
   * exactly one caller, and a field that is absent from the ordinary row cannot
   * be logged, serialised into a response, or returned by accident.
   */
  async findCredentialsByEmail(
    email: string,
  ): Promise<{ user: UserRow; passwordHash: string | null } | null> {
    const result = await this.db.execute<UserRecord & { password_hash: string | null }>(sql`
      SELECT id, auth_provider, auth_provider_subject, email_normalized,
             display_name, status, last_authenticated_at, password_hash
      FROM users WHERE email_normalized = ${email}
    `);
    const row = result.rows[0];
    if (!row) return null;
    const user = mapUser(row);
    return user ? { user, passwordHash: row.password_hash } : null;
  }

  async setPassword(tx: TransactionContext, userId: string, passwordHash: string): Promise<void> {
    await tx.db.execute(sql`
      UPDATE users
         SET password_hash = ${passwordHash}, password_set_at = now(), updated_at = now()
       WHERE id = ${userId}::uuid
    `);
  }

  /** Links a third-party identity, or refreshes it if already linked. */
  async linkIdentity(
    tx: TransactionContext,
    input: { userId: string; provider: 'google'; subject: string; email: string | null },
  ): Promise<void> {
    await tx.db.execute(sql`
      INSERT INTO user_identities (id, user_id, provider, provider_subject, email_normalized, last_used_at)
      VALUES (${newId()}::uuid, ${input.userId}::uuid, ${input.provider},
              ${input.subject}, ${input.email}, now())
      ON CONFLICT (provider, provider_subject)
      DO UPDATE SET last_used_at = now(), email_normalized = EXCLUDED.email_normalized
    `);
  }

  /** The user behind a third-party subject, if that identity is already linked. */
  async findUserByIdentity(provider: 'google', subject: string): Promise<UserRow | null> {
    const result = await this.db.execute<UserRecord>(sql`
      SELECT u.id, u.auth_provider, u.auth_provider_subject, u.email_normalized,
             u.display_name, u.status, u.last_authenticated_at
      FROM user_identities i
      JOIN users u ON u.id = i.user_id
      WHERE i.provider = ${provider} AND i.provider_subject = ${subject}
    `);
    return mapUser(result.rows[0]);
  }

  async findUserById(id: string): Promise<UserRow | null> {
    const result = await this.db.execute<UserRecord>(sql`
      SELECT id, auth_provider, auth_provider_subject, email_normalized,
             display_name, status, last_authenticated_at
      FROM users WHERE id = ${id}::uuid
    `);
    return mapUser(result.rows[0]);
  }

  /**
   * Creates or refreshes the local profile for a provider identity. Idempotent
   * so a repeated sign-in webhook cannot duplicate a user.
   */
  async upsertUser(
    tx: TransactionContext,
    input: { provider: string; subject: string; email: string; displayName: string },
  ): Promise<UserRow> {
    const result = await tx.db.execute<UserRecord>(sql`
      INSERT INTO users (id, auth_provider, auth_provider_subject, email_normalized, display_name)
      VALUES (${newId()}::uuid, ${input.provider}, ${input.subject}, ${input.email}, ${input.displayName})
      ON CONFLICT (auth_provider_subject)
      DO UPDATE SET email_normalized = EXCLUDED.email_normalized,
                    display_name = EXCLUDED.display_name,
                    updated_at = now()
      RETURNING id, auth_provider, auth_provider_subject, email_normalized,
                display_name, status, last_authenticated_at
    `);
    const user = mapUser(result.rows[0]);
    if (!user) throw new AppError('INTERNAL_ERROR', { message: 'User upsert returned no row' });
    return user;
  }

  async listMemberships(userId: string, db: Database = this.db): Promise<MembershipRow[]> {
    const result = await db.execute<{
      organization_id: string;
      user_id: string;
      role: MembershipRole;
      status: string;
      organization_name: string;
    }>(sql`
      SELECT m.organization_id, m.user_id, m.role, m.status, o.display_name AS organization_name
      FROM memberships m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${userId}::uuid AND m.status = 'ACTIVE' AND o.status <> 'CLOSED'
      ORDER BY o.display_name
    `);
    return result.rows.map((r) => ({
      organizationId: r.organization_id,
      userId: r.user_id,
      role: r.role,
      status: r.status,
      organizationName: r.organization_name,
    }));
  }

  async getMembership(organizationId: string, userId: string): Promise<MembershipRow | null> {
    const result = await this.db.execute<{
      organization_id: string;
      user_id: string;
      role: MembershipRole;
      status: string;
      organization_name: string;
    }>(sql`
      SELECT m.organization_id, m.user_id, m.role, m.status, o.display_name AS organization_name
      FROM memberships m
      JOIN organizations o ON o.id = m.organization_id
      WHERE m.organization_id = ${organizationId}::uuid AND m.user_id = ${userId}::uuid
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.role,
      status: row.status,
      organizationName: row.organization_name,
    };
  }

  /** Project grants for roles that are not organization-wide (report §3.2). */
  async listProjectGrants(organizationId: string, userId: string): Promise<string[]> {
    const result = await this.db.execute<{ project_id: string }>(sql`
      SELECT project_id FROM project_members
      WHERE organization_id = ${organizationId}::uuid AND user_id = ${userId}::uuid
    `);
    return result.rows.map((r) => r.project_id);
  }

  // --- Sessions ------------------------------------------------------------

  async createSession(
    tx: TransactionContext,
    input: {
      userId: string;
      activeOrganizationId: string | null;
      ttlHours: number;
      ipHash: Buffer | null;
      userAgent: string | null;
    },
  ): Promise<{ sessionToken: string; csrfToken: string; expiresAt: Date }> {
    const session = generateOpaqueToken();
    const csrf = generateOpaqueToken(24);
    const expiresAt = new Date(Date.now() + input.ttlHours * 3_600_000);

    await tx.db.execute(sql`
      INSERT INTO sessions
        (id, user_id, token_hash, active_organization_id, csrf_token_hash,
         expires_at, ip_hash, user_agent)
      VALUES (
        ${newId()}::uuid, ${input.userId}::uuid, ${session.hash},
        ${input.activeOrganizationId}::uuid, ${csrf.hash},
        ${expiresAt.toISOString()}::timestamptz, ${input.ipHash}, ${input.userAgent}
      )
    `);

    return { sessionToken: session.token, csrfToken: csrf.token, expiresAt };
  }

  /**
   * Fast path after a password has already identified a concrete active user.
   * Touching the profile, selecting the default organization and inserting the
   * session are one atomic statement and therefore one remote round trip.
   */
  async createSessionForKnownUser(input: {
    userId: string;
    ttlHours: number;
    ipHash: Buffer | null;
    userAgent: string | null;
  }): Promise<{
    sessionToken: string;
    csrfToken: string;
    expiresAt: Date;
    userId: string;
    activeOrganizationId: string | null;
  }> {
    const session = generateOpaqueToken();
    const csrf = generateOpaqueToken(24);
    const expiresAt = new Date(Date.now() + input.ttlHours * 3_600_000);

    const result = await this.db.execute<{
      user_id: string;
      active_organization_id: string | null;
    }>(sql`
      WITH touched_user AS (
        UPDATE users
           SET last_authenticated_at = now(), updated_at = now()
         WHERE id = ${input.userId}::uuid AND status = 'ACTIVE'
        RETURNING id
      ), active_organization AS (
        SELECT m.organization_id
        FROM memberships m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = (SELECT id FROM touched_user)
          AND m.status = 'ACTIVE'
          AND o.status <> 'CLOSED'
        ORDER BY o.display_name, m.organization_id
        LIMIT 1
      ), inserted_session AS (
        INSERT INTO sessions
          (id, user_id, token_hash, active_organization_id, csrf_token_hash,
           expires_at, ip_hash, user_agent)
        SELECT
          ${newId()}::uuid, u.id, ${session.hash},
          (SELECT organization_id FROM active_organization), ${csrf.hash},
          ${expiresAt.toISOString()}::timestamptz, ${input.ipHash}, ${input.userAgent}
        FROM touched_user u
        RETURNING user_id, active_organization_id
      )
      SELECT user_id, active_organization_id FROM inserted_session
    `);

    const row = result.rows[0];
    if (!row) throw new AppError('UNAUTHENTICATED');
    return {
      sessionToken: session.token,
      csrfToken: csrf.token,
      expiresAt,
      userId: row.user_id,
      activeOrganizationId: row.active_organization_id,
    };
  }

  async resolveSession(sessionToken: string): Promise<SessionRow | null> {
    const result = await this.db.execute<{
      id: string;
      user_id: string;
      active_organization_id: string | null;
      authenticated_at: Date;
      expires_at: Date;
      csrf_token_hash: Buffer;
    }>(sql`
      SELECT id, user_id, active_organization_id, authenticated_at, expires_at, csrf_token_hash
      FROM sessions
      WHERE token_hash = ${hashOpaqueToken(sessionToken)}
        AND revoked_at IS NULL
        AND expires_at > now()
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      activeOrganizationId: row.active_organization_id,
      authenticatedAt: toDate(row.authenticated_at),
      expiresAt: toDate(row.expires_at),
      csrfTokenHash: Buffer.isBuffer(row.csrf_token_hash)
        ? row.csrf_token_hash
        : Buffer.from(row.csrf_token_hash),
    };
  }

  async resolveAuthenticatedSession(
    sessionToken: string,
    organizationOverride: string | null,
  ): Promise<AuthenticatedSessionContext | null> {
    const result = await this.db.execute<AuthenticatedSessionRecord>(sql`
      WITH valid_session AS (
        SELECT id, user_id, active_organization_id, authenticated_at, expires_at,
               csrf_token_hash,
               COALESCE(${organizationOverride}::uuid, active_organization_id) AS resolved_organization_id
        FROM sessions
        WHERE token_hash = ${hashOpaqueToken(sessionToken)}
          AND revoked_at IS NULL
          AND expires_at > now()
      )
      SELECT s.id, s.user_id, s.active_organization_id, s.authenticated_at,
             s.expires_at, s.csrf_token_hash, s.resolved_organization_id,
             m.role AS membership_role, m.status AS membership_status,
             o.status AS organization_status, o.timezone AS organization_timezone,
             sub.plan_code, sub.status AS subscription_status,
             sub.current_period_start, sub.current_period_end, sub.grace_ends_at,
             COALESCE(
               ARRAY(
                 SELECT pm.project_id::text
                 FROM project_members pm
                 WHERE pm.organization_id = s.resolved_organization_id
                   AND pm.user_id = s.user_id
                 ORDER BY pm.project_id
               ),
               ARRAY[]::text[]
             ) AS project_grants
      FROM valid_session s
      LEFT JOIN memberships m
        ON m.organization_id = s.resolved_organization_id AND m.user_id = s.user_id
      LEFT JOIN organizations o ON o.id = s.resolved_organization_id
      LEFT JOIN subscriptions sub ON sub.organization_id = s.resolved_organization_id
    `);

    const row = result.rows[0];
    if (!row) return null;

    const subscription = mapSubscriptionState(row);
    return {
      session: {
        id: row.id,
        userId: row.user_id,
        activeOrganizationId: row.active_organization_id,
        authenticatedAt: toDate(row.authenticated_at),
        expiresAt: toDate(row.expires_at),
        csrfTokenHash: Buffer.isBuffer(row.csrf_token_hash)
          ? row.csrf_token_hash
          : Buffer.from(row.csrf_token_hash),
      },
      organizationId: row.resolved_organization_id,
      membershipRole: row.membership_role,
      membershipStatus: row.membership_status,
      organizationStatus: row.organization_status,
      organizationTimezone: row.organization_timezone,
      projectGrants: row.project_grants,
      readOnly: subscription ? isReadOnly(subscription) : null,
    };
  }

  verifyCsrf(session: SessionRow, csrfToken: string | undefined): boolean {
    if (!csrfToken) return false;
    const submitted = hashOpaqueToken(csrfToken);
    return (
      submitted.length === session.csrfTokenHash.length &&
      timingSafeEqual(submitted, session.csrfTokenHash)
    );
  }

  async setActiveOrganization(
    tx: TransactionContext,
    sessionId: string,
    organizationId: string,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE sessions SET active_organization_id = ${organizationId}::uuid
      WHERE id = ${sessionId}::uuid
    `);
  }

  async revokeSession(tx: TransactionContext, sessionId: string): Promise<void> {
    await tx.db.execute(sql`
      UPDATE sessions SET revoked_at = now() WHERE id = ${sessionId}::uuid
    `);
  }

  /**
   * Report §12.1: sessions are revoked when membership is removed. Called from
   * the same transaction that revokes the membership.
   */
  async revokeSessionsForMembership(
    tx: TransactionContext,
    organizationId: string,
    userId: string,
  ): Promise<number> {
    const result = await tx.db.execute(sql`
      UPDATE sessions SET revoked_at = now()
      WHERE user_id = ${userId}::uuid
        AND revoked_at IS NULL
        AND (active_organization_id = ${organizationId}::uuid OR active_organization_id IS NULL)
    `);
    return result.rowCount ?? 0;
  }

  async purgeExpiredSessions(): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM sessions WHERE expires_at < now() - interval '7 days'
    `);
    return result.rowCount ?? 0;
  }

  // --- Magic-link / invitation challenges ----------------------------------

  async createAuthChallenge(
    tx: TransactionContext,
    input: {
      email: string;
      purpose: 'SIGN_IN' | 'INVITATION';
      organizationId: string | null;
      ttlMinutes: number;
    },
  ): Promise<{ token: string; expiresAt: Date }> {
    const { token, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000);
    await tx.db.execute(sql`
      INSERT INTO auth_challenges
        (id, email_normalized, token_hash, purpose, organization_id, expires_at)
      VALUES (
        ${newId()}::uuid, ${input.email}, ${hash}, ${input.purpose},
        ${input.organizationId}::uuid, ${expiresAt.toISOString()}::timestamptz
      )
    `);
    return { token, expiresAt };
  }

  /** Single-use: the UPDATE only matches while `consumed_at IS NULL`. */
  async consumeAuthChallenge(
    tx: TransactionContext,
    token: string,
  ): Promise<{ email: string; purpose: string; organizationId: string | null } | null> {
    const result = await tx.db.execute<{
      email_normalized: string;
      purpose: string;
      organization_id: string | null;
    }>(sql`
      UPDATE auth_challenges
         SET consumed_at = now()
       WHERE token_hash = ${hashOpaqueToken(token)}
         AND consumed_at IS NULL
         AND expires_at > now()
      RETURNING email_normalized, purpose, organization_id
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      email: row.email_normalized,
      purpose: row.purpose,
      organizationId: row.organization_id,
    };
  }

  async touchAuthentication(tx: TransactionContext, userId: string): Promise<void> {
    await tx.db.execute(sql`
      UPDATE users SET last_authenticated_at = now() WHERE id = ${userId}::uuid
    `);
  }
}

type UserRecord = {
  id: string;
  auth_provider: string;
  auth_provider_subject: string;
  email_normalized: string;
  display_name: string;
  status: string;
  last_authenticated_at: Date | null;
};

type AuthenticatedSessionRecord = {
  id: string;
  user_id: string;
  active_organization_id: string | null;
  authenticated_at: Date;
  expires_at: Date;
  csrf_token_hash: Buffer;
  resolved_organization_id: string | null;
  membership_role: MembershipRole | null;
  membership_status: string | null;
  organization_status: string | null;
  organization_timezone: string | null;
  plan_code: PlanCode | null;
  subscription_status: SubscriptionStatus | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  grace_ends_at: Date | null;
  project_grants: string[];
};

function mapSubscriptionState(row: AuthenticatedSessionRecord): SubscriptionState | null {
  if (
    !row.plan_code ||
    !row.subscription_status ||
    !row.current_period_start ||
    !row.current_period_end
  ) {
    return null;
  }
  return {
    planCode: row.plan_code,
    status: row.subscription_status,
    currentPeriodStart: toDate(row.current_period_start),
    currentPeriodEnd: toDate(row.current_period_end),
    graceEndsAt: toDateOrNull(row.grace_ends_at),
  };
}

function mapUser(row: UserRecord | undefined): UserRow | null {
  if (!row) return null;
  return {
    id: row.id,
    authProvider: row.auth_provider,
    authProviderSubject: row.auth_provider_subject,
    emailNormalized: row.email_normalized,
    displayName: row.display_name,
    status: row.status,
    lastAuthenticatedAt: toDateOrNull(row.last_authenticated_at),
  };
}

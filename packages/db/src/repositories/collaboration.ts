import { sql } from 'drizzle-orm';
import type { CollaboratorParty, MembershipRole } from '@extrawork/contracts';
import { ORG_WIDE_ROLES, type TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull } from '../row-types.js';
import { runInScope, SYSTEM_SCOPE } from '../tenant-scope.js';
import { generateOpaqueToken } from './identity.js';

/**
 * Collaborators and project invitations (migration 0020). Slice A.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 *
 * A collaborator from another firm joins the designer's workspace with the
 * COLLABORATOR role and a grant on each shared project (D1), so everything
 * here is ordinary tenant-scoped SQL — except the two bootstrap lookups an
 * invitee needs before they are a member of anything, which say why.
 */

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface InvitationRow {
  id: string;
  organizationId: string;
  projectId: string;
  email: string;
  displayName: string | null;
  party: CollaboratorParty;
  companyName: string | null;
  phoneE164: string | null;
  message: string | null;
  /** PENDING past its expiry is reported as EXPIRED, whatever the column says. */
  status: InvitationStatus;
  invitedByUserId: string | null;
  invitedByName: string | null;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * What a token or an in-app id resolves to before the invitee belongs to the
 * workspace. Enough to render the preview and to check the acceptance rules;
 * nothing else about the project or the firm.
 */
export interface InvitationLookup {
  id: string;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectTitle: string;
  projectNumber: string;
  email: string;
  displayName: string | null;
  party: CollaboratorParty;
  companyName: string | null;
  status: InvitationStatus;
  invitedByUserId: string | null;
  invitedByName: string | null;
  acceptedByUserId: string | null;
  expiresAt: Date;
}

/** Everything the worker needs to email one invitation, and to know it is still current. */
export interface InvitationDeliveryRow {
  id: string;
  email: string;
  displayName: string | null;
  message: string | null;
  status: InvitationStatus;
  tokenSha256: Buffer;
  expiresAt: Date;
  invitedByName: string | null;
  organizationName: string;
  projectTitle: string;
}

/** Someone who can see a project, from the firm or from outside it. */
export interface ProjectPersonRow {
  userId: string;
  displayName: string;
  email: string;
  role: MembershipRole;
  /** Only for COLLABORATOR memberships; the firm's own staff have none. */
  party: CollaboratorParty | null;
  companyName: string | null;
  orgWide: boolean;
  /** When their grant was made, or when they joined the firm if they see everything. */
  joinedAt: Date;
}

/** A site-team member found by number, in any status — the roster's unique key. */
export interface SiteTeamMatch {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  allProjects: boolean;
  assignedToProject: boolean;
}

/**
 * The roles that see every project, as SQL. Built from the domain set rather
 * than retyped, so the authorization policy and this read model cannot drift.
 */
const ORG_WIDE_ROLE_LIST = sql.join(
  [...ORG_WIDE_ROLES].map((role) => sql`${role}::membership_role`),
  sql`, `,
);

export class CollaborationRepository {
  constructor(readonly db: Database) {}

  // --- Invitations -----------------------------------------------------------

  /**
   * Creates an invitation, or refreshes the live one for the same person on
   * the same project. The partial unique index allows one PENDING row per
   * (project, email), so a second invite is an upsert onto it: new token, new
   * expiry, the latest details. The old link stops working at once because
   * only the new hash is stored.
   *
   * The token is minted with the same opaque-token helper sessions use and
   * stored only as its SHA-256; the plaintext is returned once, to be put in
   * the link and the email, and never persisted.
   */
  async createOrRefresh(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      projectId: string;
      email: string;
      displayName: string | null;
      party: CollaboratorParty;
      companyName: string | null;
      phoneE164: string | null;
      message: string | null;
      invitedByUserId: string | null;
      expiresAt: Date;
    },
  ): Promise<{ invitation: InvitationRow; token: string; refreshed: boolean }> {
    const { token, hash } = generateOpaqueToken();
    const result = await tx.db.execute<{ id: string; refreshed: boolean }>(sql`
      INSERT INTO project_invitations
        (id, organization_id, project_id, email_normalized, display_name, party,
         company_name, phone_e164, message, token_sha256, invited_by_user_id, expires_at)
      VALUES (
        ${newId()}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid,
        ${input.email}, ${input.displayName}, ${input.party}, ${input.companyName},
        ${input.phoneE164}, ${input.message}, ${hash}, ${input.invitedByUserId}::uuid,
        ${input.expiresAt.toISOString()}::timestamptz
      )
      ON CONFLICT (project_id, email_normalized) WHERE status = 'PENDING'
      DO UPDATE SET
        token_sha256 = EXCLUDED.token_sha256,
        expires_at = EXCLUDED.expires_at,
        display_name = COALESCE(EXCLUDED.display_name, project_invitations.display_name),
        party = EXCLUDED.party,
        company_name = COALESCE(EXCLUDED.company_name, project_invitations.company_name),
        phone_e164 = COALESCE(EXCLUDED.phone_e164, project_invitations.phone_e164),
        message = EXCLUDED.message,
        invited_by_user_id = EXCLUDED.invited_by_user_id,
        updated_at = now()
      WHERE project_invitations.organization_id = EXCLUDED.organization_id
      RETURNING id, (xmax <> 0) AS refreshed
    `);
    const row = result.rows[0];
    if (!row) {
      // Only reachable if the conflicting PENDING row belonged to another
      // organization, which the tenant-bound project foreign key rules out.
      throw new Error('Invitation upsert returned no row');
    }
    const invitation = await this.findByIdIn(tx.db, ctx, row.id);
    if (!invitation) throw new Error('Invitation vanished inside its own transaction');
    return { invitation, token, refreshed: row.refreshed };
  }

  async findById(ctx: TenantContext, id: string): Promise<InvitationRow | null> {
    return this.findByIdIn(this.db, ctx, id);
  }

  private async findByIdIn(
    db: Database,
    ctx: TenantContext,
    id: string,
  ): Promise<InvitationRow | null> {
    const result = await db.execute<InvitationRecord>(sql`
      SELECT ${INVITATION_COLUMNS}
      FROM project_invitations i
      LEFT JOIN users inviter ON inviter.id = i.invited_by_user_id
      WHERE i.organization_id = ${ctx.organizationId}::uuid AND i.id = ${id}::uuid
    `);
    const row = result.rows[0];
    return row ? mapInvitation(row) : null;
  }

  /** A project's invitations, live ones first, then the most recent of the rest. */
  async listForProject(
    ctx: TenantContext,
    projectId: string,
    limit = 50,
  ): Promise<InvitationRow[]> {
    const result = await this.db.execute<InvitationRecord>(sql`
      SELECT ${INVITATION_COLUMNS}
      FROM project_invitations i
      LEFT JOIN users inviter ON inviter.id = i.invited_by_user_id
      WHERE i.organization_id = ${ctx.organizationId}::uuid
        AND i.project_id = ${projectId}::uuid
      ORDER BY (i.status = 'PENDING' AND i.expires_at > now()) DESC, i.created_at DESC, i.id
      LIMIT ${limit}
    `);
    return result.rows.map(mapInvitation);
  }

  /** True when a live invitation was revoked; false when there was none to revoke. */
  async revoke(tx: TransactionContext, ctx: TenantContext, id: string): Promise<boolean> {
    const result = await tx.db.execute(sql`
      UPDATE project_invitations
         SET status = 'REVOKED', revoked_at = now(), updated_at = now()
       WHERE organization_id = ${ctx.organizationId}::uuid
         AND id = ${id}::uuid
         AND status = 'PENDING'
    `);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Marks a live invitation accepted. Conditional on it still being PENDING and
   * unexpired, so two tabs accepting at once produce one acceptance and a
   * revocation that lands first wins.
   */
  async markAccepted(
    tx: TransactionContext,
    ctx: TenantContext,
    id: string,
    userId: string,
  ): Promise<boolean> {
    const result = await tx.db.execute(sql`
      UPDATE project_invitations
         SET status = 'ACCEPTED', accepted_at = now(), accepted_by_user_id = ${userId}::uuid,
             updated_at = now()
       WHERE organization_id = ${ctx.organizationId}::uuid
         AND id = ${id}::uuid
         AND status = 'PENDING'
         AND expires_at > now()
    `);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Resolves an invitation link's token hash to the invitation.
   *
   * System-scoped because the invitee is not a member of the host workspace
   * yet — the token is what *establishes* which workspace this is, exactly as
   * the approval token does in `ApprovalRepository.findByToken`. The hash is a
   * 256-bit secret only the link holder has; the query returns only what the
   * preview and the acceptance checks need, and the caller sets the tenant
   * scope from the result before writing anything.
   *
   * A PENDING row past its expiry is recorded as EXPIRED here, the first time
   * anyone looks at it, which also frees the slot in the partial unique index
   * so the designer can invite the person again.
   */
  async findByTokenHash(tokenHash: Buffer): Promise<InvitationLookup | null> {
    return runInScope(SYSTEM_SCOPE, async () => {
      await this.db.execute(sql`
        UPDATE project_invitations SET status = 'EXPIRED', updated_at = now()
        WHERE token_sha256 = ${tokenHash} AND status = 'PENDING' AND expires_at <= now()
      `);
      const result = await this.db.execute<InvitationLookupRecord>(sql`
        SELECT ${LOOKUP_COLUMNS}
        ${LOOKUP_FROM}
        WHERE i.token_sha256 = ${tokenHash}
          AND o.status = 'ACTIVE'
      `);
      const row = result.rows[0];
      return row ? mapLookup(row) : null;
    });
  }

  /**
   * Live invitations addressed to an email, across every workspace — what the
   * onboarding page and the in-app banner show a signed-in person.
   *
   * System-scoped for the same reason as `findByTokenHash`: the person may
   * belong to none of these workspaces yet. The key is the session user's own
   * verified address, never one from a request, so this can only ever list
   * invitations addressed to the caller.
   */
  async findPendingForEmail(email: string): Promise<InvitationLookup[]> {
    return runInScope(SYSTEM_SCOPE, async () => {
      await this.db.execute(sql`
        UPDATE project_invitations SET status = 'EXPIRED', updated_at = now()
        WHERE email_normalized = ${email} AND status = 'PENDING' AND expires_at <= now()
      `);
      const result = await this.db.execute<InvitationLookupRecord>(sql`
        SELECT ${LOOKUP_COLUMNS}
        ${LOOKUP_FROM}
        WHERE i.email_normalized = ${email}
          AND i.status = 'PENDING'
          AND o.status = 'ACTIVE'
        ORDER BY i.created_at DESC, i.id
        LIMIT 50
      `);
      return result.rows.map(mapLookup);
    });
  }

  /**
   * One invitation by id, only if it is addressed to `email`. The in-app accept
   * path: the session's address is the proof, so an id from another person's
   * invitation resolves to nothing rather than to a mismatch that confirms it
   * exists. System-scoped, as above.
   */
  async findByIdForEmail(id: string, email: string): Promise<InvitationLookup | null> {
    return runInScope(SYSTEM_SCOPE, async () => {
      await this.db.execute(sql`
        UPDATE project_invitations SET status = 'EXPIRED', updated_at = now()
        WHERE id = ${id}::uuid AND email_normalized = ${email}
          AND status = 'PENDING' AND expires_at <= now()
      `);
      const result = await this.db.execute<InvitationLookupRecord>(sql`
        SELECT ${LOOKUP_COLUMNS}
        ${LOOKUP_FROM}
        WHERE i.id = ${id}::uuid
          AND i.email_normalized = ${email}
          AND o.status = 'ACTIVE'
      `);
      const row = result.rows[0];
      return row ? mapLookup(row) : null;
    });
  }

  /** The worker's view of one invitation, including the current token hash. */
  async findForDelivery(
    db: Database,
    ctx: TenantContext,
    id: string,
  ): Promise<InvitationDeliveryRow | null> {
    const result = await db.execute<{
      id: string;
      email_normalized: string;
      display_name: string | null;
      message: string | null;
      status: InvitationStatus;
      token_sha256: Buffer;
      expires_at: Date | string;
      expired: boolean;
      invited_by_name: string | null;
      organization_name: string;
      project_title: string;
    }>(sql`
      SELECT i.id, i.email_normalized, i.display_name, i.message, i.status, i.token_sha256,
             i.expires_at, (i.expires_at <= now()) AS expired,
             inviter.display_name AS invited_by_name,
             o.display_name AS organization_name, p.title AS project_title
      FROM project_invitations i
      JOIN organizations o ON o.id = i.organization_id
      JOIN projects p ON p.organization_id = i.organization_id AND p.id = i.project_id
      LEFT JOIN users inviter ON inviter.id = i.invited_by_user_id
      WHERE i.organization_id = ${ctx.organizationId}::uuid AND i.id = ${id}::uuid
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email_normalized,
      displayName: row.display_name,
      message: row.message,
      status: row.status === 'PENDING' && row.expired ? 'EXPIRED' : row.status,
      tokenSha256: Buffer.isBuffer(row.token_sha256)
        ? row.token_sha256
        : Buffer.from(row.token_sha256),
      expiresAt: toDate(row.expires_at),
      invitedByName: row.invited_by_name,
      organizationName: row.organization_name,
      projectTitle: row.project_title,
    };
  }

  // --- People on a project ---------------------------------------------------

  /**
   * Every ACTIVE member who can see the project: the organization-wide roles,
   * who see it by role, and everyone holding a grant on it. The same rule
   * `hasProjectAccess` applies to a request, read from the same tables.
   */
  async projectPeople(
    ctx: TenantContext,
    projectId: string,
    db: Database = this.db,
  ): Promise<ProjectPersonRow[]> {
    const result = await db.execute<{
      user_id: string;
      display_name: string;
      email_normalized: string;
      role: MembershipRole;
      collaborator_party: CollaboratorParty | null;
      company_name: string | null;
      org_wide: boolean;
      joined_at: Date | string;
    }>(sql`
      SELECT m.user_id, u.display_name, u.email_normalized, m.role,
             m.collaborator_party, m.company_name,
             (m.role IN (${ORG_WIDE_ROLE_LIST})) AS org_wide,
             COALESCE(pm.created_at, m.created_at) AS joined_at
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN project_members pm
        ON pm.organization_id = m.organization_id
       AND pm.project_id = ${projectId}::uuid
       AND pm.user_id = m.user_id
      WHERE m.organization_id = ${ctx.organizationId}::uuid
        AND m.status = 'ACTIVE'
        AND (m.role IN (${ORG_WIDE_ROLE_LIST}) OR pm.user_id IS NOT NULL)
      ORDER BY
        CASE m.role
          WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'PROJECT_MANAGER' THEN 2
          WHEN 'FINANCE' THEN 3 WHEN 'VIEWER' THEN 4 ELSE 5
        END,
        u.display_name, m.user_id
    `);
    return result.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      email: r.email_normalized,
      role: r.role,
      party: r.role === 'COLLABORATOR' ? (r.collaborator_party ?? 'OTHER') : null,
      companyName: r.role === 'COLLABORATOR' ? r.company_name : null,
      orgWide: r.org_wide,
      joinedAt: toDate(r.joined_at),
    }));
  }

  /**
   * Whether the person with this address already sees the project, so an
   * invitation would grant nothing: an active org-wide member, or an active
   * member with a grant on it.
   */
  async emailHasProjectAccess(
    db: Database,
    ctx: TenantContext,
    projectId: string,
    email: string,
  ): Promise<boolean> {
    const result = await db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM users u
        JOIN memberships m
          ON m.user_id = u.id
         AND m.organization_id = ${ctx.organizationId}::uuid
         AND m.status = 'ACTIVE'
        WHERE u.email_normalized = ${email}
          AND (
            m.role IN (${ORG_WIDE_ROLE_LIST})
            OR EXISTS (
              SELECT 1 FROM project_members pm
              WHERE pm.organization_id = m.organization_id
                AND pm.project_id = ${projectId}::uuid
                AND pm.user_id = u.id
            )
          )
      ) AS found
    `);
    return result.rows[0]?.found ?? false;
  }

  async grantProject(
    tx: TransactionContext,
    ctx: TenantContext,
    projectId: string,
    userId: string,
  ): Promise<void> {
    // Through the tenant's own projects, so a foreign project id inserts
    // nothing: `project_members` has no tenant-bound foreign key of its own.
    await tx.db.execute(sql`
      INSERT INTO project_members (organization_id, project_id, user_id)
      SELECT ${ctx.organizationId}::uuid, p.id, ${userId}::uuid
      FROM projects p
      WHERE p.id = ${projectId}::uuid AND p.organization_id = ${ctx.organizationId}::uuid
      ON CONFLICT (project_id, user_id) DO NOTHING
    `);
  }

  /** True when a grant existed and was removed. */
  async revokeProject(
    tx: TransactionContext,
    ctx: TenantContext,
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await tx.db.execute(sql`
      DELETE FROM project_members
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND project_id = ${projectId}::uuid
        AND user_id = ${userId}::uuid
    `);
    return (result.rowCount ?? 0) > 0;
  }

  async countGrants(tx: TransactionContext, ctx: TenantContext, userId: string): Promise<number> {
    const result = await tx.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM project_members
      WHERE organization_id = ${ctx.organizationId}::uuid AND user_id = ${userId}::uuid
    `);
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }

  /**
   * Locks the member's row for the length of the transaction, so removing
   * their last project and revoking the membership is one decision even when
   * two designers act at once.
   */
  async lockMembership(
    tx: TransactionContext,
    ctx: TenantContext,
    userId: string,
  ): Promise<{ role: MembershipRole; status: string } | null> {
    const result = await tx.db.execute<{ role: MembershipRole; status: string }>(sql`
      SELECT role, status FROM memberships
      WHERE organization_id = ${ctx.organizationId}::uuid AND user_id = ${userId}::uuid
      FOR UPDATE
    `);
    return result.rows[0] ?? null;
  }

  /**
   * The projects each COLLABORATOR in the workspace has a grant on, for the
   * People & roles list. One query for the whole workspace rather than one per
   * person; staff are left out because their role, not a grant, is their reach.
   */
  async collaboratorProjects(
    ctx: TenantContext,
  ): Promise<Map<string, Array<{ id: string; title: string; projectNumber: string }>>> {
    const result = await this.db.execute<{
      user_id: string;
      id: string;
      title: string;
      project_number: string;
    }>(sql`
      SELECT pm.user_id, p.id, p.title, p.project_number
      FROM project_members pm
      JOIN memberships m
        ON m.organization_id = pm.organization_id AND m.user_id = pm.user_id
      JOIN projects p ON p.organization_id = pm.organization_id AND p.id = pm.project_id
      WHERE pm.organization_id = ${ctx.organizationId}::uuid
        AND m.role = 'COLLABORATOR'
      ORDER BY p.project_number, p.id
    `);
    const byUser = new Map<string, Array<{ id: string; title: string; projectNumber: string }>>();
    for (const row of result.rows) {
      const list = byUser.get(row.user_id) ?? [];
      list.push({ id: row.id, title: row.title, projectNumber: row.project_number });
      byUser.set(row.user_id, list);
    }
    return byUser;
  }

  // --- Site team (employees) touched by an invitation -------------------------

  /**
   * The site-team row for a number in this organization, in any status. The
   * roster's `UNIQUE (organization_id, phone_e164)` covers removed rows too, so
   * an invitation that carries a number must find and reuse that row rather
   * than insert a second one.
   */
  async findSiteTeamMemberByPhone(
    tx: TransactionContext,
    ctx: TenantContext,
    phoneE164: string,
    projectId: string,
  ): Promise<SiteTeamMatch | null> {
    const result = await tx.db.execute<{
      id: string;
      status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
      all_projects: boolean;
      assigned: boolean;
    }>(sql`
      SELECT e.id, e.status, e.all_projects,
             EXISTS (
               SELECT 1 FROM employee_project_assignments a
               WHERE a.organization_id = e.organization_id
                 AND a.employee_id = e.id
                 AND a.project_id = ${projectId}::uuid
             ) AS assigned
      FROM employees e
      WHERE e.organization_id = ${ctx.organizationId}::uuid AND e.phone_e164 = ${phoneE164}
      FOR UPDATE
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      allProjects: row.all_projects,
      assignedToProject: row.assigned,
    };
  }

  /** Adds one project to a site-team member's assignments, keeping the rest. */
  async assignSiteTeamProject(
    tx: TransactionContext,
    ctx: TenantContext,
    employeeId: string,
    projectId: string,
  ): Promise<void> {
    await tx.db.execute(sql`
      INSERT INTO employee_project_assignments (organization_id, employee_id, project_id)
      SELECT ${ctx.organizationId}::uuid, e.id, p.id
      FROM employees e
      JOIN projects p ON p.organization_id = e.organization_id AND p.id = ${projectId}::uuid
      WHERE e.id = ${employeeId}::uuid AND e.organization_id = ${ctx.organizationId}::uuid
      ON CONFLICT (employee_id, project_id) DO NOTHING
    `);
  }
}

const INVITATION_COLUMNS = sql`
  i.id, i.organization_id, i.project_id, i.email_normalized, i.display_name, i.party,
  i.company_name, i.phone_e164, i.message, i.status, i.invited_by_user_id,
  inviter.display_name AS invited_by_name, i.accepted_by_user_id, i.accepted_at,
  i.revoked_at, i.expires_at, i.created_at, (i.expires_at <= now()) AS expired
`;

type InvitationRecord = {
  id: string;
  organization_id: string;
  project_id: string;
  email_normalized: string;
  display_name: string | null;
  party: CollaboratorParty;
  company_name: string | null;
  phone_e164: string | null;
  message: string | null;
  status: InvitationStatus;
  invited_by_user_id: string | null;
  invited_by_name: string | null;
  accepted_by_user_id: string | null;
  accepted_at: Date | string | null;
  revoked_at: Date | string | null;
  expires_at: Date | string;
  created_at: Date | string;
  expired: boolean;
};

function mapInvitation(row: InvitationRecord): InvitationRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    email: row.email_normalized,
    displayName: row.display_name,
    party: row.party,
    companyName: row.company_name,
    phoneE164: row.phone_e164,
    message: row.message,
    status: effectiveStatus(row.status, row.expired),
    invitedByUserId: row.invited_by_user_id,
    invitedByName: row.invited_by_name,
    acceptedByUserId: row.accepted_by_user_id,
    acceptedAt: toDateOrNull(row.accepted_at),
    revokedAt: toDateOrNull(row.revoked_at),
    expiresAt: toDate(row.expires_at),
    createdAt: toDate(row.created_at),
  };
}

const LOOKUP_COLUMNS = sql`
  i.id, i.organization_id, o.display_name AS organization_name, i.project_id,
  p.title AS project_title, p.project_number, i.email_normalized, i.display_name,
  i.party, i.company_name, i.status, i.invited_by_user_id,
  inviter.display_name AS invited_by_name, i.accepted_by_user_id, i.expires_at,
  (i.expires_at <= now()) AS expired
`;

const LOOKUP_FROM = sql`
  FROM project_invitations i
  JOIN organizations o ON o.id = i.organization_id
  JOIN projects p ON p.organization_id = i.organization_id AND p.id = i.project_id
  LEFT JOIN users inviter ON inviter.id = i.invited_by_user_id
`;

type InvitationLookupRecord = {
  id: string;
  organization_id: string;
  organization_name: string;
  project_id: string;
  project_title: string;
  project_number: string;
  email_normalized: string;
  display_name: string | null;
  party: CollaboratorParty;
  company_name: string | null;
  status: InvitationStatus;
  invited_by_user_id: string | null;
  invited_by_name: string | null;
  accepted_by_user_id: string | null;
  expires_at: Date | string;
  expired: boolean;
};

function mapLookup(row: InvitationLookupRecord): InvitationLookup {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    projectId: row.project_id,
    projectTitle: row.project_title,
    projectNumber: row.project_number,
    email: row.email_normalized,
    displayName: row.display_name,
    party: row.party,
    companyName: row.company_name,
    status: effectiveStatus(row.status, row.expired),
    invitedByUserId: row.invited_by_user_id,
    invitedByName: row.invited_by_name,
    acceptedByUserId: row.accepted_by_user_id,
    expiresAt: toDate(row.expires_at),
  };
}

/** A live row past its expiry is expired, whether or not anyone has marked it yet. */
function effectiveStatus(status: InvitationStatus, expired: boolean): InvitationStatus {
  return status === 'PENDING' && expired ? 'EXPIRED' : status;
}

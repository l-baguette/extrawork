import { sql } from 'drizzle-orm';
import {
  AppError,
  type BusinessType,
  type CollaboratorParty,
  type MembershipRole,
  type RequestRouting,
} from '@extrawork/contracts';
import {
  entitlementsFor,
  isReadOnly,
  type Entitlements,
  type PlanCode,
  type SubscriptionState,
  type SubscriptionStatus,
  type TenantContext,
  type UsageCounters,
} from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull } from '../row-types.js';

/**
 * Organizations, memberships and subscription state.
 *
 * Every method takes a `TenantContext` and scopes on `organization_id`
 * (report §3.2, §14.4) — including the reads, so a mis-passed id returns
 * nothing rather than another tenant's row.
 */

export interface OrganizationRow {
  id: string;
  displayName: string;
  legalName: string | null;
  gstin: string | null;
  timezone: string;
  defaultCurrency: string;
  retentionMonths: number;
  status: string;
  /** Set only while `status` is CLOSED; see migration 0016. */
  closedAt: Date | null;
  /** The moment after which a closed account may be purged. */
  purgeAfter: Date | null;
  closureReason: string | null;
  brandPrimaryColor: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  reminderPolicyHours: number[];
  businessType: BusinessType | null;
  requestRouting: RequestRouting;
  storageQuotaBytes: bigint;
  createdAt: Date;
  lockVersion: number;
}

export interface SubscriptionRow extends SubscriptionState {
  id: string;
  organizationId: string;
  provider: string | null;
  providerSubscriptionId: string | null;
}

export class OrganizationRepository {
  constructor(private readonly db: Database) {}

  async create(
    tx: TransactionContext,
    input: {
      displayName: string;
      legalName: string | null;
      gstin: string | null;
      timezone: string;
      defaultCurrency: string;
      businessType?: BusinessType | null;
    },
  ): Promise<OrganizationRow> {
    const id = newId();
    const result = await tx.db.execute<OrganizationRecord>(sql`
      INSERT INTO organizations
        (id, display_name, legal_name, gstin, timezone, default_currency, reminder_policy_hours,
         business_type)
      VALUES (
        ${id}::uuid, ${input.displayName}, ${input.legalName}, ${input.gstin},
        ${input.timezone}, ${input.defaultCurrency}, ARRAY[24, 72], ${input.businessType ?? null}
      )
      RETURNING ${ORG_COLUMNS}
    `);
    return mapOrganization(requireRow(result.rows[0], 'organization'));
  }

  async findById(ctx: TenantContext): Promise<OrganizationRow | null> {
    return this.findByIdIn(this.db, ctx);
  }

  private async findByIdIn(db: Database, ctx: TenantContext): Promise<OrganizationRow | null> {
    const result = await db.execute<OrganizationRecord>(sql`
      SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapOrganization(row) : null;
  }

  async lockById(tx: TransactionContext, ctx: TenantContext): Promise<OrganizationRow> {
    const locked = await tx.db.execute<{ id: string }>(sql`
      SELECT id FROM organizations WHERE id = ${ctx.organizationId}::uuid
      FOR UPDATE
    `);
    if (!locked.rows[0]) throw new AppError('ORGANIZATION_REQUIRED');
    const row = await this.findByIdIn(tx.db, ctx);
    if (!row) throw new AppError('ORGANIZATION_REQUIRED');
    return row;
  }

  async update(
    tx: TransactionContext,
    ctx: TenantContext,
    patch: Partial<{
      displayName: string;
      legalName: string | null;
      gstin: string | null;
      timezone: string;
      retentionMonths: number;
      brandPrimaryColor: string | null;
      contactPhone: string | null;
      contactEmail: string | null;
      reminderPolicyHours: number[];
      businessType: BusinessType | null;
      requestRouting: RequestRouting;
    }>,
  ): Promise<OrganizationRow> {
    const result = await tx.db.execute<OrganizationRecord>(sql`
      UPDATE organizations SET
        display_name = COALESCE(${patch.displayName ?? null}, display_name),
        legal_name = ${patch.legalName === undefined ? sql`legal_name` : patch.legalName},
        gstin = ${patch.gstin === undefined ? sql`gstin` : patch.gstin},
        timezone = COALESCE(${patch.timezone ?? null}, timezone),
        retention_months = COALESCE(${patch.retentionMonths ?? null}, retention_months),
        brand_primary_color = ${
          patch.brandPrimaryColor === undefined ? sql`brand_primary_color` : patch.brandPrimaryColor
        },
        contact_phone = ${patch.contactPhone === undefined ? sql`contact_phone` : patch.contactPhone},
        contact_email = ${patch.contactEmail === undefined ? sql`contact_email` : patch.contactEmail},
        reminder_policy_hours = COALESCE(
          ${patch.reminderPolicyHours ? sql`${`{${patch.reminderPolicyHours.join(',')}}`}::integer[]` : null},
          reminder_policy_hours
        ),
        business_type = ${patch.businessType === undefined ? sql`business_type` : patch.businessType},
        request_routing = COALESCE(${patch.requestRouting ?? null}, request_routing),
        lock_version = lock_version + 1
      WHERE id = ${ctx.organizationId}::uuid
      RETURNING ${ORG_COLUMNS}
    `);
    return mapOrganization(requireRow(result.rows[0], 'organization'));
  }

  // --- Closure -------------------------------------------------------------

  /**
   * Marks the account closed and arms the purge.
   *
   * Guarded on the current status inside the UPDATE rather than checked first
   * and written after: two owners clicking Close at the same moment would
   * otherwise both pass the check and the second would silently push the purge
   * date 30 days further out.
   */
  async close(
    tx: TransactionContext,
    ctx: TenantContext,
    input: { closedAt: Date; purgeAfter: Date; reason: string | null },
  ): Promise<OrganizationRow | null> {
    const result = await tx.db.execute<OrganizationRecord>(sql`
      UPDATE organizations SET
        status = 'CLOSED',
        closed_at = ${input.closedAt.toISOString()}::timestamptz,
        purge_after = ${input.purgeAfter.toISOString()}::timestamptz,
        closure_reason = ${input.reason},
        lock_version = lock_version + 1
      WHERE id = ${ctx.organizationId}::uuid AND status <> 'CLOSED'
      RETURNING ${ORG_COLUMNS}
    `);
    const row = result.rows[0];
    return row ? mapOrganization(row) : null;
  }

  /** Cancels a pending closure. Only meaningful before the purge has run. */
  async reopen(tx: TransactionContext, ctx: TenantContext): Promise<OrganizationRow | null> {
    const result = await tx.db.execute<OrganizationRecord>(sql`
      UPDATE organizations SET
        status = 'ACTIVE',
        closed_at = NULL,
        purge_after = NULL,
        closure_reason = NULL,
        lock_version = lock_version + 1
      WHERE id = ${ctx.organizationId}::uuid AND status = 'CLOSED'
      RETURNING ${ORG_COLUMNS}
    `);
    const row = result.rows[0];
    return row ? mapOrganization(row) : null;
  }

  /**
   * Closed accounts whose recovery window has elapsed and that no legal hold
   * covers. Not tenant-scoped: the retention job sweeps every tenant, which is
   * why it takes no `TenantContext` and returns ids for the caller to act on
   * one at a time.
   */
  async findPurgeable(now: Date, limit: number): Promise<Array<{ id: string; closedAt: Date }>> {
    const result = await this.db.execute<{ id: string; closed_at: Date }>(sql`
      SELECT o.id, o.closed_at
      FROM organizations o
      WHERE o.status = 'CLOSED'
        AND o.purge_after <= ${now.toISOString()}::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM legal_holds h
          WHERE h.organization_id = o.id AND h.released_at IS NULL
        )
      ORDER BY o.purge_after
      LIMIT ${limit}
    `);
    return result.rows.map((row) => ({ id: row.id, closedAt: toDate(row.closed_at) }));
  }

  // --- Memberships ---------------------------------------------------------

  async addMembership(
    tx: TransactionContext,
    input: {
      organizationId: string;
      userId: string;
      role: MembershipRole;
      status?: 'ACTIVE' | 'INVITED';
      invitedByUserId?: string | null;
      collaboratorParty?: CollaboratorParty | null;
      companyName?: string | null;
    },
  ): Promise<void> {
    await tx.db.execute(sql`
      INSERT INTO memberships
        (organization_id, user_id, role, status, invited_by_user_id, collaborator_party, company_name)
      VALUES (
        ${input.organizationId}::uuid, ${input.userId}::uuid, ${input.role}::membership_role,
        ${input.status ?? 'ACTIVE'}, ${input.invitedByUserId ?? null}::uuid,
        ${input.collaboratorParty ?? null}, ${input.companyName ?? null}
      )
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status,
                    collaborator_party = EXCLUDED.collaborator_party,
                    company_name = EXCLUDED.company_name, updated_at = now()
    `);
  }

  /**
   * Grants a collaborator access through an invitation without ever demoting
   * an existing member: someone already on the firm's staff who is invited to
   * a project keeps their role and simply gains the project grant.
   */
  async ensureCollaboratorMembership(
    tx: TransactionContext,
    input: {
      organizationId: string;
      userId: string;
      invitedByUserId: string | null;
      collaboratorParty: CollaboratorParty;
      companyName: string | null;
    },
  ): Promise<{ role: MembershipRole; created: boolean }> {
    const existing = await tx.db.execute<{ role: MembershipRole; status: string }>(sql`
      SELECT role, status FROM memberships
      WHERE organization_id = ${input.organizationId}::uuid AND user_id = ${input.userId}::uuid
      FOR UPDATE
    `);
    const row = existing.rows[0];
    if (row && row.status === 'ACTIVE') return { role: row.role, created: false };
    // Anyone not currently active — never a member, removed, or a staff
    // invitation never taken up — joins as a collaborator. Reviving a revoked
    // or unaccepted staff role here would let a project invitation, which a
    // designer may send, restore an admin the owner removed.
    await this.addMembership(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      role: 'COLLABORATOR',
      status: 'ACTIVE',
      invitedByUserId: input.invitedByUserId,
      collaboratorParty: input.collaboratorParty,
      companyName: input.companyName,
    });
    return { role: 'COLLABORATOR', created: true };
  }

  async listMembers(ctx: TenantContext): Promise<
    Array<{
      userId: string;
      organizationId: string;
      displayName: string;
      email: string;
      role: MembershipRole;
      status: string;
      collaboratorParty: CollaboratorParty | null;
      companyName: string | null;
      createdAt: Date;
    }>
  > {
    const result = await this.db.execute<{
      user_id: string;
      organization_id: string;
      display_name: string;
      email_normalized: string;
      role: MembershipRole;
      status: string;
      collaborator_party: CollaboratorParty | null;
      company_name: string | null;
      created_at: Date;
    }>(sql`
      SELECT m.user_id, m.organization_id, u.display_name, u.email_normalized,
             m.role, m.status, m.collaborator_party, m.company_name, m.created_at
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${ctx.organizationId}::uuid
      ORDER BY m.created_at
    `);
    return result.rows.map((r) => ({
      userId: r.user_id,
      organizationId: r.organization_id,
      displayName: r.display_name,
      email: r.email_normalized,
      role: r.role,
      status: r.status,
      collaboratorParty: r.collaborator_party,
      companyName: r.company_name,
      createdAt: toDate(r.created_at),
    }));
  }

  async updateMemberRole(
    tx: TransactionContext,
    ctx: TenantContext,
    userId: string,
    role: MembershipRole,
  ): Promise<void> {
    const result = await tx.db.execute(sql`
      UPDATE memberships SET role = ${role}::membership_role, updated_at = now()
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND user_id = ${userId}::uuid
        AND role <> 'OWNER'
    `);
    if ((result.rowCount ?? 0) === 0) {
      throw new AppError('NOT_FOUND', {
        message: 'That member could not be updated. The owner role is transferred separately.',
      });
    }
  }

  async revokeMember(tx: TransactionContext, ctx: TenantContext, userId: string): Promise<void> {
    const result = await tx.db.execute(sql`
      UPDATE memberships SET status = 'REVOKED', updated_at = now()
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND user_id = ${userId}::uuid
        AND role <> 'OWNER'
    `);
    if ((result.rowCount ?? 0) === 0) {
      throw new AppError('NOT_FOUND', { message: 'That member could not be removed.' });
    }
  }

  async countActiveMembers(ctx: TenantContext): Promise<number> {
    const result = await this.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM memberships
      WHERE organization_id = ${ctx.organizationId}::uuid AND status IN ('ACTIVE','INVITED')
    `);
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }

  // --- Subscription and entitlements ---------------------------------------

  /**
   * The subscription a new workspace starts with. BETA (spec D13) is active
   * with a period long enough that no renewal logic ever engages; TRIAL keeps
   * the original fourteen-day evaluation for anyone who switches it back on.
   */
  async createInitialSubscription(
    tx: TransactionContext,
    organizationId: string,
    planCode: PlanCode,
  ): Promise<void> {
    if (planCode !== 'BETA') {
      await this.createTrialSubscription(tx, organizationId);
      return;
    }
    const now = new Date();
    const end = new Date(now.getTime() + 10 * 365 * 86_400_000);
    await tx.db.execute(sql`
      INSERT INTO subscriptions
        (id, organization_id, plan_code, status, current_period_start, current_period_end)
      VALUES (
        ${newId()}::uuid, ${organizationId}::uuid, 'BETA', 'ACTIVE',
        ${now.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz
      )
      ON CONFLICT (organization_id) DO NOTHING
    `);
  }

  /** Bytes stored by the workspace, excluding files the scanner refused. */
  async storageUsedBytes(ctx: TenantContext, db: Database = this.db): Promise<bigint> {
    const result = await db.execute<{ used: string | null }>(sql`
      SELECT COALESCE(SUM(byte_size), 0)::text AS used
      FROM file_objects
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND scan_status <> 'REJECTED'
    `);
    return BigInt(result.rows[0]?.used ?? '0');
  }

  async createTrialSubscription(
    tx: TransactionContext,
    organizationId: string,
    trialDays = 14,
  ): Promise<void> {
    const now = new Date();
    const end = new Date(now.getTime() + trialDays * 86_400_000);
    await tx.db.execute(sql`
      INSERT INTO subscriptions
        (id, organization_id, plan_code, status, current_period_start, current_period_end)
      VALUES (
        ${newId()}::uuid, ${organizationId}::uuid, 'TRIAL', 'TRIALING',
        ${now.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz
      )
      ON CONFLICT (organization_id) DO NOTHING
    `);
  }

  async getSubscription(
    ctx: TenantContext,
    db: Database = this.db,
  ): Promise<SubscriptionRow | null> {
    const result = await db.execute<{
      id: string;
      organization_id: string;
      plan_code: PlanCode;
      status: SubscriptionStatus;
      current_period_start: Date;
      current_period_end: Date;
      grace_ends_at: Date | null;
      provider: string | null;
      provider_subscription_id: string | null;
    }>(sql`
      SELECT id, organization_id, plan_code, status, current_period_start,
             current_period_end, grace_ends_at, provider, provider_subscription_id
      FROM subscriptions WHERE organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      planCode: row.plan_code,
      status: row.status,
      currentPeriodStart: toDate(row.current_period_start),
      currentPeriodEnd: toDate(row.current_period_end),
      graceEndsAt: toDateOrNull(row.grace_ends_at),
      provider: row.provider,
      providerSubscriptionId: row.provider_subscription_id,
    };
  }

  async setSubscription(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      planCode: PlanCode;
      status: SubscriptionStatus;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      graceEndsAt: Date | null;
      provider?: string | null;
      providerSubscriptionId?: string | null;
    },
  ): Promise<void> {
    await tx.db.execute(sql`
      INSERT INTO subscriptions
        (id, organization_id, plan_code, status, current_period_start,
         current_period_end, grace_ends_at, provider, provider_subscription_id)
      VALUES (
        ${newId()}::uuid, ${ctx.organizationId}::uuid, ${input.planCode}, ${input.status},
        ${input.currentPeriodStart.toISOString()}::timestamptz,
        ${input.currentPeriodEnd.toISOString()}::timestamptz,
        ${input.graceEndsAt?.toISOString() ?? null}::timestamptz,
        ${input.provider ?? null}, ${input.providerSubscriptionId ?? null}
      )
      ON CONFLICT (organization_id) DO UPDATE SET
        plan_code = EXCLUDED.plan_code,
        status = EXCLUDED.status,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        grace_ends_at = EXCLUDED.grace_ends_at,
        provider = EXCLUDED.provider,
        provider_subscription_id = EXCLUDED.provider_subscription_id,
        updated_at = now()
    `);
  }

  /** Every active tenant, for the whole-estate integrity sweep (report §13.3). */
  async listAllIds(): Promise<string[]> {
    const result = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM organizations WHERE status <> 'CLOSED' ORDER BY created_at
    `);
    return result.rows.map((r) => r.id);
  }

  async getUsage(
    ctx: TenantContext,
    periodStart: Date,
    db: Database = this.db,
  ): Promise<UsageCounters> {
    const result = await db.execute<{
      active_projects: string;
      team_members: string;
      completed_decisions: string;
    }>(sql`
      SELECT
        (SELECT count(*) FROM projects
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND status IN ('ACTIVE','ON_HOLD'))::text AS active_projects,
        (SELECT count(*) FROM memberships
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND status IN ('ACTIVE','INVITED'))::text AS team_members,
        (SELECT COALESCE(completed_decisions, 0) FROM entitlement_counters
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND period_start = ${periodStart.toISOString()}::timestamptz)::text
          AS completed_decisions
    `);
    const row = result.rows[0];
    return {
      activeProjects: Number.parseInt(row?.active_projects ?? '0', 10),
      teamMembers: Number.parseInt(row?.team_members ?? '0', 10),
      completedDecisionsThisPeriod: Number.parseInt(row?.completed_decisions ?? '0', 10),
    };
  }

  async incrementUsage(
    tx: TransactionContext,
    ctx: TenantContext,
    periodStart: Date,
    field: 'completed_decisions' | 'sends',
  ): Promise<void> {
    const column = field === 'sends' ? sql`sends` : sql`completed_decisions`;
    await tx.db.execute(sql`
      INSERT INTO entitlement_counters (organization_id, period_start, ${column})
      VALUES (${ctx.organizationId}::uuid, ${periodStart.toISOString()}::timestamptz, 1)
      ON CONFLICT (organization_id, period_start)
      DO UPDATE SET ${column} = entitlement_counters.${column} + 1, updated_at = now()
    `);
  }

  /** One call resolving the entitlement picture used by the API middleware. */
  async resolveEntitlements(
    ctx: TenantContext,
    db: Database = this.db,
  ): Promise<{
    subscription: SubscriptionRow;
    entitlements: Entitlements;
    usage: UsageCounters;
    readOnly: boolean;
  }> {
    const subscription = await this.getSubscription(ctx, db);
    if (!subscription) {
      throw new AppError('INTERNAL_ERROR', {
        message: 'Organization has no subscription record',
      });
    }
    const usage = await this.getUsage(ctx, subscription.currentPeriodStart, db);
    return {
      subscription,
      entitlements: entitlementsFor(subscription),
      usage,
      readOnly: isReadOnly(subscription),
    };
  }
}

const ORG_COLUMNS = sql`
  id, display_name, legal_name, gstin, timezone, default_currency, retention_months,
  status, closed_at, purge_after, closure_reason,
  brand_primary_color, contact_phone, contact_email, reminder_policy_hours,
  business_type, request_routing, storage_quota_bytes,
  created_at, lock_version
`;

type OrganizationRecord = {
  id: string;
  display_name: string;
  legal_name: string | null;
  gstin: string | null;
  timezone: string;
  default_currency: string;
  retention_months: number;
  status: string;
  closed_at: Date | null;
  purge_after: Date | null;
  closure_reason: string | null;
  brand_primary_color: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  reminder_policy_hours: number[] | string;
  business_type: BusinessType | null;
  request_routing: RequestRouting;
  storage_quota_bytes: string | number;
  created_at: Date;
  lock_version: number;
};

function mapOrganization(row: OrganizationRecord): OrganizationRow {
  return {
    id: row.id,
    displayName: row.display_name,
    legalName: row.legal_name,
    gstin: row.gstin,
    timezone: row.timezone,
    defaultCurrency: row.default_currency.trim(),
    retentionMonths: row.retention_months,
    status: row.status,
    brandPrimaryColor: row.brand_primary_color,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    reminderPolicyHours: Array.isArray(row.reminder_policy_hours)
      ? row.reminder_policy_hours
      : String(row.reminder_policy_hours)
          .replace(/^{|}$/g, '')
          .split(',')
          .filter(Boolean)
          .map((v) => Number.parseInt(v, 10)),
    closedAt: row.closed_at ? toDate(row.closed_at) : null,
    purgeAfter: row.purge_after ? toDate(row.purge_after) : null,
    closureReason: row.closure_reason,
    businessType: row.business_type,
    requestRouting: row.request_routing,
    storageQuotaBytes: BigInt(row.storage_quota_bytes),
    createdAt: toDate(row.created_at),
    lockVersion: row.lock_version,
  };
}

export function requireRow<T>(row: T | undefined, what: string): T {
  if (!row) {
    throw new AppError('INTERNAL_ERROR', { message: `Expected a ${what} row but got none` });
  }
  return row;
}

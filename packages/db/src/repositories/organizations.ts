import { sql } from 'drizzle-orm';
import { AppError, type MembershipRole } from '@extrawork/contracts';
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
  brandPrimaryColor: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  reminderPolicyHours: number[];
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
    },
  ): Promise<OrganizationRow> {
    const id = newId();
    const result = await tx.db.execute<OrganizationRecord>(sql`
      INSERT INTO organizations
        (id, display_name, legal_name, gstin, timezone, default_currency, reminder_policy_hours)
      VALUES (
        ${id}::uuid, ${input.displayName}, ${input.legalName}, ${input.gstin},
        ${input.timezone}, ${input.defaultCurrency}, ARRAY[24, 72]
      )
      RETURNING ${ORG_COLUMNS}
    `);
    return mapOrganization(requireRow(result.rows[0], 'organization'));
  }

  async findById(ctx: TenantContext): Promise<OrganizationRow | null> {
    const result = await this.db.execute<OrganizationRecord>(sql`
      SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapOrganization(row) : null;
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
        lock_version = lock_version + 1
      WHERE id = ${ctx.organizationId}::uuid
      RETURNING ${ORG_COLUMNS}
    `);
    return mapOrganization(requireRow(result.rows[0], 'organization'));
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
    },
  ): Promise<void> {
    await tx.db.execute(sql`
      INSERT INTO memberships (organization_id, user_id, role, status, invited_by_user_id)
      VALUES (
        ${input.organizationId}::uuid, ${input.userId}::uuid, ${input.role}::membership_role,
        ${input.status ?? 'ACTIVE'}, ${input.invitedByUserId ?? null}::uuid
      )
      ON CONFLICT (organization_id, user_id)
      DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status, updated_at = now()
    `);
  }

  async listMembers(ctx: TenantContext): Promise<
    Array<{
      userId: string;
      organizationId: string;
      displayName: string;
      email: string;
      role: MembershipRole;
      status: string;
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
      created_at: Date;
    }>(sql`
      SELECT m.user_id, m.organization_id, u.display_name, u.email_normalized,
             m.role, m.status, m.created_at
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

  async getSubscription(ctx: TenantContext): Promise<SubscriptionRow | null> {
    const result = await this.db.execute<{
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

  async getUsage(ctx: TenantContext, periodStart: Date): Promise<UsageCounters> {
    const result = await this.db.execute<{
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
  async resolveEntitlements(ctx: TenantContext): Promise<{
    subscription: SubscriptionRow;
    entitlements: Entitlements;
    usage: UsageCounters;
    readOnly: boolean;
  }> {
    const subscription = await this.getSubscription(ctx);
    if (!subscription) {
      throw new AppError('INTERNAL_ERROR', {
        message: 'Organization has no subscription record',
      });
    }
    const usage = await this.getUsage(ctx, subscription.currentPeriodStart);
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
  status, brand_primary_color, contact_phone, contact_email, reminder_policy_hours,
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
  brand_primary_color: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  reminder_policy_hours: number[] | string;
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

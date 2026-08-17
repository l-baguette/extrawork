import { sql } from 'drizzle-orm';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull } from '../row-types.js';

/**
 * Read models for dashboards, search and reports.
 *
 * Report §6.6: "The dashboard should query pre-aggregated projections rather
 * than scanning audit events." These queries read the domain tables and the
 * `projects.approved_delta_minor` projection — never `audit_events`.
 */

export interface DashboardData {
  currency: string;
  pendingDecisions: number;
  overdueOrExpiring: number;
  approvedValueThisMonthMinor: bigint;
  averageHoursToDecision: number | null;
  projectsWithUnbilledApprovedExtras: number;
}

export class ReportingRepository {
  constructor(private readonly db: Database) {}

  async dashboard(ctx: TenantContext, timezone: string): Promise<DashboardData> {
    const result = await this.db.execute<{
      currency: string | null;
      pending_decisions: string;
      overdue_or_expiring: string;
      approved_value_month: string;
      average_hours: string | null;
      projects_unbilled: string;
    }>(sql`
      SELECT
        (SELECT default_currency FROM organizations WHERE id = ${ctx.organizationId}::uuid) AS currency,
        (SELECT count(*) FROM change_order_versions
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND status IN ('SENT','VIEWED'))::text AS pending_decisions,
        (SELECT count(*) FROM change_order_versions
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND status IN ('SENT','VIEWED')
            AND expires_at < now() + interval '48 hours')::text AS overdue_or_expiring,
        (SELECT COALESCE(sum(total_delta_minor), 0) FROM change_order_versions
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND status = 'APPROVED'
            AND decided_at >= date_trunc('month', now() AT TIME ZONE ${timezone})
                              AT TIME ZONE ${timezone})::text AS approved_value_month,
        (SELECT AVG(EXTRACT(EPOCH FROM (decided_at - sent_at)) / 3600.0)::text
           FROM change_order_versions
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND decided_at IS NOT NULL AND sent_at IS NOT NULL) AS average_hours,
        (SELECT count(DISTINCT project_id) FROM change_order_versions
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND status = 'APPROVED')::text AS projects_unbilled
    `);

    const row = result.rows[0];
    return {
      currency: (row?.currency ?? 'INR').trim(),
      pendingDecisions: Number.parseInt(row?.pending_decisions ?? '0', 10),
      overdueOrExpiring: Number.parseInt(row?.overdue_or_expiring ?? '0', 10),
      approvedValueThisMonthMinor: BigInt(row?.approved_value_month ?? '0'),
      averageHoursToDecision: row?.average_hours ? Number.parseFloat(row.average_hours) : null,
      projectsWithUnbilledApprovedExtras: Number.parseInt(row?.projects_unbilled ?? '0', 10),
    };
  }

  /**
   * Tenant-scoped search across customers, projects and changes (report §6.6).
   * Snippets are drawn from titles and names only — never from scope text,
   * which is treated as confidential business content.
   */
  async search(
    ctx: TenantContext,
    query: string,
    limit: number,
  ): Promise<{
    customers: Array<{ id: string; displayName: string; snippet: string | null }>;
    projects: Array<{ id: string; projectNumber: string; title: string; customerName: string }>;
    changes: Array<{
      id: string;
      number: string;
      title: string;
      projectId: string;
      projectTitle: string;
      status: string;
    }>;
  }> {
    const like = `%${query}%`;

    const customers = await this.db.execute<{ id: string; display_name: string }>(sql`
      SELECT id, display_name FROM customers
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND merged_into_customer_id IS NULL
        AND (search_document @@ plainto_tsquery('simple', extrawork_unaccent(lower(${query})))
             OR display_name ILIKE ${like})
      ORDER BY similarity(display_name, ${query}) DESC
      LIMIT ${limit}
    `);

    const projects = await this.db.execute<{
      id: string;
      project_number: string;
      title: string;
      customer_name: string;
    }>(sql`
      SELECT p.id, p.project_number, p.title, c.display_name AS customer_name
      FROM projects p
      JOIN customers c ON c.id = p.customer_id
      WHERE p.organization_id = ${ctx.organizationId}::uuid
        AND (p.search_document @@ plainto_tsquery('simple', extrawork_unaccent(lower(${query})))
             OR p.title ILIKE ${like} OR p.project_number ILIKE ${like})
      ORDER BY p.updated_at DESC
      LIMIT ${limit}
    `);

    const changes = await this.db.execute<{
      id: string;
      number: string;
      title: string;
      project_id: string;
      project_title: string;
      status: string;
    }>(sql`
      SELECT co.id, co.number, v.title, co.project_id, p.title AS project_title, v.status::text
      FROM change_orders co
      JOIN change_order_versions v ON v.id = co.current_version_id
      JOIN projects p ON p.id = co.project_id
      WHERE co.organization_id = ${ctx.organizationId}::uuid
        AND (co.search_document @@ plainto_tsquery('simple', extrawork_unaccent(lower(${query})))
             OR v.title ILIKE ${like} OR co.number ILIKE ${like})
      ORDER BY v.updated_at DESC
      LIMIT ${limit}
    `);

    return {
      customers: customers.rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        snippet: null,
      })),
      projects: projects.rows.map((r) => ({
        id: r.id,
        projectNumber: r.project_number,
        title: r.title,
        customerName: r.customer_name,
      })),
      changes: changes.rows.map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title,
        projectId: r.project_id,
        projectTitle: r.project_title,
        status: r.status,
      })),
    };
  }

  /** Documented extra-work summary (report §6.2 `/app/reports`). */
  async extraWorkReport(
    ctx: TenantContext,
    filters: {
      from?: string;
      to?: string;
      projectId?: string;
      customerId?: string;
      createdByUserId?: string;
      status: 'APPROVED' | 'DECLINED' | 'PENDING' | 'ALL';
    },
  ): Promise<ReportRow[]> {
    const statusFilter = (() => {
      switch (filters.status) {
        case 'APPROVED':
          return sql`AND v.status = 'APPROVED'`;
        case 'DECLINED':
          return sql`AND v.status = 'DECLINED'`;
        case 'PENDING':
          return sql`AND v.status IN ('SENT','VIEWED')`;
        default:
          return sql`AND v.status <> 'DRAFT'`;
      }
    })();

    const result = await this.db.execute<ReportRecord>(sql`
      SELECT co.id AS change_order_id, co.number, v.version_number, p.id AS project_id,
             p.project_number, p.title AS project_title, cu.display_name AS customer_name,
             v.title, v.status::text, v.currency,
             v.subtotal_delta_minor, v.tax_delta_minor, v.total_delta_minor,
             v.schedule_delta_days, v.sent_at, v.decided_at,
             d.type::text AS decision_type, d.assurance_achieved::text,
             u.display_name AS created_by
      FROM change_orders co
      JOIN change_order_versions v ON v.id = co.current_version_id
      JOIN projects p ON p.id = co.project_id
      JOIN customers cu ON cu.id = p.customer_id
      JOIN users u ON u.id = co.created_by_user_id
      LEFT JOIN decisions d ON d.version_id = v.id
      WHERE co.organization_id = ${ctx.organizationId}::uuid
        ${statusFilter}
        ${filters.projectId ? sql`AND co.project_id = ${filters.projectId}::uuid` : sql``}
        ${filters.customerId ? sql`AND p.customer_id = ${filters.customerId}::uuid` : sql``}
        ${filters.createdByUserId ? sql`AND co.created_by_user_id = ${filters.createdByUserId}::uuid` : sql``}
        ${filters.from ? sql`AND v.sent_at >= ${filters.from}::date` : sql``}
        ${filters.to ? sql`AND v.sent_at < (${filters.to}::date + interval '1 day')` : sql``}
      ORDER BY v.sent_at DESC NULLS LAST
      LIMIT 5000
    `);

    return result.rows.map((r) => ({
      changeOrderId: r.change_order_id,
      number: r.number,
      versionNumber: r.version_number,
      projectId: r.project_id,
      projectNumber: r.project_number,
      projectTitle: r.project_title,
      customerName: r.customer_name,
      title: r.title,
      status: r.status,
      currency: r.currency.trim(),
      subtotalDeltaMinor: BigInt(r.subtotal_delta_minor),
      taxDeltaMinor: BigInt(r.tax_delta_minor),
      totalDeltaMinor: BigInt(r.total_delta_minor),
      scheduleDeltaDays: r.schedule_delta_days,
      sentAt: toDateOrNull(r.sent_at),
      decidedAt: toDateOrNull(r.decided_at),
      decisionType: r.decision_type,
      assuranceAchieved: r.assurance_achieved,
      createdBy: r.created_by,
    }));
  }

  /** Approved changes on a project, for the accounting export (report §10.5). */
  async approvedChangesForExport(
    ctx: TenantContext,
    projectId: string,
  ): Promise<
    Array<{
      changeNumber: string;
      approvedAt: Date;
      currency: string;
      projectRef: string;
      lineItems: Array<{
        description: string;
        quantity: string;
        unitRateMinor: string;
        taxRateBps: number;
        totalMinor: string;
      }>;
    }>
  > {
    const result = await this.db.execute<{
      number: string;
      decided_at: Date;
      currency: string;
      project_number: string;
      line_items: Array<{
        description: string;
        quantity: string;
        unit_price_minor: string;
        tax_rate_bps: number;
        total_minor: string;
      }> | null;
    }>(sql`
      SELECT co.number, v.decided_at, v.currency, p.project_number,
             (SELECT json_agg(json_build_object(
                'description', li.description,
                'quantity', li.quantity::text,
                'unit_price_minor', li.unit_price_minor::text,
                'tax_rate_bps', li.tax_rate_bps,
                'total_minor', li.total_minor::text
              ) ORDER BY li.position)
              FROM line_items li WHERE li.version_id = v.id) AS line_items
      FROM change_order_versions v
      JOIN change_orders co ON co.id = v.change_order_id
      JOIN projects p ON p.id = v.project_id
      WHERE v.organization_id = ${ctx.organizationId}::uuid
        AND v.project_id = ${projectId}::uuid
        AND v.status = 'APPROVED'
      ORDER BY v.decided_at
    `);

    return result.rows.map((r) => ({
      changeNumber: r.number,
      approvedAt: toDate(r.decided_at),
      currency: r.currency.trim(),
      projectRef: r.project_number,
      lineItems: (r.line_items ?? []).map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unitRateMinor: li.unit_price_minor,
        taxRateBps: li.tax_rate_bps,
        totalMinor: li.total_minor,
      })),
    }));
  }
}

export interface ReportRow {
  changeOrderId: string;
  number: string;
  versionNumber: number;
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  customerName: string;
  title: string;
  status: string;
  currency: string;
  subtotalDeltaMinor: bigint;
  taxDeltaMinor: bigint;
  totalDeltaMinor: bigint;
  scheduleDeltaDays: number;
  sentAt: Date | null;
  decidedAt: Date | null;
  decisionType: string | null;
  assuranceAchieved: string | null;
  createdBy: string;
}

type ReportRecord = {
  change_order_id: string;
  number: string;
  version_number: number;
  project_id: string;
  project_number: string;
  project_title: string;
  customer_name: string;
  title: string;
  status: string;
  currency: string;
  subtotal_delta_minor: string;
  tax_delta_minor: string;
  total_delta_minor: string;
  schedule_delta_days: number;
  sent_at: Date | null;
  decided_at: Date | null;
  decision_type: string | null;
  assurance_achieved: string | null;
  created_by: string;
};

// --- Support access and governance ------------------------------------------

/**
 * Report §3.1 and §12.1: support staff have no default document access;
 * elevated access is time-limited, customer-authorized and audited.
 */
export class SupportRepository {
  constructor(private readonly db: Database) {}

  async grant(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      grantedToUserId: string;
      reason: string;
      scope: 'METADATA' | 'DOCUMENTS';
      expiresAt: Date;
    },
  ): Promise<string> {
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO support_access_grants
        (id, organization_id, granted_to_user_id, granted_by_user_id, reason, scope, expires_at)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.grantedToUserId}::uuid,
        ${ctx.userId}::uuid, ${input.reason}, ${input.scope},
        ${input.expiresAt.toISOString()}::timestamptz
      )
    `);
    return id;
  }

  async revoke(tx: TransactionContext, ctx: TenantContext, grantId: string): Promise<void> {
    await tx.db.execute(sql`
      UPDATE support_access_grants SET revoked_at = now()
      WHERE id = ${grantId}::uuid AND organization_id = ${ctx.organizationId}::uuid
        AND revoked_at IS NULL
    `);
  }

  async activeGrant(
    organizationId: string,
    userId: string,
  ): Promise<{ id: string; scope: string; expiresAt: Date } | null> {
    const result = await this.db.execute<{ id: string; scope: string; expires_at: Date }>(sql`
      SELECT id, scope, expires_at FROM support_access_grants
      WHERE organization_id = ${organizationId}::uuid
        AND granted_to_user_id = ${userId}::uuid
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY expires_at DESC
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? { id: row.id, scope: row.scope, expiresAt: row.expires_at } : null;
  }

  async listGrants(ctx: TenantContext): Promise<
    Array<{
      id: string;
      grantedToUserId: string;
      scope: string;
      expiresAt: Date;
      revokedAt: Date | null;
    }>
  > {
    const result = await this.db.execute<{
      id: string;
      granted_to_user_id: string;
      scope: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(sql`
      SELECT id, granted_to_user_id, scope, expires_at, revoked_at
      FROM support_access_grants
      WHERE organization_id = ${ctx.organizationId}::uuid
      ORDER BY created_at DESC LIMIT 50
    `);
    return result.rows.map((r) => ({
      id: r.id,
      grantedToUserId: r.granted_to_user_id,
      scope: r.scope,
      expiresAt: toDate(r.expires_at),
      revokedAt: toDateOrNull(r.revoked_at),
    }));
  }

  /** Report §9.8: a legal hold suspends automatic deletion and is audited. */
  async hasLegalHold(projectId: string): Promise<boolean> {
    const result = await this.db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM legal_holds
        WHERE project_id = ${projectId}::uuid AND released_at IS NULL
      ) AS exists
    `);
    return result.rows[0]?.exists ?? false;
  }

  /** Report §9.6: repairs record before/after digests and an immutable event. */
  async recordRepair(
    tx: TransactionContext,
    input: {
      organizationId: string | null;
      targetTable: string;
      targetId: string | null;
      command: string;
      reason: string;
      beforeValue: unknown;
      afterValue: unknown;
      beforeDigest: Buffer | null;
      afterDigest: Buffer | null;
      performedBy: string;
      approvedBy: string | null;
    },
  ): Promise<string> {
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO repair_events
        (id, organization_id, target_table, target_id, command, reason,
         before_digest, after_digest, before_value, after_value, performed_by, approved_by)
      VALUES (
        ${id}::uuid, ${input.organizationId}::uuid, ${input.targetTable},
        ${input.targetId}::uuid, ${input.command}, ${input.reason},
        ${input.beforeDigest}, ${input.afterDigest},
        ${JSON.stringify(input.beforeValue ?? null)}::jsonb,
        ${JSON.stringify(input.afterValue ?? null)}::jsonb,
        ${input.performedBy}, ${input.approvedBy}
      )
    `);
    return id;
  }
}

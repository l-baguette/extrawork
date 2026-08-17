import { sql } from 'drizzle-orm';
import { AppError, type ProjectStatus } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { decodeCursor, encodeCursor } from './customers.js';
import { requireRow } from './organizations.js';
import { toDate, toDateOrNull } from '../row-types.js';

/**
 * Projects, baselines and the materialized approved-delta projection.
 *
 * Report §8.1 (revised total), §4.1 (baseline snapshot and amendment), §13.3
 * (projection integrity).
 */

export interface ProjectRow {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  projectNumber: string;
  title: string;
  siteAddressJson: Record<string, unknown> | null;
  status: ProjectStatus;
  currency: string;
  timezone: string;
  baselineSubtotalMinor: bigint;
  baselineTaxMinor: bigint;
  baselineTotalMinor: bigint;
  approvedDeltaMinor: bigint;
  revisedTotalMinor: bigint;
  approvedScheduleDeltaDays: number;
  startDate: string | null;
  expectedCompletionDate: string | null;
  defaultApproverContactId: string | null;
  baselineDocumentFileId: string | null;
  hasSentChange: boolean;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;
}

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  async create(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      customerId: string;
      projectNumber: string;
      title: string;
      siteAddress: Record<string, unknown> | null;
      currency: string;
      timezone: string;
      baselineSubtotalMinor: bigint;
      baselineTaxMinor: bigint;
      baselineTotalMinor: bigint;
      startDate: string | null;
      expectedCompletionDate: string | null;
      defaultApproverContactId: string;
      baselineDocumentFileId: string | null;
    },
  ): Promise<ProjectRow> {
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO projects (
        id, organization_id, customer_id, project_number, title, site_address_json,
        currency, timezone, baseline_subtotal_minor, baseline_tax_minor,
        baseline_total_minor, approved_delta_minor, revised_total_minor,
        start_date, expected_completion_date, default_approver_contact_id,
        baseline_document_file_id
      ) VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.customerId}::uuid,
        ${input.projectNumber}, ${input.title},
        ${input.siteAddress ? JSON.stringify(input.siteAddress) : null}::jsonb,
        ${input.currency}, ${input.timezone},
        ${input.baselineSubtotalMinor.toString()}::bigint,
        ${input.baselineTaxMinor.toString()}::bigint,
        ${input.baselineTotalMinor.toString()}::bigint,
        0, ${input.baselineTotalMinor.toString()}::bigint,
        ${input.startDate}::date, ${input.expectedCompletionDate}::date,
        ${input.defaultApproverContactId}::uuid,
        ${input.baselineDocumentFileId}::uuid
      )
    `);

    // The original baseline is version 1 of the baseline history.
    await tx.db.execute(sql`
      INSERT INTO baseline_versions
        (id, organization_id, project_id, version_number, subtotal_minor, tax_minor,
         total_minor, reason, supporting_file_id, recorded_by_user_id)
      VALUES (
        ${newId()}::uuid, ${ctx.organizationId}::uuid, ${id}::uuid, 1,
        ${input.baselineSubtotalMinor.toString()}::bigint,
        ${input.baselineTaxMinor.toString()}::bigint,
        ${input.baselineTotalMinor.toString()}::bigint,
        'Original baseline recorded at project creation',
        ${input.baselineDocumentFileId}::uuid, ${ctx.userId}::uuid
      )
    `);

    const created = await this.findByIdIn(tx.db, ctx, id);
    if (!created)
      throw new AppError('INTERNAL_ERROR', { message: 'Project insert returned no row' });
    return created;
  }

  async findById(ctx: TenantContext, id: string): Promise<ProjectRow | null> {
    return this.findByIdIn(this.db, ctx, id);
  }

  private async findByIdIn(
    db: Database,
    ctx: TenantContext,
    id: string,
  ): Promise<ProjectRow | null> {
    const result = await db.execute<ProjectRecord>(sql`
      SELECT ${PROJECT_COLUMNS}
      FROM projects p
      JOIN customers cu ON cu.id = p.customer_id
      WHERE p.id = ${id}::uuid AND p.organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapProject(row) : null;
  }

  async requireById(ctx: TenantContext, id: string): Promise<ProjectRow> {
    const row = await this.findById(ctx, id);
    if (!row) throw new AppError('PROJECT_NOT_FOUND');
    return row;
  }

  /**
   * Row-locked read used by send and decision transactions (report §7.8:
   * "decision, send, supersede, numbering, and baseline amendment commands use
   * short database transactions and row locks").
   */
  async lockById(tx: TransactionContext, ctx: TenantContext, id: string): Promise<ProjectRow> {
    const locked = await tx.db.execute<{ id: string }>(sql`
      SELECT id FROM projects
      WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
      FOR UPDATE
    `);
    if (!locked.rows[0]) throw new AppError('PROJECT_NOT_FOUND');
    const row = await this.findByIdIn(tx.db, ctx, id);
    if (!row) throw new AppError('PROJECT_NOT_FOUND');
    return row;
  }

  async list(
    ctx: TenantContext,
    options: {
      status?: ProjectStatus;
      customerId?: string;
      query?: string;
      cursor?: string;
      limit: number;
    },
  ): Promise<{ items: ProjectRow[]; nextCursor: string | null }> {
    const cursor = decodeCursor(options.cursor);
    const term = options.query?.trim();

    const result = await this.db.execute<ProjectRecord>(sql`
      SELECT ${PROJECT_COLUMNS}
      FROM projects p
      JOIN customers cu ON cu.id = p.customer_id
      WHERE p.organization_id = ${ctx.organizationId}::uuid
        ${options.status ? sql`AND p.status = ${options.status}::project_status` : sql``}
        ${options.customerId ? sql`AND p.customer_id = ${options.customerId}::uuid` : sql``}
        ${
          term
            ? sql`AND (p.search_document @@ plainto_tsquery('simple', extrawork_unaccent(lower(${term})))
                       OR p.title ILIKE ${`%${term}%`}
                       OR p.project_number ILIKE ${`%${term}%`})`
            : sql``
        }
        ${
          cursor
            ? sql`AND (p.updated_at, p.id) < (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`
            : sql``
        }
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT ${options.limit + 1}
    `);

    const rows = result.rows.slice(0, options.limit);
    const hasMore = result.rows.length > options.limit;
    const last = rows[rows.length - 1];
    return {
      items: rows.map(mapProject),
      nextCursor: hasMore && last ? encodeCursor(last.updated_at, last.id) : null,
    };
  }

  async update(
    tx: TransactionContext,
    ctx: TenantContext,
    id: string,
    patch: Partial<{
      title: string;
      siteAddress: Record<string, unknown> | null;
      status: ProjectStatus;
      startDate: string | null;
      expectedCompletionDate: string | null;
      defaultApproverContactId: string;
    }>,
  ): Promise<ProjectRow> {
    const result = await tx.db.execute<{ id: string }>(sql`
      UPDATE projects SET
        title = COALESCE(${patch.title ?? null}, title),
        site_address_json = ${
          patch.siteAddress === undefined
            ? sql`site_address_json`
            : sql`${patch.siteAddress ? JSON.stringify(patch.siteAddress) : null}::jsonb`
        },
        status = COALESCE(${patch.status ?? null}::project_status, status),
        start_date = ${patch.startDate === undefined ? sql`start_date` : sql`${patch.startDate}::date`},
        expected_completion_date = ${
          patch.expectedCompletionDate === undefined
            ? sql`expected_completion_date`
            : sql`${patch.expectedCompletionDate}::date`
        },
        default_approver_contact_id = COALESCE(
          ${patch.defaultApproverContactId ?? null}::uuid, default_approver_contact_id
        ),
        lock_version = lock_version + 1
      WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
      RETURNING id
    `);
    if (!result.rows[0]) throw new AppError('PROJECT_NOT_FOUND');
    return this.requireByIdIn(tx.db, ctx, id);
  }

  private async requireByIdIn(db: Database, ctx: TenantContext, id: string): Promise<ProjectRow> {
    const row = await this.findByIdIn(db, ctx, id);
    if (!row) throw new AppError('PROJECT_NOT_FOUND');
    return row;
  }

  /**
   * Applies an approved delta to the materialized projection. Runs inside the
   * decision transaction (report §8.4) with the project row already locked.
   */
  async applyApprovedDelta(
    tx: TransactionContext,
    ctx: TenantContext,
    projectId: string,
    deltaMinor: bigint,
    scheduleDeltaDays: number,
  ): Promise<{ approvedDeltaMinor: bigint; revisedTotalMinor: bigint }> {
    const result = await tx.db.execute<{
      approved_delta_minor: string;
      revised_total_minor: string;
    }>(sql`
      UPDATE projects
         SET approved_delta_minor = approved_delta_minor + ${deltaMinor.toString()}::bigint,
             revised_total_minor = baseline_total_minor + approved_delta_minor
                                   + ${deltaMinor.toString()}::bigint,
             approved_schedule_delta_days = approved_schedule_delta_days + ${scheduleDeltaDays},
             lock_version = lock_version + 1
       WHERE id = ${projectId}::uuid AND organization_id = ${ctx.organizationId}::uuid
      RETURNING approved_delta_minor, revised_total_minor
    `);
    const row = requireRow(result.rows[0], 'project projection');
    return {
      approvedDeltaMinor: BigInt(row.approved_delta_minor),
      revisedTotalMinor: BigInt(row.revised_total_minor),
    };
  }

  /** Latches `has_sent_change`, which locks the baseline (report §4.1). */
  async markHasSentChange(
    tx: TransactionContext,
    ctx: TenantContext,
    projectId: string,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE projects SET has_sent_change = true
      WHERE id = ${projectId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
        AND NOT has_sent_change
    `);
  }

  async recordBaselineAmendment(
    tx: TransactionContext,
    ctx: TenantContext,
    projectId: string,
    input: {
      subtotalMinor: bigint;
      taxMinor: bigint;
      totalMinor: bigint;
      reason: string;
      effectiveDate: string | null;
      supportingFileId: string | null;
    },
  ): Promise<number> {
    const next = await tx.db.execute<{ version_number: number }>(sql`
      SELECT COALESCE(max(version_number), 0) + 1 AS version_number
      FROM baseline_versions WHERE project_id = ${projectId}::uuid
    `);
    const versionNumber = next.rows[0]?.version_number ?? 1;

    await tx.db.execute(sql`
      INSERT INTO baseline_versions
        (id, organization_id, project_id, version_number, subtotal_minor, tax_minor,
         total_minor, reason, effective_date, supporting_file_id, recorded_by_user_id)
      VALUES (
        ${newId()}::uuid, ${ctx.organizationId}::uuid, ${projectId}::uuid, ${versionNumber},
        ${input.subtotalMinor.toString()}::bigint, ${input.taxMinor.toString()}::bigint,
        ${input.totalMinor.toString()}::bigint, ${input.reason},
        ${input.effectiveDate}::date, ${input.supportingFileId}::uuid, ${ctx.userId}::uuid
      )
    `);

    await tx.db.execute(sql`
      UPDATE projects SET
        baseline_subtotal_minor = ${input.subtotalMinor.toString()}::bigint,
        baseline_tax_minor = ${input.taxMinor.toString()}::bigint,
        baseline_total_minor = ${input.totalMinor.toString()}::bigint,
        revised_total_minor = ${input.totalMinor.toString()}::bigint + approved_delta_minor,
        lock_version = lock_version + 1
      WHERE id = ${projectId}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);

    return versionNumber;
  }

  async close(
    tx: TransactionContext,
    ctx: TenantContext,
    projectId: string,
    retentionMonths: number,
  ): Promise<void> {
    // Retention runs from project close (report §9.8).
    await tx.db.execute(sql`
      UPDATE projects
         SET status = 'CLOSED', closed_at = now(),
             retention_until = (now() + make_interval(months => ${retentionMonths}))::date,
             lock_version = lock_version + 1
       WHERE id = ${projectId}::uuid
         AND organization_id = ${ctx.organizationId}::uuid
         AND status NOT IN ('CLOSED','ARCHIVED')
    `);
  }

  async setIntegrityReview(
    tx: TransactionContext,
    projectId: string,
    underReview: boolean,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE projects
         SET status = ${underReview ? sql`'INTEGRITY_REVIEW'::project_status` : sql`'ACTIVE'::project_status`},
             lock_version = lock_version + 1
       WHERE id = ${projectId}::uuid
    `);
  }

  /** Sum of pending (sent/viewed) deltas, shown next to the revised total. */
  async pendingTotals(
    ctx: TenantContext,
    projectId: string,
  ): Promise<{ pendingDeltaMinor: bigint; pendingCount: number; approvedCount: number }> {
    const result = await this.db.execute<{
      pending_delta: string;
      pending_count: string;
      approved_count: string;
    }>(sql`
      SELECT
        COALESCE(sum(total_delta_minor) FILTER (WHERE status IN ('SENT','VIEWED')), 0)::text AS pending_delta,
        count(*) FILTER (WHERE status IN ('SENT','VIEWED'))::text AS pending_count,
        count(*) FILTER (WHERE status = 'APPROVED')::text AS approved_count
      FROM change_order_versions
      WHERE project_id = ${projectId}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return {
      pendingDeltaMinor: BigInt(row?.pending_delta ?? '0'),
      pendingCount: Number.parseInt(row?.pending_count ?? '0', 10),
      approvedCount: Number.parseInt(row?.approved_count ?? '0', 10),
    };
  }

  /** Report §13.3: recompute from approved versions and compare. */
  /**
   * Projects whose disclosed retention window has elapsed (report §9.8).
   * Reports only: deletion requires notification, an export offer, and no legal
   * hold, so the destructive step is an operator command rather than a job.
   */
  async findRetentionDue(
    db: Database,
    now: Date,
  ): Promise<Array<{ projectId: string; organizationId: string; retentionUntil: string }>> {
    const result = await db.execute<{
      id: string;
      organization_id: string;
      retention_until: string;
    }>(sql`
      SELECT p.id, p.organization_id, p.retention_until
      FROM projects p
      WHERE p.retention_until IS NOT NULL
        AND p.retention_until <= ${now.toISOString()}::date
        AND NOT EXISTS (
          SELECT 1 FROM legal_holds h
          WHERE h.project_id = p.id AND h.released_at IS NULL
        )
      ORDER BY p.retention_until
      LIMIT 200
    `);
    return result.rows.map((r) => ({
      projectId: r.id,
      organizationId: r.organization_id,
      retentionUntil: String(r.retention_until).slice(0, 10),
    }));
  }

  async findIntegrityMismatches(): Promise<
    Array<{
      projectId: string;
      organizationId: string;
      storedDeltaMinor: bigint;
      recomputedDeltaMinor: bigint;
    }>
  > {
    const result = await this.db.execute<{
      project_id: string;
      organization_id: string;
      stored_delta_minor: string;
      recomputed_delta_minor: string;
    }>(sql`SELECT * FROM project_integrity_mismatches()`);
    return result.rows.map((r) => ({
      projectId: r.project_id,
      organizationId: r.organization_id,
      storedDeltaMinor: BigInt(r.stored_delta_minor),
      recomputedDeltaMinor: BigInt(r.recomputed_delta_minor),
    }));
  }

  /** Controlled repair used only by the documented repair command (§13.3). */
  async rebuildProjection(
    tx: TransactionContext,
    projectId: string,
  ): Promise<{ approvedDeltaMinor: bigint; revisedTotalMinor: bigint }> {
    const result = await tx.db.execute<{
      approved_delta_minor: string;
      revised_total_minor: string;
    }>(sql`
      WITH recomputed AS (SELECT * FROM project_recomputed_totals(${projectId}::uuid))
      UPDATE projects p
         SET approved_delta_minor = r.approved_delta_minor,
             revised_total_minor = p.baseline_total_minor + r.approved_delta_minor,
             approved_schedule_delta_days = r.approved_schedule_delta_days,
             lock_version = p.lock_version + 1
        FROM recomputed r
       WHERE p.id = ${projectId}::uuid
      RETURNING p.approved_delta_minor, p.revised_total_minor
    `);
    const row = requireRow(result.rows[0], 'rebuilt projection');
    return {
      approvedDeltaMinor: BigInt(row.approved_delta_minor),
      revisedTotalMinor: BigInt(row.revised_total_minor),
    };
  }
}

const PROJECT_COLUMNS = sql`
  p.id, p.organization_id, p.customer_id, cu.display_name AS customer_name,
  p.project_number, p.title, p.site_address_json, p.status, p.currency, p.timezone,
  p.baseline_subtotal_minor, p.baseline_tax_minor, p.baseline_total_minor,
  p.approved_delta_minor, p.revised_total_minor, p.approved_schedule_delta_days,
  p.start_date, p.expected_completion_date, p.default_approver_contact_id,
  p.baseline_document_file_id, p.has_sent_change, p.closed_at,
  p.created_at, p.updated_at, p.lock_version
`;

type ProjectRecord = {
  id: string;
  organization_id: string;
  customer_id: string;
  customer_name: string;
  project_number: string;
  title: string;
  site_address_json: Record<string, unknown> | null;
  status: ProjectStatus;
  currency: string;
  timezone: string;
  baseline_subtotal_minor: string;
  baseline_tax_minor: string;
  baseline_total_minor: string;
  approved_delta_minor: string;
  revised_total_minor: string;
  approved_schedule_delta_days: number;
  start_date: string | null;
  expected_completion_date: string | null;
  default_approver_contact_id: string | null;
  baseline_document_file_id: string | null;
  has_sent_change: boolean;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  lock_version: number;
};

function mapProject(row: ProjectRecord): ProjectRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    projectNumber: row.project_number,
    title: row.title,
    siteAddressJson: row.site_address_json,
    status: row.status,
    currency: row.currency.trim(),
    timezone: row.timezone,
    baselineSubtotalMinor: BigInt(row.baseline_subtotal_minor),
    baselineTaxMinor: BigInt(row.baseline_tax_minor),
    baselineTotalMinor: BigInt(row.baseline_total_minor),
    approvedDeltaMinor: BigInt(row.approved_delta_minor),
    revisedTotalMinor: BigInt(row.revised_total_minor),
    approvedScheduleDeltaDays: row.approved_schedule_delta_days,
    startDate: row.start_date,
    expectedCompletionDate: row.expected_completion_date,
    defaultApproverContactId: row.default_approver_contact_id,
    baselineDocumentFileId: row.baseline_document_file_id,
    hasSentChange: row.has_sent_change,
    closedAt: toDateOrNull(row.closed_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    lockVersion: row.lock_version,
  };
}

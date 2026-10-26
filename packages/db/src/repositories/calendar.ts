import { sql } from 'drizzle-orm';
import type { MembershipRole, MilestoneKind } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate } from '../row-types.js';
import { runInScope, SYSTEM_SCOPE } from '../tenant-scope.js';

/**
 * The collated calendar, the private feed tokens and the due-date sweep —
 * migration 0023, spec 2026-10-12 D14.
 *
 * Every date here is a local calendar day in the project's own time zone: a
 * decision recorded at 23:30 IST on the 4th happened on the 4th, whatever the
 * server's clock says. Dates leave the database as `YYYY-MM-DD` text so no
 * driver ever turns them back into midnight-UTC instants.
 */

export type CalendarSourceKind =
  | 'PROJECT_START'
  | 'PROJECT_COMPLETION'
  | 'PROJECT_REVISED_COMPLETION'
  | 'MILESTONE'
  | 'APPROVAL_EXPIRES'
  | 'DECISION';

/** One dated fact, before it is worded for a person. */
export interface CalendarSourceRow {
  kind: CalendarSourceKind;
  /** The row the event is about: project, milestone, version or decision id. */
  refId: string;
  date: string;
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  projectStatus: string;
  /** Milestone or request title. */
  label: string | null;
  /** Request number, for request-related events. */
  changeOrderId: string | null;
  changeOrderNumber: string | null;
  milestoneKind: MilestoneKind | null;
  /** APPROVE / DECLINE / REQUEST_REVISION for decisions. */
  decisionType: string | null;
  scheduleDeltaDays: number;
  /** The original expected completion, for the revised-completion detail. */
  expectedCompletionDate: string | null;
  completed: boolean;
}

export interface CalendarRange {
  from: string;
  to: string;
  /** Null: every project in the organization. An empty array: none. */
  projectIds: readonly string[] | null;
  projectId?: string | null;
}

export interface FeedOwner {
  tokenId: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  projectGrants: string[];
}

export interface DueItem {
  organizationId: string;
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  kind: 'MILESTONE' | 'COMPLETION';
  /** Milestone id, or the project id for a completion date. */
  refId: string;
  title: string;
  dueDate: string;
  daysUntil: number;
}

export class CalendarRepository {
  constructor(readonly db: Database) {}

  async events(
    db: Database,
    ctx: TenantContext,
    range: CalendarRange,
  ): Promise<CalendarSourceRow[]> {
    const projectFilter = sql`
      ${range.projectIds === null ? sql`` : sql`AND p.id = ANY(${pgUuidArray(range.projectIds)}::uuid[])`}
      ${range.projectId ? sql`AND p.id = ${range.projectId}::uuid` : sql``}
    `;
    const from = sql`${range.from}::date`;
    const to = sql`${range.to}::date`;
    const result = await db.execute<SourceRecord>(sql`
      WITH p AS (
        SELECT p.id, p.project_number, p.title, p.timezone, p.status::text AS status,
               p.start_date, p.expected_completion_date, p.approved_schedule_delta_days
        FROM projects p
        WHERE p.organization_id = ${ctx.organizationId}::uuid
        ${projectFilter}
      )
      SELECT 'PROJECT_START' AS kind, p.id AS ref_id, to_char(p.start_date, 'YYYY-MM-DD') AS date,
             p.id AS project_id, p.project_number, p.title AS project_title, p.status AS project_status,
             NULL::text AS label, NULL::uuid AS change_order_id, NULL::text AS change_order_number,
             NULL::text AS milestone_kind, NULL::text AS decision_type,
             p.approved_schedule_delta_days AS schedule_delta_days,
             to_char(p.expected_completion_date, 'YYYY-MM-DD') AS expected_completion_date,
             false AS completed
      FROM p WHERE p.start_date BETWEEN ${from} AND ${to}
      UNION ALL
      SELECT 'PROJECT_COMPLETION', p.id, to_char(p.expected_completion_date, 'YYYY-MM-DD'),
             p.id, p.project_number, p.title, p.status, NULL, NULL, NULL, NULL, NULL,
             p.approved_schedule_delta_days, to_char(p.expected_completion_date, 'YYYY-MM-DD'),
             p.status IN ('CLOSED', 'ARCHIVED')
      FROM p WHERE p.expected_completion_date BETWEEN ${from} AND ${to}
      UNION ALL
      SELECT 'PROJECT_REVISED_COMPLETION', p.id,
             to_char(p.expected_completion_date + p.approved_schedule_delta_days, 'YYYY-MM-DD'),
             p.id, p.project_number, p.title, p.status, NULL, NULL, NULL, NULL, NULL,
             p.approved_schedule_delta_days, to_char(p.expected_completion_date, 'YYYY-MM-DD'),
             p.status IN ('CLOSED', 'ARCHIVED')
      FROM p
      WHERE p.approved_schedule_delta_days <> 0
        AND p.expected_completion_date IS NOT NULL
        AND p.expected_completion_date + p.approved_schedule_delta_days BETWEEN ${from} AND ${to}
      UNION ALL
      SELECT 'MILESTONE', m.id, to_char(m.due_date, 'YYYY-MM-DD'),
             p.id, p.project_number, p.title, p.status, m.title, NULL, NULL, m.kind, NULL,
             0, NULL, m.completed_at IS NOT NULL
      FROM project_milestones m
      JOIN p ON p.id = m.project_id
      WHERE m.organization_id = ${ctx.organizationId}::uuid
        AND m.due_date BETWEEN ${from} AND ${to}
      UNION ALL
      SELECT 'APPROVAL_EXPIRES', v.id, to_char((v.expires_at AT TIME ZONE p.timezone)::date, 'YYYY-MM-DD'),
             p.id, p.project_number, p.title, p.status, v.title, co.id, co.number, NULL, NULL,
             v.schedule_delta_days, NULL, false
      FROM change_orders co
      JOIN change_order_versions v
        ON v.organization_id = co.organization_id AND v.id = co.current_version_id
      JOIN p ON p.id = co.project_id
      WHERE co.organization_id = ${ctx.organizationId}::uuid
        AND v.status IN ('SENT', 'VIEWED')
        AND (v.expires_at AT TIME ZONE p.timezone)::date BETWEEN ${from} AND ${to}
      UNION ALL
      SELECT 'DECISION', d.id, to_char((d.occurred_at AT TIME ZONE p.timezone)::date, 'YYYY-MM-DD'),
             p.id, p.project_number, p.title, p.status, v.title, co.id, co.number, NULL,
             d.type::text, v.schedule_delta_days, NULL, true
      FROM decisions d
      JOIN change_order_versions v ON v.organization_id = d.organization_id AND v.id = d.version_id
      JOIN change_orders co ON co.organization_id = v.organization_id AND co.id = v.change_order_id
      JOIN p ON p.id = d.project_id
      WHERE d.organization_id = ${ctx.organizationId}::uuid
        -- The coarse instant bound lets the index help; the local-date test decides.
        AND d.occurred_at >= ${from}::timestamp - interval '1 day'
        AND d.occurred_at < ${to}::timestamp + interval '2 days'
        AND (d.occurred_at AT TIME ZONE p.timezone)::date BETWEEN ${from} AND ${to}
      ORDER BY date, kind, ref_id
    `);
    return result.rows.map(mapSource);
  }

  // --- Private feed tokens ------------------------------------------------------

  async activeFeed(
    db: Database,
    ctx: TenantContext,
    userId: string,
  ): Promise<{ id: string; createdAt: Date } | null> {
    const result = await db.execute<{ id: string; created_at: Date | string }>(sql`
      SELECT id, created_at FROM calendar_feed_tokens
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND user_id = ${userId}::uuid AND revoked_at IS NULL
    `);
    const row = result.rows[0];
    return row ? { id: row.id, createdAt: toDate(row.created_at) } : null;
  }

  /** Revokes any active feed and issues a new one. Only the hash is stored. */
  async rotateFeed(
    tx: TransactionContext,
    ctx: TenantContext,
    userId: string,
    tokenHash: Buffer,
  ): Promise<{ id: string; createdAt: Date }> {
    await this.revokeFeed(tx, ctx, userId);
    const id = newId();
    const result = await tx.db.execute<{ created_at: Date | string }>(sql`
      INSERT INTO calendar_feed_tokens (id, organization_id, user_id, token_sha256)
      VALUES (${id}::uuid, ${ctx.organizationId}::uuid, ${userId}::uuid, ${tokenHash})
      RETURNING created_at
    `);
    return { id, createdAt: toDate(result.rows[0]?.created_at) };
  }

  async revokeFeed(tx: TransactionContext, ctx: TenantContext, userId: string): Promise<boolean> {
    const result = await tx.db.execute(sql`
      UPDATE calendar_feed_tokens SET revoked_at = now()
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND user_id = ${userId}::uuid AND revoked_at IS NULL
    `);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * The bootstrap lookup for the public feed. System-scoped because the token
   * is what *names* the tenant (like `approvals.findByToken`). Returns null
   * for a revoked token, and for one whose owner's membership is no longer
   * ACTIVE or whose workspace is suspended: a removed collaborator's calendar
   * app must stop receiving the project's dates on its next refresh.
   */
  async findFeedOwner(tokenHash: Buffer): Promise<FeedOwner | null> {
    const result = await runInScope(SYSTEM_SCOPE, () =>
      this.db.execute<{
        id: string;
        organization_id: string;
        user_id: string;
        role: MembershipRole;
        project_grants: string[] | null;
      }>(sql`
        SELECT t.id, t.organization_id, t.user_id, m.role,
               ARRAY(
                 SELECT pm.project_id::text FROM project_members pm
                 WHERE pm.organization_id = t.organization_id AND pm.user_id = t.user_id
               ) AS project_grants
        FROM calendar_feed_tokens t
        JOIN memberships m
          ON m.organization_id = t.organization_id AND m.user_id = t.user_id
        JOIN organizations o ON o.id = t.organization_id
        JOIN users u ON u.id = t.user_id
        WHERE t.token_sha256 = ${tokenHash}
          AND t.revoked_at IS NULL
          AND m.status = 'ACTIVE'
          AND o.status <> 'SUSPENDED'
          AND u.status = 'ACTIVE'
      `),
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      tokenId: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.role,
      projectGrants: row.project_grants ?? [],
    };
  }

  async markFeedFetched(ctx: TenantContext, tokenId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE calendar_feed_tokens SET last_fetched_at = now()
      WHERE organization_id = ${ctx.organizationId}::uuid AND id = ${tokenId}::uuid
    `);
  }

  // --- Due reminders (worker, system scope) ---------------------------------------

  /**
   * Open milestones and effective completion dates from today up to
   * `horizonDays` ahead, "today" being the project's own local date at `now`.
   * Only projects still in progress: a closed project's handover is history.
   */
  async dueItems(db: Database, now: Date, horizonDays: number): Promise<DueItem[]> {
    const at = sql`${now.toISOString()}::timestamptz`;
    const result = await db.execute<{
      organization_id: string;
      project_id: string;
      project_number: string;
      project_title: string;
      kind: 'MILESTONE' | 'COMPLETION';
      ref_id: string;
      title: string;
      due_date: string;
      days_until: number;
    }>(sql`
      WITH p AS (
        SELECT id, organization_id, project_number, title,
               (${at} AT TIME ZONE timezone)::date AS today,
               CASE WHEN expected_completion_date IS NULL THEN NULL
                    ELSE expected_completion_date + approved_schedule_delta_days END AS completion
        FROM projects
        WHERE status IN ('ACTIVE', 'ON_HOLD')
      )
      SELECT m.organization_id, p.id AS project_id, p.project_number, p.title AS project_title,
             'MILESTONE' AS kind, m.id AS ref_id, m.title, to_char(m.due_date, 'YYYY-MM-DD') AS due_date,
             (m.due_date - p.today) AS days_until
      FROM project_milestones m
      JOIN p ON p.organization_id = m.organization_id AND p.id = m.project_id
      WHERE m.completed_at IS NULL
        AND m.due_date BETWEEN p.today AND p.today + ${horizonDays}::integer
      UNION ALL
      SELECT p.organization_id, p.id, p.project_number, p.title,
             'COMPLETION', p.id, p.title, to_char(p.completion, 'YYYY-MM-DD'),
             (p.completion - p.today)
      FROM p
      WHERE p.completion BETWEEN p.today AND p.today + ${horizonDays}::integer
      ORDER BY organization_id, due_date
    `);
    return result.rows.map((r) => ({
      organizationId: r.organization_id,
      projectId: r.project_id,
      projectNumber: r.project_number,
      projectTitle: r.project_title,
      kind: r.kind,
      refId: r.ref_id,
      title: r.title,
      dueDate: r.due_date,
      daysUntil: Number(r.days_until),
    }));
  }
}

function pgUuidArray(ids: readonly string[]): string {
  return `{${ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(',')}}`;
}

type SourceRecord = {
  kind: CalendarSourceKind;
  ref_id: string;
  date: string;
  project_id: string;
  project_number: string;
  project_title: string;
  project_status: string;
  label: string | null;
  change_order_id: string | null;
  change_order_number: string | null;
  milestone_kind: MilestoneKind | null;
  decision_type: string | null;
  schedule_delta_days: number | null;
  expected_completion_date: string | null;
  completed: boolean;
};

function mapSource(row: SourceRecord): CalendarSourceRow {
  return {
    kind: row.kind,
    refId: row.ref_id,
    date: row.date,
    projectId: row.project_id,
    projectNumber: row.project_number,
    projectTitle: row.project_title,
    projectStatus: row.project_status,
    label: row.label,
    changeOrderId: row.change_order_id,
    changeOrderNumber: row.change_order_number,
    milestoneKind: row.milestone_kind,
    decisionType: row.decision_type,
    scheduleDeltaDays: Number(row.schedule_delta_days ?? 0),
    expectedCompletionDate: row.expected_completion_date,
    completed: Boolean(row.completed),
  };
}

import { sql } from 'drizzle-orm';
import { AppError, type MilestoneKind } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull } from '../row-types.js';

/**
 * Project milestones — migration 0022, spec 2026-10-12 D14. The dated points
 * of a project's timeline: site visits, deliveries, handover, payments.
 */

export interface MilestoneRow {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  kind: MilestoneKind;
  /** `YYYY-MM-DD`; a milestone is a day, not an instant. */
  dueDate: string;
  notes: string | null;
  clientVisible: boolean;
  completedAt: Date | null;
  createdAt: Date;
}

export interface MilestonePatch {
  title?: string;
  kind?: MilestoneKind;
  dueDate?: string;
  notes?: string | null;
  clientVisible?: boolean;
  completed?: boolean;
}

export class MilestoneRepository {
  constructor(readonly db: Database) {}

  async listForProject(
    db: Database,
    ctx: TenantContext,
    projectId: string,
  ): Promise<MilestoneRow[]> {
    const result = await db.execute<MilestoneRecord>(sql`
      SELECT ${COLUMNS} FROM project_milestones
      WHERE organization_id = ${ctx.organizationId}::uuid AND project_id = ${projectId}::uuid
      ORDER BY due_date, created_at, id
    `);
    return result.rows.map(mapMilestone);
  }

  async findById(db: Database, ctx: TenantContext, id: string): Promise<MilestoneRow | null> {
    const result = await db.execute<MilestoneRecord>(sql`
      SELECT ${COLUMNS} FROM project_milestones
      WHERE organization_id = ${ctx.organizationId}::uuid AND id = ${id}::uuid
    `);
    const row = result.rows[0];
    return row ? mapMilestone(row) : null;
  }

  async requireById(db: Database, ctx: TenantContext, id: string): Promise<MilestoneRow> {
    const row = await this.findById(db, ctx, id);
    if (!row) throw new AppError('MILESTONE_NOT_FOUND');
    return row;
  }

  async insert(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      projectId: string;
      title: string;
      kind: MilestoneKind;
      dueDate: string;
      notes: string | null;
      clientVisible: boolean;
    },
  ): Promise<MilestoneRow> {
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO project_milestones
        (id, organization_id, project_id, title, kind, due_date, notes, client_visible,
         created_by_user_id)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid, ${input.title},
        ${input.kind}, ${input.dueDate}::date, ${input.notes}, ${input.clientVisible},
        ${ctx.userId}::uuid
      )
    `);
    return this.requireById(tx.db, ctx, id);
  }

  async update(
    tx: TransactionContext,
    ctx: TenantContext,
    id: string,
    patch: MilestonePatch,
  ): Promise<MilestoneRow> {
    // Completing an already-complete milestone keeps its original completion
    // time; reopening clears both columns together.
    const completion =
      patch.completed === undefined
        ? sql``
        : patch.completed
          ? sql`,
              completed_at = COALESCE(completed_at, now()),
              completed_by_user_id = COALESCE(completed_by_user_id, ${ctx.userId}::uuid)`
          : sql`, completed_at = NULL, completed_by_user_id = NULL`;
    await tx.db.execute(sql`
      UPDATE project_milestones SET
        title = COALESCE(${patch.title ?? null}, title),
        kind = COALESCE(${patch.kind ?? null}, kind),
        due_date = COALESCE(${patch.dueDate ?? null}::date, due_date),
        notes = ${patch.notes === undefined ? sql`notes` : sql`${patch.notes}`},
        client_visible = COALESCE(${patch.clientVisible ?? null}::boolean, client_visible)
        ${completion}
      WHERE organization_id = ${ctx.organizationId}::uuid AND id = ${id}::uuid
    `);
    return this.requireById(tx.db, ctx, id);
  }

  async delete(tx: TransactionContext, ctx: TenantContext, id: string): Promise<boolean> {
    const result = await tx.db.execute(sql`
      DELETE FROM project_milestones
      WHERE organization_id = ${ctx.organizationId}::uuid AND id = ${id}::uuid
    `);
    return (result.rowCount ?? 0) > 0;
  }
}

const COLUMNS = sql`
  id, organization_id, project_id, title, kind, to_char(due_date, 'YYYY-MM-DD') AS due_date,
  notes, client_visible, completed_at, created_at
`;

type MilestoneRecord = {
  id: string;
  organization_id: string;
  project_id: string;
  title: string;
  kind: MilestoneKind;
  due_date: string;
  notes: string | null;
  client_visible: boolean;
  completed_at: Date | string | null;
  created_at: Date | string;
};

function mapMilestone(row: MilestoneRecord): MilestoneRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    title: row.title,
    kind: row.kind,
    dueDate: row.due_date,
    notes: row.notes,
    clientVisible: row.client_visible,
    completedAt: toDateOrNull(row.completed_at),
    createdAt: toDate(row.created_at),
  };
}

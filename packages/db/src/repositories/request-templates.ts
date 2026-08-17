import { sql } from 'drizzle-orm';
import { AppError } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { toDate, toInt } from '../row-types.js';

/**
 * The owner-editable copy a customer sees on the approval page and in the
 * contract body. Migration 0005, one row per organization.
 *
 * What the owner may edit: heading, intro, terms body, payment note, footer.
 * What they may **not** edit, and what is deliberately absent from this table:
 * the assurance language and the disclaimer. Those describe what the record
 * actually *is* — a secure-link record of assent, not a licensed electronic
 * signature — and letting a seller reword them would let the product overstate
 * its own evidence (report §3.3, §12.4). They live in
 * `packages/contracts/src/assurance.ts`, are frozen into every snapshot, and
 * are asserted by golden tests.
 *
 * `templateVersion` is bumped on every edit and frozen into each sent version,
 * so an edit made today cannot change what a customer agreed to last week.
 */

export interface RequestTemplateRow {
  organizationId: string;
  heading: string;
  intro: string;
  termsBody: string;
  paymentNote: string | null;
  footerNote: string | null;
  templateVersion: number;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The subset frozen into `change_order_versions.template_snapshot` at send. */
export interface TemplateSnapshot {
  heading: string;
  intro: string;
  termsBody: string;
  paymentNote: string | null;
  footerNote: string | null;
  templateVersion: number;
}

export class RequestTemplateRepository {
  constructor(private readonly db: Database) {}

  async find(ctx: TenantContext): Promise<RequestTemplateRow | null> {
    return this.findIn(this.db, ctx);
  }

  private async findIn(db: Database, ctx: TenantContext): Promise<RequestTemplateRow | null> {
    const result = await db.execute<TemplateRecord>(sql`
      SELECT ${TEMPLATE_COLUMNS}
      FROM request_templates
      WHERE organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapTemplate(row) : null;
  }

  /**
   * Returns the tenant's template, creating it from the column defaults if the
   * organization has never edited one. The defaults live in the migration so
   * that a row inserted by any path — this method, a seed, a manual insert —
   * carries the same wording.
   */
  async ensure(tx: TransactionContext, ctx: TenantContext): Promise<RequestTemplateRow> {
    await tx.db.execute(sql`
      INSERT INTO request_templates (organization_id)
      VALUES (${ctx.organizationId}::uuid)
      ON CONFLICT (organization_id) DO NOTHING
    `);
    const row = await this.findIn(tx.db, ctx);
    if (!row) {
      throw new AppError('INTERNAL_ERROR', { message: 'Request template upsert returned no row' });
    }
    return row;
  }

  async update(
    tx: TransactionContext,
    ctx: TenantContext,
    patch: Partial<{
      heading: string;
      intro: string;
      termsBody: string;
      paymentNote: string | null;
      footerNote: string | null;
    }>,
  ): Promise<RequestTemplateRow> {
    await this.ensure(tx, ctx);

    const result = await tx.db.execute<{ organization_id: string }>(sql`
      UPDATE request_templates SET
        heading = COALESCE(${patch.heading ?? null}, heading),
        intro = COALESCE(${patch.intro ?? null}, intro),
        terms_body = COALESCE(${patch.termsBody ?? null}, terms_body),
        payment_note = ${patch.paymentNote === undefined ? sql`payment_note` : sql`${patch.paymentNote}`},
        footer_note = ${patch.footerNote === undefined ? sql`footer_note` : sql`${patch.footerNote}`},
        template_version = template_version + 1,
        updated_by_user_id = ${ctx.userId}::uuid,
        updated_at = now()
      WHERE organization_id = ${ctx.organizationId}::uuid
      RETURNING organization_id
    `);
    if (!result.rows[0]) throw new AppError('NOT_FOUND');

    const row = await this.findIn(tx.db, ctx);
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  /**
   * The snapshot frozen into a version at send time. Read inside the send
   * transaction so the copy captured is the copy that was live at that instant,
   * consistent with how the canonical snapshot is built.
   */
  async snapshotFor(tx: TransactionContext, ctx: TenantContext): Promise<TemplateSnapshot> {
    const row = await this.ensure(tx, ctx);
    return {
      heading: row.heading,
      intro: row.intro,
      termsBody: row.termsBody,
      paymentNote: row.paymentNote,
      footerNote: row.footerNote,
      templateVersion: row.templateVersion,
    };
  }
}

const TEMPLATE_COLUMNS = sql`
  organization_id, heading, intro, terms_body, payment_note, footer_note,
  template_version, updated_by_user_id, created_at, updated_at
`;

type TemplateRecord = {
  organization_id: string;
  heading: string;
  intro: string;
  terms_body: string;
  payment_note: string | null;
  footer_note: string | null;
  template_version: number;
  updated_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapTemplate(row: TemplateRecord): RequestTemplateRow {
  return {
    organizationId: row.organization_id,
    heading: row.heading,
    intro: row.intro,
    termsBody: row.terms_body,
    paymentNote: row.payment_note,
    footerNote: row.footer_note,
    templateVersion: toInt(row.template_version, 1),
    updatedByUserId: row.updated_by_user_id,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

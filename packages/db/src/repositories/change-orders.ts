import { sql } from 'drizzle-orm';
import {
  AppError,
  type AssuranceLevel,
  type ChangeType,
  type VersionStatus,
} from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { decodeCursor, encodeCursor } from './customers.js';
import { requireRow } from './organizations.js';
import { toDate, toDateOrNull } from '../row-types.js';

/**
 * Change orders and their versions.
 *
 * Report §4.4 (version rules), §7.8 (concurrency control), §9.6 (append-only
 * frozen versions). Draft writes use optimistic locking; send and decision
 * writes take a row lock first.
 */

export interface LineItemRow {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unit: string | null;
  direction: 1 | -1;
  unitPriceMinor: bigint;
  taxRateBps: number;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

export interface AttachmentRow {
  fileObjectId: string;
  position: number;
  caption: string | null;
  filename: string;
  mimeType: string;
  byteSize: bigint;
  sha256: Buffer | null;
  scanStatus: string;
  derivativeStorageKey: string | null;
  storageKey: string;
  promotedStorageKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

export interface VersionRow {
  id: string;
  organizationId: string;
  changeOrderId: string;
  projectId: string;
  versionNumber: number;
  status: VersionStatus;
  type: ChangeType;
  title: string;
  scopeDescription: string;
  reason: string | null;
  scheduleDeltaDays: number;
  revisedCompletionDate: string | null;
  approverContactId: string;
  assuranceRequired: AssuranceLevel;
  currency: string;
  subtotalDeltaMinor: bigint;
  taxDeltaMinor: bigint;
  totalDeltaMinor: bigint;
  baselineTotalMinor: bigint | null;
  priorApprovedDeltaMinor: bigint | null;
  revisedContractTotalMinor: bigint | null;
  canonicalSnapshot: Record<string, unknown> | null;
  canonicalSha256: Buffer | null;
  canonicalizerVersion: string | null;
  termsVersion: string | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  supersededByVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;
}

export interface ChangeOrderRow {
  id: string;
  organizationId: string;
  projectId: string;
  number: string;
  type: ChangeType;
  currentVersionId: string | null;
  createdByUserId: string;
  reversalOfChangeOrderId: string | null;
  createdAt: Date;
}

export interface LineItemWrite {
  description: string;
  quantity: string;
  unit: string | null;
  direction: 1 | -1;
  unitPriceMinor: bigint;
  taxRateBps: number;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

export class ChangeOrderRepository {
  constructor(private readonly db: Database) {}

  // --- Creation ------------------------------------------------------------

  async createWithDraft(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      projectId: string;
      number: string;
      type: ChangeType;
      title: string;
      scope: string;
      reason: string | null;
      scheduleDeltaDays: number;
      revisedCompletionDate: string | null;
      approverContactId: string;
      assuranceRequired: AssuranceLevel;
      currency: string;
      subtotalDeltaMinor: bigint;
      taxDeltaMinor: bigint;
      totalDeltaMinor: bigint;
      expiresAt: Date | null;
      lineItems: LineItemWrite[];
    },
  ): Promise<{ changeOrder: ChangeOrderRow; version: VersionRow }> {
    const changeOrderId = newId();
    const versionId = newId();

    await tx.db.execute(sql`
      INSERT INTO change_orders
        (id, organization_id, project_id, number, type, created_by_user_id)
      VALUES (
        ${changeOrderId}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid,
        ${input.number}, ${input.type}::change_type, ${ctx.userId}::uuid
      )
    `);

    await this.insertVersionRow(tx, ctx, {
      ...input,
      id: versionId,
      changeOrderId,
      versionNumber: 1,
    });

    await tx.db.execute(sql`
      UPDATE change_orders SET current_version_id = ${versionId}::uuid
      WHERE id = ${changeOrderId}::uuid
    `);

    await this.replaceLineItems(tx, ctx, versionId, input.lineItems);

    const changeOrder = await this.requireChangeOrder(tx.db, ctx, changeOrderId);
    const version = await this.requireVersion(tx.db, ctx, versionId);
    return { changeOrder, version };
  }

  /** Creates version n+1, supersedes the prior one and revokes its token. */
  async createRevision(
    tx: TransactionContext,
    ctx: TenantContext,
    previous: VersionRow,
    input: {
      type: ChangeType;
      title: string;
      scope: string;
      reason: string | null;
      scheduleDeltaDays: number;
      revisedCompletionDate: string | null;
      approverContactId: string;
      assuranceRequired: AssuranceLevel;
      currency: string;
      subtotalDeltaMinor: bigint;
      taxDeltaMinor: bigint;
      totalDeltaMinor: bigint;
      expiresAt: Date | null;
      lineItems: LineItemWrite[];
      copyAttachmentsFromVersionId?: string | null;
    },
  ): Promise<VersionRow> {
    const versionId = newId();

    await this.insertVersionRow(tx, ctx, {
      id: versionId,
      changeOrderId: previous.changeOrderId,
      projectId: previous.projectId,
      versionNumber: previous.versionNumber + 1,
      ...input,
    });

    await this.replaceLineItems(tx, ctx, versionId, input.lineItems);

    if (input.copyAttachmentsFromVersionId) {
      // Attachments carry forward by reference: the same immutable file object,
      // a new join row on the new version.
      await tx.db.execute(sql`
        INSERT INTO version_attachments
          (organization_id, version_id, file_object_id, position, caption)
        SELECT organization_id, ${versionId}::uuid, file_object_id, position, caption
        FROM version_attachments
        WHERE version_id = ${input.copyAttachmentsFromVersionId}::uuid
          AND organization_id = ${ctx.organizationId}::uuid
      `);
    }

    // Report §4.4: the prior version becomes SUPERSEDED and its token is revoked.
    if (previous.status !== 'APPROVED' && previous.status !== 'DECLINED') {
      await tx.db.execute(sql`
        UPDATE change_order_versions
           SET status = 'SUPERSEDED', superseded_by_version_id = ${versionId}::uuid,
               lock_version = lock_version + 1
         WHERE id = ${previous.id}::uuid AND organization_id = ${ctx.organizationId}::uuid
      `);
      await tx.db.execute(sql`
        UPDATE approval_tokens
           SET revoked_at = now(), revoked_reason = 'SUPERSEDED'
         WHERE version_id = ${previous.id}::uuid AND revoked_at IS NULL
      `);
    }

    await tx.db.execute(sql`
      UPDATE change_orders SET current_version_id = ${versionId}::uuid, updated_at = now()
      WHERE id = ${previous.changeOrderId}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);

    return this.requireVersion(tx.db, ctx, versionId);
  }

  private async insertVersionRow(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      id: string;
      changeOrderId: string;
      projectId: string;
      versionNumber: number;
      type: ChangeType;
      title: string;
      scope: string;
      reason: string | null;
      scheduleDeltaDays: number;
      revisedCompletionDate: string | null;
      approverContactId: string;
      assuranceRequired: AssuranceLevel;
      currency: string;
      subtotalDeltaMinor: bigint;
      taxDeltaMinor: bigint;
      totalDeltaMinor: bigint;
      expiresAt: Date | null;
    },
  ): Promise<void> {
    await tx.db.execute(sql`
      INSERT INTO change_order_versions (
        id, organization_id, change_order_id, project_id, version_number, status, type,
        title, scope_description, reason, schedule_delta_days, revised_completion_date,
        approver_contact_id, assurance_required, currency,
        subtotal_delta_minor, tax_delta_minor, total_delta_minor,
        expires_at, created_by_user_id
      ) VALUES (
        ${input.id}::uuid, ${ctx.organizationId}::uuid, ${input.changeOrderId}::uuid,
        ${input.projectId}::uuid, ${input.versionNumber}, 'DRAFT', ${input.type}::change_type,
        ${input.title}, ${input.scope}, ${input.reason}, ${input.scheduleDeltaDays},
        ${input.revisedCompletionDate}::date, ${input.approverContactId}::uuid,
        ${input.assuranceRequired}::assurance_level, ${input.currency},
        ${input.subtotalDeltaMinor.toString()}::bigint,
        ${input.taxDeltaMinor.toString()}::bigint,
        ${input.totalDeltaMinor.toString()}::bigint,
        ${input.expiresAt?.toISOString() ?? null}::timestamptz,
        ${ctx.userId}::uuid
      )
    `);
  }

  // --- Draft editing -------------------------------------------------------

  /**
   * Optimistic lock — report §7.8: `UPDATE ... WHERE id=? AND lock_version=?`.
   * A mismatch means someone else saved first; the UI shows a comparison rather
   * than overwriting (report §6.3).
   */
  async updateDraft(
    tx: TransactionContext,
    ctx: TenantContext,
    versionId: string,
    expectedLockVersion: number,
    input: {
      type: ChangeType;
      title: string;
      scope: string;
      reason: string | null;
      scheduleDeltaDays: number;
      revisedCompletionDate: string | null;
      approverContactId: string;
      assuranceRequired: AssuranceLevel;
      subtotalDeltaMinor: bigint;
      taxDeltaMinor: bigint;
      totalDeltaMinor: bigint;
      expiresAt: Date | null;
      lineItems: LineItemWrite[];
    },
  ): Promise<VersionRow> {
    const result = await tx.db.execute<{ id: string }>(sql`
      UPDATE change_order_versions SET
        type = ${input.type}::change_type,
        title = ${input.title},
        scope_description = ${input.scope},
        reason = ${input.reason},
        schedule_delta_days = ${input.scheduleDeltaDays},
        revised_completion_date = ${input.revisedCompletionDate}::date,
        approver_contact_id = ${input.approverContactId}::uuid,
        assurance_required = ${input.assuranceRequired}::assurance_level,
        subtotal_delta_minor = ${input.subtotalDeltaMinor.toString()}::bigint,
        tax_delta_minor = ${input.taxDeltaMinor.toString()}::bigint,
        total_delta_minor = ${input.totalDeltaMinor.toString()}::bigint,
        expires_at = ${input.expiresAt?.toISOString() ?? null}::timestamptz,
        lock_version = lock_version + 1
      WHERE id = ${versionId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
        AND status = 'DRAFT'
        AND lock_version = ${expectedLockVersion}
      RETURNING id
    `);

    if (!result.rows[0]) {
      const current = await this.findVersion(tx.db, ctx, versionId);
      if (!current) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      if (current.status !== 'DRAFT') {
        throw new AppError('INVALID_STATE_TRANSITION', {
          message: 'This version has already been sent and can no longer be edited.',
          details: { currentStatus: current.status },
        });
      }
      throw new AppError('LOCK_CONFLICT', {
        details: { currentLockVersion: current.lockVersion, submitted: expectedLockVersion },
      });
    }

    await this.replaceLineItems(tx, ctx, versionId, input.lineItems);
    // The change order's type follows its current version.
    await tx.db.execute(sql`
      UPDATE change_orders co SET type = ${input.type}::change_type, updated_at = now()
      FROM change_order_versions v
      WHERE v.id = ${versionId}::uuid AND co.id = v.change_order_id
    `);

    return this.requireVersion(tx.db, ctx, versionId);
  }

  private async replaceLineItems(
    tx: TransactionContext,
    ctx: TenantContext,
    versionId: string,
    lineItems: LineItemWrite[],
  ): Promise<void> {
    // Safe because the freeze trigger rejects this for any non-DRAFT version.
    await tx.db.execute(sql`
      DELETE FROM line_items
      WHERE version_id = ${versionId}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);

    for (const [index, item] of lineItems.entries()) {
      await tx.db.execute(sql`
        INSERT INTO line_items (
          id, organization_id, version_id, position, description, quantity, unit,
          direction, unit_price_minor, tax_rate_bps, subtotal_minor, tax_minor, total_minor
        ) VALUES (
          ${newId()}::uuid, ${ctx.organizationId}::uuid, ${versionId}::uuid, ${index},
          ${item.description}, ${item.quantity}::numeric, ${item.unit},
          ${item.direction}, ${item.unitPriceMinor.toString()}::bigint, ${item.taxRateBps},
          ${item.subtotalMinor.toString()}::bigint, ${item.taxMinor.toString()}::bigint,
          ${item.totalMinor.toString()}::bigint
        )
      `);
    }
  }

  // --- Freeze and send -----------------------------------------------------

  /**
   * Writes the frozen snapshot and moves the version to SENT. The freeze
   * trigger permits this exactly once, because it only allows these columns to
   * change while the old status is DRAFT.
   */
  async freezeAndSend(
    tx: TransactionContext,
    ctx: TenantContext,
    versionId: string,
    input: {
      snapshot: unknown;
      canonicalSha256: Buffer;
      canonicalizerVersion: string;
      termsVersion: string;
      baselineTotalMinor: bigint;
      priorApprovedDeltaMinor: bigint;
      revisedContractTotalMinor: bigint;
      revisedCompletionDate: string | null;
      sentAt: Date;
      expiresAt: Date;
    },
  ): Promise<VersionRow> {
    const result = await tx.db.execute<{ id: string }>(sql`
      UPDATE change_order_versions SET
        status = 'SENT',
        canonical_snapshot = ${JSON.stringify(input.snapshot)}::jsonb,
        canonical_sha256 = ${input.canonicalSha256},
        canonicalizer_version = ${input.canonicalizerVersion},
        terms_version = ${input.termsVersion},
        baseline_total_minor = ${input.baselineTotalMinor.toString()}::bigint,
        prior_approved_delta_minor = ${input.priorApprovedDeltaMinor.toString()}::bigint,
        revised_contract_total_minor = ${input.revisedContractTotalMinor.toString()}::bigint,
        revised_completion_date = ${input.revisedCompletionDate}::date,
        sent_at = ${input.sentAt.toISOString()}::timestamptz,
        expires_at = ${input.expiresAt.toISOString()}::timestamptz,
        lock_version = lock_version + 1
      WHERE id = ${versionId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
        AND status = 'DRAFT'
      RETURNING id
    `);

    if (!result.rows[0]) {
      const current = await this.findVersion(tx.db, ctx, versionId);
      if (!current) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      throw new AppError('INVALID_STATE_TRANSITION', {
        message: 'This version has already been sent.',
        details: { currentStatus: current.status },
      });
    }
    return this.requireVersion(tx.db, ctx, versionId);
  }

  /**
   * Row lock for the decision and supersede paths (report §7.8, §8.4). Returns
   * the locked row so the caller can revalidate state under the lock.
   */
  async lockVersion(tx: TransactionContext, versionId: string): Promise<VersionRow | null> {
    const locked = await tx.db.execute<{ organization_id: string }>(sql`
      SELECT organization_id FROM change_order_versions
      WHERE id = ${versionId}::uuid
      FOR UPDATE
    `);
    const organizationId = locked.rows[0]?.organization_id;
    if (!organizationId) return null;
    return this.findVersion(tx.db, { organizationId } as TenantContext, versionId);
  }

  async setStatus(
    tx: TransactionContext,
    versionId: string,
    status: VersionStatus,
    at: Date,
  ): Promise<void> {
    const decided =
      status === 'APPROVED' || status === 'DECLINED' || status === 'REVISION_REQUESTED';
    await tx.db.execute(sql`
      UPDATE change_order_versions SET
        status = ${status}::version_status,
        viewed_at = ${status === 'VIEWED' ? sql`COALESCE(viewed_at, ${at.toISOString()}::timestamptz)` : sql`viewed_at`},
        decided_at = ${decided ? sql`${at.toISOString()}::timestamptz` : sql`decided_at`},
        lock_version = lock_version + 1
      WHERE id = ${versionId}::uuid
    `);
  }

  // --- Reads ---------------------------------------------------------------

  async findVersion(
    db: Database,
    ctx: TenantContext,
    versionId: string,
  ): Promise<VersionRow | null> {
    const result = await db.execute<VersionRecord>(sql`
      SELECT ${VERSION_COLUMNS} FROM change_order_versions
      WHERE id = ${versionId}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapVersion(row) : null;
  }

  async requireVersion(db: Database, ctx: TenantContext, versionId: string): Promise<VersionRow> {
    const row = await this.findVersion(db, ctx, versionId);
    if (!row) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    return row;
  }

  async findChangeOrder(
    db: Database,
    ctx: TenantContext,
    id: string,
  ): Promise<ChangeOrderRow | null> {
    const result = await db.execute<ChangeOrderRecord>(sql`
      SELECT id, organization_id, project_id, number, type, current_version_id,
             created_by_user_id, reversal_of_change_order_id, created_at
      FROM change_orders
      WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapChangeOrder(row) : null;
  }

  async requireChangeOrder(db: Database, ctx: TenantContext, id: string): Promise<ChangeOrderRow> {
    const row = await this.findChangeOrder(db, ctx, id);
    if (!row) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    return row;
  }

  async getCurrentVersion(ctx: TenantContext, changeOrderId: string): Promise<VersionRow | null> {
    const result = await this.db.execute<VersionRecord>(sql`
      SELECT ${VERSION_COLUMNS} FROM change_order_versions
      WHERE change_order_id = ${changeOrderId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
      ORDER BY version_number DESC
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? mapVersion(row) : null;
  }

  async listVersions(ctx: TenantContext, changeOrderId: string): Promise<VersionRow[]> {
    const result = await this.db.execute<VersionRecord>(sql`
      SELECT ${VERSION_COLUMNS} FROM change_order_versions
      WHERE change_order_id = ${changeOrderId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
      ORDER BY version_number ASC
    `);
    return result.rows.map(mapVersion);
  }

  async listLineItems(db: Database, versionId: string): Promise<LineItemRow[]> {
    const result = await db.execute<{
      id: string;
      position: number;
      description: string;
      quantity: string;
      unit: string | null;
      direction: number;
      unit_price_minor: string;
      tax_rate_bps: number;
      subtotal_minor: string;
      tax_minor: string;
      total_minor: string;
    }>(sql`
      SELECT id, position, description, quantity, unit, direction, unit_price_minor,
             tax_rate_bps, subtotal_minor, tax_minor, total_minor
      FROM line_items WHERE version_id = ${versionId}::uuid ORDER BY position
    `);
    return result.rows.map((r) => ({
      id: r.id,
      position: r.position,
      description: r.description,
      quantity: r.quantity,
      unit: r.unit,
      direction: r.direction === -1 ? -1 : 1,
      unitPriceMinor: BigInt(r.unit_price_minor),
      taxRateBps: r.tax_rate_bps,
      subtotalMinor: BigInt(r.subtotal_minor),
      taxMinor: BigInt(r.tax_minor),
      totalMinor: BigInt(r.total_minor),
    }));
  }

  async listAttachments(db: Database, versionId: string): Promise<AttachmentRow[]> {
    const result = await db.execute<{
      file_object_id: string;
      position: number;
      caption: string | null;
      original_filename: string;
      detected_mime_type: string | null;
      declared_mime_type: string | null;
      byte_size: string;
      sha256: Buffer | null;
      scan_status: string;
      derivative_storage_key: string | null;
      storage_key: string;
      promoted_storage_key: string | null;
      image_width: number | null;
      image_height: number | null;
    }>(sql`
      SELECT va.file_object_id, va.position, va.caption,
             f.original_filename, f.detected_mime_type, f.declared_mime_type,
             f.byte_size, f.sha256, f.scan_status, f.derivative_storage_key,
             f.storage_key, f.promoted_storage_key, f.image_width, f.image_height
      FROM version_attachments va
      JOIN file_objects f ON f.id = va.file_object_id
      WHERE va.version_id = ${versionId}::uuid
      ORDER BY va.position
    `);
    return result.rows.map((r) => ({
      fileObjectId: r.file_object_id,
      position: r.position,
      caption: r.caption,
      filename: r.original_filename,
      mimeType: r.detected_mime_type ?? r.declared_mime_type ?? 'application/octet-stream',
      byteSize: BigInt(r.byte_size),
      sha256: r.sha256,
      scanStatus: r.scan_status,
      derivativeStorageKey: r.derivative_storage_key,
      storageKey: r.storage_key,
      promotedStorageKey: r.promoted_storage_key,
      imageWidth: r.image_width,
      imageHeight: r.image_height,
    }));
  }

  async addAttachment(
    tx: TransactionContext,
    ctx: TenantContext,
    versionId: string,
    fileObjectId: string,
    caption: string | null,
  ): Promise<void> {
    const next = await tx.db.execute<{ position: number }>(sql`
      SELECT COALESCE(max(position), -1) + 1 AS position
      FROM version_attachments WHERE version_id = ${versionId}::uuid
    `);
    await tx.db.execute(sql`
      INSERT INTO version_attachments
        (organization_id, version_id, file_object_id, position, caption)
      VALUES (
        ${ctx.organizationId}::uuid, ${versionId}::uuid, ${fileObjectId}::uuid,
        ${next.rows[0]?.position ?? 0}, ${caption}
      )
      ON CONFLICT (version_id, file_object_id) DO NOTHING
    `);
  }

  async removeAttachment(
    tx: TransactionContext,
    ctx: TenantContext,
    versionId: string,
    fileObjectId: string,
  ): Promise<void> {
    const result = await tx.db.execute(sql`
      DELETE FROM version_attachments
      WHERE version_id = ${versionId}::uuid
        AND file_object_id = ${fileObjectId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
    `);
    if ((result.rowCount ?? 0) === 0) throw new AppError('ATTACHMENT_NOT_FOUND');
  }

  /**
   * Sum of approved deltas on a project, excluding one version. Used at send
   * time to compute `prior_approved_delta` for the frozen snapshot.
   */
  async priorApprovedDelta(
    db: Database,
    ctx: TenantContext,
    projectId: string,
    excludeVersionId?: string,
  ): Promise<bigint> {
    const result = await db.execute<{ total: string }>(sql`
      SELECT COALESCE(sum(total_delta_minor), 0)::text AS total
      FROM change_order_versions
      WHERE project_id = ${projectId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
        AND status = 'APPROVED'
        ${excludeVersionId ? sql`AND id <> ${excludeVersionId}::uuid` : sql``}
    `);
    return BigInt(result.rows[0]?.total ?? '0');
  }

  /**
   * Records that a version came in over WhatsApp and who raised it.
   *
   * Written after the version is frozen rather than as part of it: `origin` and
   * `raised_by_employee_id` are provenance, not terms. They are outside the
   * canonical snapshot on purpose, so the digest a customer agreed to does not
   * change depending on which channel the request arrived through. Migration
   * 0003 freezes the *terms* columns; these two are not among them.
   */
  async markIntakeOrigin(
    tx: TransactionContext,
    ctx: TenantContext,
    versionId: string,
    employeeId: string,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE change_order_versions
         SET origin = 'WHATSAPP', raised_by_employee_id = ${employeeId}::uuid
       WHERE id = ${versionId}::uuid
         AND organization_id = ${ctx.organizationId}::uuid
    `);
  }

  /**
   * Who raised a version, and through which channel.
   *
   * Kept off `VersionRow` deliberately: provenance is needed by exactly one
   * caller — the job that tells the team a customer decided — and widening the
   * row every read carries would put two more columns in front of every
   * consumer that has no use for them.
   */
  async findOrigin(
    db: Database,
    ctx: TenantContext,
    versionId: string,
  ): Promise<{ origin: string; raisedByEmployeeId: string | null } | null> {
    const result = await db.execute<{ origin: string; raised_by_employee_id: string | null }>(sql`
      SELECT origin, raised_by_employee_id
      FROM change_order_versions
      WHERE id = ${versionId}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? { origin: row.origin, raisedByEmployeeId: row.raised_by_employee_id } : null;
  }

  // --- Listing -------------------------------------------------------------

  async listSummaries(
    ctx: TenantContext,
    options: {
      projectId?: string;
      customerId?: string;
      status?: VersionStatus;
      bucket?: 'PENDING' | 'DECIDED' | 'EXPIRING' | 'DRAFT';
      query?: string;
      cursor?: string;
      limit: number;
      projectGrants?: readonly string[] | null;
    },
  ): Promise<{ items: ChangeOrderSummaryRow[]; nextCursor: string | null }> {
    const cursor = decodeCursor(options.cursor);
    const term = options.query?.trim();

    const bucketFilter = (() => {
      switch (options.bucket) {
        case 'PENDING':
          return sql`AND v.status IN ('SENT','VIEWED')`;
        case 'DECIDED':
          return sql`AND v.status IN ('APPROVED','DECLINED','REVISION_REQUESTED')`;
        case 'EXPIRING':
          return sql`AND v.status IN ('SENT','VIEWED') AND v.expires_at < now() + interval '48 hours'`;
        case 'DRAFT':
          return sql`AND v.status = 'DRAFT'`;
        default:
          return sql``;
      }
    })();

    // Project-scoped roles only see granted projects (report §3.2).
    const grantFilter = options.projectGrants
      ? options.projectGrants.length > 0
        ? sql`AND v.project_id = ANY(${sql.raw(`ARRAY[${options.projectGrants.map((g) => `'${g}'::uuid`).join(',')}]`)})`
        : sql`AND false`
      : sql``;

    const result = await this.db.execute<ChangeOrderSummaryRecord>(sql`
      SELECT co.id, co.project_id, p.title AS project_title, cu.display_name AS customer_name,
             co.number, v.title, co.type, v.status, v.version_number,
             v.total_delta_minor, v.currency, v.schedule_delta_days,
             v.sent_at, v.decided_at, v.expires_at, v.updated_at
      FROM change_orders co
      JOIN change_order_versions v ON v.id = co.current_version_id
      JOIN projects p ON p.id = co.project_id
      JOIN customers cu ON cu.id = p.customer_id
      WHERE co.organization_id = ${ctx.organizationId}::uuid
        ${options.projectId ? sql`AND co.project_id = ${options.projectId}::uuid` : sql``}
        ${options.customerId ? sql`AND p.customer_id = ${options.customerId}::uuid` : sql``}
        ${options.status ? sql`AND v.status = ${options.status}::version_status` : sql``}
        ${bucketFilter}
        ${grantFilter}
        ${
          term
            ? sql`AND (co.search_document @@ plainto_tsquery('simple', extrawork_unaccent(lower(${term})))
                       OR v.title ILIKE ${`%${term}%`} OR co.number ILIKE ${`%${term}%`})`
            : sql``
        }
        ${
          cursor
            ? sql`AND (v.updated_at, co.id) < (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`
            : sql``
        }
      ORDER BY v.updated_at DESC, co.id DESC
      LIMIT ${options.limit + 1}
    `);

    const rows = result.rows.slice(0, options.limit);
    const hasMore = result.rows.length > options.limit;
    const last = rows[rows.length - 1];
    return {
      items: rows.map(mapSummary),
      nextCursor: hasMore && last ? encodeCursor(last.updated_at, last.id) : null,
    };
  }

  /** Report §9.4 `versions_pending_idx`: drives the expiry job. */
  /**
   * Report §9.8: "Drafts abandoned for 180 days: delete after notification."
   * Only ever removes a version that was never sent, so nothing that has been
   * shown to a customer or frozen into evidence can be caught by this.
   */
  async deleteAbandonedDrafts(db: Database, days: number, now: Date): Promise<number> {
    const result = await db.execute(sql`
      WITH doomed AS (
        SELECT v.id
        FROM change_order_versions v
        WHERE v.status = 'DRAFT'
          AND v.sent_at IS NULL
          AND v.updated_at < ${now.toISOString()}::timestamptz - make_interval(days => ${days})
          -- Never touch a change order that has any sent history.
          AND NOT EXISTS (
            SELECT 1 FROM change_order_versions sibling
            WHERE sibling.change_order_id = v.change_order_id
              AND sibling.status <> 'DRAFT'
          )
      ),
      cleared AS (
        UPDATE change_orders co SET current_version_id = NULL
        WHERE co.current_version_id IN (SELECT id FROM doomed)
        RETURNING co.id
      ),
      lines AS (
        DELETE FROM line_items WHERE version_id IN (SELECT id FROM doomed)
      ),
      attachments AS (
        DELETE FROM version_attachments WHERE version_id IN (SELECT id FROM doomed)
      )
      DELETE FROM change_order_versions WHERE id IN (SELECT id FROM doomed)
    `);
    return result.rowCount ?? 0;
  }

  async findExpiredVersions(
    limit: number,
  ): Promise<
    Array<{ id: string; organizationId: string; projectId: string; changeOrderId: string }>
  > {
    const result = await this.db.execute<{
      id: string;
      organization_id: string;
      project_id: string;
      change_order_id: string;
    }>(sql`
      SELECT id, organization_id, project_id, change_order_id
      FROM change_order_versions
      WHERE status IN ('SENT','VIEWED') AND expires_at <= now()
      ORDER BY expires_at
      LIMIT ${limit}
    `);
    return result.rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      projectId: r.project_id,
      changeOrderId: r.change_order_id,
    }));
  }
}

export interface ChangeOrderSummaryRow {
  id: string;
  projectId: string;
  projectTitle: string;
  customerName: string;
  number: string;
  title: string;
  type: ChangeType;
  status: VersionStatus;
  versionNumber: number;
  totalDeltaMinor: bigint;
  currency: string;
  scheduleDeltaDays: number;
  sentAt: Date | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  updatedAt: Date;
}

const VERSION_COLUMNS = sql`
  id, organization_id, change_order_id, project_id, version_number, status, type,
  title, scope_description, reason, schedule_delta_days, revised_completion_date,
  approver_contact_id, assurance_required, currency, subtotal_delta_minor,
  tax_delta_minor, total_delta_minor, baseline_total_minor, prior_approved_delta_minor,
  revised_contract_total_minor, canonical_snapshot, canonical_sha256,
  canonicalizer_version, terms_version, sent_at, viewed_at, decided_at, expires_at,
  superseded_by_version_id, created_at, updated_at, lock_version
`;

type VersionRecord = {
  id: string;
  organization_id: string;
  change_order_id: string;
  project_id: string;
  version_number: number;
  status: VersionStatus;
  type: ChangeType;
  title: string;
  scope_description: string;
  reason: string | null;
  schedule_delta_days: number;
  revised_completion_date: string | null;
  approver_contact_id: string;
  assurance_required: AssuranceLevel;
  currency: string;
  subtotal_delta_minor: string;
  tax_delta_minor: string;
  total_delta_minor: string;
  baseline_total_minor: string | null;
  prior_approved_delta_minor: string | null;
  revised_contract_total_minor: string | null;
  canonical_snapshot: Record<string, unknown> | null;
  canonical_sha256: Buffer | null;
  canonicalizer_version: string | null;
  terms_version: string | null;
  sent_at: Date | null;
  viewed_at: Date | null;
  decided_at: Date | null;
  expires_at: Date | null;
  superseded_by_version_id: string | null;
  created_at: Date;
  updated_at: Date;
  lock_version: number;
};

function mapVersion(row: VersionRecord): VersionRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    changeOrderId: row.change_order_id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    status: row.status,
    type: row.type,
    title: row.title,
    scopeDescription: row.scope_description,
    reason: row.reason,
    scheduleDeltaDays: row.schedule_delta_days,
    revisedCompletionDate: row.revised_completion_date,
    approverContactId: row.approver_contact_id,
    assuranceRequired: row.assurance_required,
    currency: row.currency.trim(),
    subtotalDeltaMinor: BigInt(row.subtotal_delta_minor),
    taxDeltaMinor: BigInt(row.tax_delta_minor),
    totalDeltaMinor: BigInt(row.total_delta_minor),
    baselineTotalMinor: row.baseline_total_minor === null ? null : BigInt(row.baseline_total_minor),
    priorApprovedDeltaMinor:
      row.prior_approved_delta_minor === null ? null : BigInt(row.prior_approved_delta_minor),
    revisedContractTotalMinor:
      row.revised_contract_total_minor === null ? null : BigInt(row.revised_contract_total_minor),
    canonicalSnapshot: row.canonical_snapshot,
    canonicalSha256: row.canonical_sha256,
    canonicalizerVersion: row.canonicalizer_version,
    termsVersion: row.terms_version,
    sentAt: toDateOrNull(row.sent_at),
    viewedAt: toDateOrNull(row.viewed_at),
    decidedAt: toDateOrNull(row.decided_at),
    expiresAt: toDateOrNull(row.expires_at),
    supersededByVersionId: row.superseded_by_version_id,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    lockVersion: row.lock_version,
  };
}

type ChangeOrderRecord = {
  id: string;
  organization_id: string;
  project_id: string;
  number: string;
  type: ChangeType;
  current_version_id: string | null;
  created_by_user_id: string;
  reversal_of_change_order_id: string | null;
  created_at: Date;
};

function mapChangeOrder(row: ChangeOrderRecord): ChangeOrderRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    number: row.number,
    type: row.type,
    currentVersionId: row.current_version_id,
    createdByUserId: row.created_by_user_id,
    reversalOfChangeOrderId: row.reversal_of_change_order_id,
    createdAt: toDate(row.created_at),
  };
}

type ChangeOrderSummaryRecord = {
  id: string;
  project_id: string;
  project_title: string;
  customer_name: string;
  number: string;
  title: string;
  type: ChangeType;
  status: VersionStatus;
  version_number: number;
  total_delta_minor: string;
  currency: string;
  schedule_delta_days: number;
  sent_at: Date | null;
  decided_at: Date | null;
  expires_at: Date | null;
  updated_at: Date;
};

function mapSummary(row: ChangeOrderSummaryRecord): ChangeOrderSummaryRow {
  return {
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.project_title,
    customerName: row.customer_name,
    number: row.number,
    title: row.title,
    type: row.type,
    status: row.status,
    versionNumber: row.version_number,
    totalDeltaMinor: BigInt(row.total_delta_minor),
    currency: row.currency.trim(),
    scheduleDeltaDays: row.schedule_delta_days,
    sentAt: toDateOrNull(row.sent_at),
    decidedAt: toDateOrNull(row.decided_at),
    expiresAt: toDateOrNull(row.expires_at),
    updatedAt: toDate(row.updated_at),
  };
}

export { requireRow };

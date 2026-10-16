import { sql } from 'drizzle-orm';
import { AppError } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull, toInt, toJsonOrNull } from '../row-types.js';

/**
 * The inbound message log: every WhatsApp message received, authenticated or
 * not, with what the parser understood and the reply the employee was sent.
 *
 * Migration 0005. This is an operator's forensic record, not a queue. "Someone
 * texted us claiming to be X" is exactly what support needs to see later, so a
 * message from an unknown number is logged with a null `organization_id` rather
 * than being dropped or guessed into a tenant.
 *
 * That nullable tenant is why this repository has two surfaces:
 *
 *   * `record` / `markProcessed` take no `TenantContext`. They run before the
 *     sender has been resolved to an organization — there is no tenant yet.
 *   * `list` / `findById` are tenant-scoped like every other read, and are what
 *     the owner dashboard uses. They can never return an unattributed message,
 *     because a null `organization_id` matches no tenant.
 *
 * Unattributed messages are readable only through `listUnattributed`, which is
 * a platform-operator view and takes no tenant on purpose.
 */

export type InboundStatus =
  | 'RECEIVED'
  | 'REJECTED_UNKNOWN_SENDER'
  | 'REJECTED_NOT_AUTHORIZED'
  | 'REJECTED_UNPARSEABLE'
  | 'REJECTED_POLICY'
  | 'ACCEPTED'
  // Migration 0023.
  | 'SAVED'
  | 'AWAITING_CHOICE'
  | 'ANSWERED';

export interface InboundMessageRow {
  id: string;
  organizationId: string | null;
  employeeId: string | null;
  /** Migration 0023: the customer contact who sent it, when not site team. */
  contactId: string | null;
  /** Migration 0023: the project document it was filed as. */
  documentId: string | null;
  /**
   * Migration 0023: the provider's attachment handles, kept so a message held
   * for a project choice can still have its media fetched once answered.
   */
  mediaRefs: StoredMediaRef[];
  /** Migration 0023: for a held message, the reply that said which project. */
  resolvedByInboundMessageId: string | null;
  projectId: string | null;
  changeOrderId: string | null;
  provider: string;
  providerAccountId: string | null;
  providerMessageId: string;
  fromPhoneE164: string;
  body: string | null;
  mediaCount: number;
  status: InboundStatus;
  parsed: Record<string, unknown> | null;
  rejectionReason: string | null;
  replyText: string | null;
  receivedAt: Date;
  processedAt: Date | null;
  /** Present on tenant-scoped reads; null for unattributed/write projections. */
  employeeName: string | null;
  /** Present on tenant-scoped reads; null for unattributed/write projections. */
  projectTitle: string | null;
  /** Present on tenant-scoped reads; null for unattributed/write projections. */
  contactName: string | null;
}

/** One provider attachment handle, as stored in `inbound_messages.media_refs`. */
export interface StoredMediaRef {
  mediaId: string;
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
}

export class InboundMessageRepository {
  constructor(private readonly db: Database) {}

  /**
   * Logs a received message before anything is known about the sender.
   *
   * Deliberately takes no `TenantContext`: at this point the only identifying
   * fact is a phone number, and `employees.findByPhoneGlobal` has not run yet.
   * Attributing the row to an organization here would be a guess.
   *
   * Idempotent on `(provider, provider_account_id, provider_message_id)`.
   * WhatsApp redelivers, and a
   * redelivery must not produce a second change order — so a repeat returns the
   * existing row untouched and the caller can see it was already handled by its
   * `status`.
   */
  async record(
    tx: TransactionContext,
    input: {
      provider?: string;
      providerAccountId?: string | null;
      providerMessageId: string;
      fromPhoneE164: string;
      body: string | null;
      mediaCount?: number;
      /** Recorded with the message, before the sender is known (spec D6). */
      mediaRefs?: StoredMediaRef[];
    },
  ): Promise<{ row: InboundMessageRow; alreadySeen: boolean }> {
    const provider = input.provider ?? 'whatsapp';
    const mediaRefs = input.mediaRefs ?? [];
    const result = await tx.db.execute<InboundRecord>(sql`
      INSERT INTO inbound_messages (
        id, provider, provider_account_id, provider_message_id, from_phone_e164, body, media_count,
        media_refs
      ) VALUES (
        ${newId()}::uuid, ${provider}, ${input.providerAccountId ?? null}, ${input.providerMessageId},
        ${input.fromPhoneE164}, ${input.body}, ${Math.max(input.mediaCount ?? 0, mediaRefs.length)},
        ${JSON.stringify(mediaRefs)}::jsonb
      )
      ON CONFLICT DO NOTHING
      RETURNING ${INBOUND_COLUMNS_BARE}
    `);

    const inserted = result.rows[0];
    if (inserted) return { row: mapInbound(inserted), alreadySeen: false };

    const existing = await tx.db.execute<InboundRecord>(sql`
      SELECT ${INBOUND_COLUMNS_BARE}
      FROM inbound_messages
      WHERE provider = ${provider}
        AND provider_account_id IS NOT DISTINCT FROM ${input.providerAccountId ?? null}
        AND provider_message_id = ${input.providerMessageId}
    `);
    const row = existing.rows[0];
    if (!row) {
      throw new AppError('INTERNAL_ERROR', {
        message: 'Inbound message conflicted but could not be re-read',
      });
    }
    return { row: mapInbound(row), alreadySeen: true };
  }

  /**
   * Saves a durable processing checkpoint without making the message terminal.
   * A worker retry can resume from the linked change order after a crash rather
   * than creating a second request for the same provider message.
   */
  async markProgress(
    tx: TransactionContext,
    id: string,
    progress: {
      organizationId: string;
      employeeId: string | null;
      contactId?: string | null;
      projectId: string;
      changeOrderId: string;
      parsed: Record<string, unknown>;
    },
  ): Promise<void> {
    const result = await tx.db.execute<{ id: string }>(sql`
      UPDATE inbound_messages SET
        organization_id = ${progress.organizationId}::uuid,
        employee_id = ${progress.employeeId}::uuid,
        contact_id = ${progress.contactId ?? null}::uuid,
        project_id = ${progress.projectId}::uuid,
        change_order_id = ${progress.changeOrderId}::uuid,
        parsed = ${JSON.stringify(progress.parsed)}::jsonb,
        rejection_reason = NULL
      WHERE id = ${id}::uuid AND status = 'RECEIVED'
      RETURNING id
    `);
    if (!result.rows[0]) throw new AppError('NOT_FOUND');
  }

  /**
   * Claims an unfinished message for one processor. `processed_at` doubles as
   * a short lease while status remains RECEIVED; terminal outcomes retain it
   * as their completion timestamp. A dead worker's lease can be reclaimed.
   */
  async claimForProcessing(tx: TransactionContext, id: string): Promise<boolean> {
    const result = await tx.db.execute<{ id: string }>(sql`
      UPDATE inbound_messages
         SET processed_at = now()
       WHERE id = ${id}::uuid
         AND status = 'RECEIVED'
         AND (processed_at IS NULL OR processed_at < now() - interval '5 minutes')
       RETURNING id
    `);
    return result.rows.length > 0;
  }

  /** Keep a transient failure retryable while retaining its operator-visible cause. */
  async recordRetryableError(tx: TransactionContext, id: string, reason: string): Promise<void> {
    const result = await tx.db.execute<{ id: string }>(sql`
      UPDATE inbound_messages
         SET rejection_reason = ${reason}, processed_at = NULL
       WHERE id = ${id}::uuid AND status = 'RECEIVED'
       RETURNING id
    `);
    if (!result.rows[0]) throw new AppError('NOT_FOUND');
  }

  /**
   * Links a downloaded attachment to the message it arrived on.
   *
   * Idempotent on `(inbound_message_id, provider_media_id)`: a redelivered
   * webhook must not produce a second copy of the same photograph. Returns
   * false when the attachment was already linked, so the caller can skip the
   * download rather than repeat it.
   *
   * Takes an explicit `organizationId` rather than a `TenantContext` because
   * the caller has just resolved the tenant from the employee and there is no
   * request context in a worker job — the same reason `record` above takes
   * none.
   */
  async linkMedia(
    tx: TransactionContext,
    input: {
      inboundMessageId: string;
      fileObjectId: string;
      organizationId: string;
      providerMediaId: string;
    },
  ): Promise<boolean> {
    const result = await tx.db.execute<{ file_object_id: string }>(sql`
      INSERT INTO inbound_message_media
        (inbound_message_id, file_object_id, organization_id, provider_media_id)
      VALUES (
        ${input.inboundMessageId}::uuid, ${input.fileObjectId}::uuid,
        ${input.organizationId}::uuid, ${input.providerMediaId}
      )
      ON CONFLICT DO NOTHING
      RETURNING file_object_id
    `);
    return result.rows.length > 0;
  }

  /** Provider attachment ids already fetched for a message. */
  async linkedMediaIds(db: Database, inboundMessageId: string): Promise<Set<string>> {
    const result = await db.execute<{ provider_media_id: string }>(sql`
      SELECT provider_media_id FROM inbound_message_media
      WHERE inbound_message_id = ${inboundMessageId}::uuid
    `);
    return new Set(result.rows.map((r) => r.provider_media_id));
  }

  /**
   * Records the outcome of processing: which tenant it turned out to belong to,
   * what the parser understood, what we replied, and whether it produced a
   * change order.
   *
   * Takes no `TenantContext` for the same reason as `record`: the organization
   * being written here is the *result* of resolving the sender, not a scope the
   * caller may choose. A rejected message keeps a null organization.
   */
  async markProcessed(
    tx: TransactionContext,
    id: string,
    outcome: {
      status: InboundStatus;
      organizationId?: string | null;
      employeeId?: string | null;
      contactId?: string | null;
      projectId?: string | null;
      changeOrderId?: string | null;
      documentId?: string | null;
      parsed?: Record<string, unknown> | null;
      rejectionReason?: string | null;
      replyText?: string | null;
    },
  ): Promise<InboundMessageRow> {
    const result = await tx.db.execute<InboundRecord>(sql`
      UPDATE inbound_messages SET
        status = ${outcome.status}::inbound_status,
        organization_id = ${outcome.organizationId ?? null}::uuid,
        employee_id = ${outcome.employeeId ?? null}::uuid,
        contact_id = ${outcome.contactId ?? null}::uuid,
        document_id = ${outcome.documentId ?? null}::uuid,
        project_id = ${outcome.projectId ?? null}::uuid,
        change_order_id = ${outcome.changeOrderId ?? null}::uuid,
        parsed = ${outcome.parsed ? JSON.stringify(outcome.parsed) : null}::jsonb,
        rejection_reason = ${outcome.rejectionReason ?? null},
        reply_text = ${outcome.replyText ?? null},
        processed_at = now()
      WHERE id = ${id}::uuid
      RETURNING ${INBOUND_COLUMNS_BARE}
    `);
    const row = result.rows[0];
    if (!row) throw new AppError('NOT_FOUND');
    return mapInbound(row);
  }

  /**
   * Re-files a message the sender corrected with a one-word REQUEST / FILE
   * reply (spec 2026-10-12, D6): the outcome changes, the message and the
   * reply it originally got do not. Tenant-scoped: by the time anyone can
   * correct a message it belongs to a workspace.
   */
  async refile(
    tx: TransactionContext,
    ctx: TenantContext,
    id: string,
    outcome: {
      status: 'ACCEPTED' | 'SAVED';
      changeOrderId: string | null;
      documentId: string | null;
    },
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE inbound_messages SET
        status = ${outcome.status}::inbound_status,
        change_order_id = COALESCE(${outcome.changeOrderId}::uuid, change_order_id),
        document_id = ${outcome.documentId}::uuid
      WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
  }

  /** Links a held message to the answer that resolved its project choice. */
  async markResolvedBy(tx: TransactionContext, id: string, answerId: string): Promise<void> {
    await tx.db.execute(sql`
      UPDATE inbound_messages SET resolved_by_inbound_message_id = ${answerId}::uuid
      WHERE id = ${id}::uuid
    `);
  }

  /**
   * Sets the document a message was filed as, once the worker has stored its
   * first attachment. Only fills an empty slot: a text note filed at intake
   * time stays the message's document.
   */
  async setDocumentIfEmpty(
    tx: TransactionContext,
    ctx: TenantContext,
    id: string,
    documentId: string,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE inbound_messages SET document_id = ${documentId}::uuid
      WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
        AND document_id IS NULL
    `);
  }

  /**
   * The intake's own read of one message, before or regardless of its
   * tenant. Like `record`, it takes no TenantContext: the intake reads the row
   * to *find out* which tenant it resolved to (or that it resolved to none),
   * and the worker uses it to decide where a message's media belongs.
   */
  async findForIntake(db: Database, id: string): Promise<InboundMessageRow | null> {
    const result = await db.execute<InboundRecord>(sql`
      SELECT ${INBOUND_COLUMNS_BARE} FROM inbound_messages WHERE id = ${id}::uuid
    `);
    const row = result.rows[0];
    return row ? mapInbound(row) : null;
  }

  /** Held messages that this answer resolved, for fetching their media. */
  async listResolvedBy(db: Database, answerId: string): Promise<string[]> {
    const result = await db.execute<{ id: string }>(sql`
      SELECT id FROM inbound_messages WHERE resolved_by_inbound_message_id = ${answerId}::uuid
    `);
    return result.rows.map((r) => r.id);
  }

  async findById(ctx: TenantContext, id: string): Promise<InboundMessageRow | null> {
    const result = await this.db.execute<InboundRecord>(sql`
      SELECT ${INBOUND_COLUMNS_ALIASED}, e.name AS employee_name, p.title AS project_title,
             c.name AS contact_name
      FROM inbound_messages im
      LEFT JOIN employees e
        ON e.id = im.employee_id AND e.organization_id = im.organization_id
      LEFT JOIN projects p
        ON p.id = im.project_id AND p.organization_id = im.organization_id
      LEFT JOIN contacts c
        ON c.id = im.contact_id AND c.organization_id = im.organization_id
      WHERE im.id = ${id}::uuid AND im.organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapInbound(row) : null;
  }

  async requireById(ctx: TenantContext, id: string): Promise<InboundMessageRow> {
    const row = await this.findById(ctx, id);
    if (!row) throw new AppError('NOT_FOUND');
    return row;
  }

  /**
   * The owner's "every request ever filed" view, including the rejected ones.
   * Newest first, keyset-paginated on `(received_at, id)`.
   */
  async list(
    ctx: TenantContext,
    options: {
      status?: InboundStatus;
      employeeId?: string;
      unresolvedOnly?: boolean;
      cursor?: { receivedAt: string; id: string };
      limit: number;
    },
  ): Promise<{
    items: InboundMessageRow[];
    nextCursor: { receivedAt: string; id: string } | null;
  }> {
    const result = await this.db.execute<InboundRecord>(sql`
      SELECT ${INBOUND_COLUMNS_ALIASED}, e.name AS employee_name, p.title AS project_title,
             c.name AS contact_name
      FROM inbound_messages im
      LEFT JOIN employees e
        ON e.id = im.employee_id AND e.organization_id = im.organization_id
      LEFT JOIN projects p
        ON p.id = im.project_id AND p.organization_id = im.organization_id
      LEFT JOIN contacts c
        ON c.id = im.contact_id AND c.organization_id = im.organization_id
      WHERE im.organization_id = ${ctx.organizationId}::uuid
        ${options.status ? sql`AND im.status = ${options.status}::inbound_status` : sql``}
        ${options.employeeId ? sql`AND im.employee_id = ${options.employeeId}::uuid` : sql``}
        ${
          // Filed as a document or note, or answered as a command, is as
          // resolved as a request that was raised (spec 2026-10-12, D6).
          options.unresolvedOnly
            ? sql`AND im.status NOT IN ('ACCEPTED', 'SAVED', 'ANSWERED')`
            : sql``
        }
        ${
          options.cursor
            ? sql`AND (im.received_at, im.id) < (${options.cursor.receivedAt}::timestamptz, ${options.cursor.id}::uuid)`
            : sql``
        }
      ORDER BY im.received_at DESC, im.id DESC
      LIMIT ${options.limit + 1}
    `);

    const rows = result.rows.slice(0, options.limit);
    const hasMore = result.rows.length > options.limit;
    const last = rows[rows.length - 1];
    return {
      items: rows.map(mapInbound),
      nextCursor:
        hasMore && last
          ? { receivedAt: toDate(last.received_at).toISOString(), id: last.id }
          : null,
    };
  }

  /**
   * Messages that could not be attributed to any tenant — an unknown number
   * texted the business line. Platform-operator view, so it takes no tenant:
   * there is no organization these belong to. It is never reachable from a
   * tenant-scoped API route.
   */
  async listUnattributed(limit = 100): Promise<InboundMessageRow[]> {
    const result = await this.db.execute<InboundRecord>(sql`
      SELECT ${INBOUND_COLUMNS_BARE}
      FROM inbound_messages
      WHERE organization_id IS NULL
      ORDER BY received_at DESC, id DESC
      LIMIT ${limit}
    `);
    return result.rows.map(mapInbound);
  }

  /** Recent messages from one number, used to rate-limit a chatty sender. */
  async countRecentFromPhone(phoneE164: string, since: Date): Promise<number> {
    const result = await this.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM inbound_messages
      WHERE from_phone_e164 = ${phoneE164} AND received_at >= ${since.toISOString()}::timestamptz
    `);
    return toInt(result.rows[0]?.count, 0);
  }
}

const INBOUND_COLUMNS_BARE = sql`
  id, organization_id, employee_id, contact_id, document_id, project_id, change_order_id, provider,
  provider_account_id, provider_message_id, from_phone_e164, body, media_count, status, parsed,
  rejection_reason, reply_text, received_at, processed_at, media_refs,
  resolved_by_inbound_message_id
`;

const INBOUND_COLUMNS_ALIASED = sql`
  im.id, im.organization_id, im.employee_id, im.contact_id, im.document_id, im.project_id,
  im.change_order_id, im.provider,
  im.provider_account_id, im.provider_message_id, im.from_phone_e164, im.body, im.media_count,
  im.status, im.parsed,
  im.rejection_reason, im.reply_text, im.received_at, im.processed_at, im.media_refs,
  im.resolved_by_inbound_message_id
`;

type InboundRecord = {
  id: string;
  organization_id: string | null;
  employee_id: string | null;
  contact_id: string | null;
  document_id: string | null;
  project_id: string | null;
  change_order_id: string | null;
  provider: string;
  provider_account_id: string | null;
  provider_message_id: string;
  from_phone_e164: string;
  body: string | null;
  media_count: number;
  status: InboundStatus;
  parsed: Record<string, unknown> | null;
  rejection_reason: string | null;
  reply_text: string | null;
  received_at: Date;
  processed_at: Date | null;
  media_refs: unknown;
  resolved_by_inbound_message_id: string | null;
  employee_name?: string | null;
  project_title?: string | null;
  contact_name?: string | null;
};

function mapInbound(row: InboundRecord): InboundMessageRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    employeeId: row.employee_id,
    contactId: row.contact_id,
    documentId: row.document_id,
    mediaRefs: Array.isArray(row.media_refs) ? (row.media_refs as StoredMediaRef[]) : [],
    resolvedByInboundMessageId: row.resolved_by_inbound_message_id,
    projectId: row.project_id,
    changeOrderId: row.change_order_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    providerMessageId: row.provider_message_id,
    fromPhoneE164: row.from_phone_e164,
    body: row.body,
    mediaCount: toInt(row.media_count, 0),
    status: row.status,
    parsed: toJsonOrNull(row.parsed),
    rejectionReason: row.rejection_reason,
    replyText: row.reply_text,
    receivedAt: toDate(row.received_at),
    processedAt: toDateOrNull(row.processed_at),
    employeeName: row.employee_name ?? null,
    projectTitle: row.project_title ?? null,
    contactName: row.contact_name ?? null,
  };
}

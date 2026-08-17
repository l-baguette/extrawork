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
  | 'ACCEPTED';

export interface InboundMessageRow {
  id: string;
  organizationId: string | null;
  employeeId: string | null;
  projectId: string | null;
  changeOrderId: string | null;
  provider: string;
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
   * Idempotent on `(provider, provider_message_id)`. WhatsApp redelivers, and a
   * redelivery must not produce a second change order — so a repeat returns the
   * existing row untouched and the caller can see it was already handled by its
   * `status`.
   */
  async record(
    tx: TransactionContext,
    input: {
      provider?: string;
      providerMessageId: string;
      fromPhoneE164: string;
      body: string | null;
      mediaCount?: number;
    },
  ): Promise<{ row: InboundMessageRow; alreadySeen: boolean }> {
    const provider = input.provider ?? 'whatsapp';
    const result = await tx.db.execute<InboundRecord>(sql`
      INSERT INTO inbound_messages (
        id, provider, provider_message_id, from_phone_e164, body, media_count
      ) VALUES (
        ${newId()}::uuid, ${provider}, ${input.providerMessageId},
        ${input.fromPhoneE164}, ${input.body}, ${input.mediaCount ?? 0}
      )
      ON CONFLICT (provider, provider_message_id) DO NOTHING
      RETURNING ${INBOUND_COLUMNS_BARE}
    `);

    const inserted = result.rows[0];
    if (inserted) return { row: mapInbound(inserted), alreadySeen: false };

    const existing = await tx.db.execute<InboundRecord>(sql`
      SELECT ${INBOUND_COLUMNS_BARE}
      FROM inbound_messages
      WHERE provider = ${provider} AND provider_message_id = ${input.providerMessageId}
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
      projectId?: string | null;
      changeOrderId?: string | null;
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

  async findById(ctx: TenantContext, id: string): Promise<InboundMessageRow | null> {
    const result = await this.db.execute<InboundRecord>(sql`
      SELECT ${INBOUND_COLUMNS_ALIASED}, e.name AS employee_name, p.title AS project_title
      FROM inbound_messages im
      LEFT JOIN employees e
        ON e.id = im.employee_id AND e.organization_id = im.organization_id
      LEFT JOIN projects p
        ON p.id = im.project_id AND p.organization_id = im.organization_id
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
      SELECT ${INBOUND_COLUMNS_ALIASED}, e.name AS employee_name, p.title AS project_title
      FROM inbound_messages im
      LEFT JOIN employees e
        ON e.id = im.employee_id AND e.organization_id = im.organization_id
      LEFT JOIN projects p
        ON p.id = im.project_id AND p.organization_id = im.organization_id
      WHERE im.organization_id = ${ctx.organizationId}::uuid
        ${options.status ? sql`AND im.status = ${options.status}::inbound_status` : sql``}
        ${options.employeeId ? sql`AND im.employee_id = ${options.employeeId}::uuid` : sql``}
        ${options.unresolvedOnly ? sql`AND im.status <> 'ACCEPTED'` : sql``}
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
  id, organization_id, employee_id, project_id, change_order_id, provider,
  provider_message_id, from_phone_e164, body, media_count, status, parsed,
  rejection_reason, reply_text, received_at, processed_at
`;

const INBOUND_COLUMNS_ALIASED = sql`
  im.id, im.organization_id, im.employee_id, im.project_id, im.change_order_id, im.provider,
  im.provider_message_id, im.from_phone_e164, im.body, im.media_count, im.status, im.parsed,
  im.rejection_reason, im.reply_text, im.received_at, im.processed_at
`;

type InboundRecord = {
  id: string;
  organization_id: string | null;
  employee_id: string | null;
  project_id: string | null;
  change_order_id: string | null;
  provider: string;
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
  employee_name?: string | null;
  project_title?: string | null;
};

function mapInbound(row: InboundRecord): InboundMessageRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    employeeId: row.employee_id,
    projectId: row.project_id,
    changeOrderId: row.change_order_id,
    provider: row.provider,
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
  };
}

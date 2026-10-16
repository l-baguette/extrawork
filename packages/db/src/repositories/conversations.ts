import { sql } from 'drizzle-orm';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull, toJsonOrNull } from '../row-types.js';
import { runInScope, SYSTEM_SCOPE } from '../tenant-scope.js';

/**
 * WhatsApp conversation state (migration 0023) — spec 2026-10-12, D6.
 *
 * One row per phone number, holding what the intake needs to remember between
 * two messages from the same person:
 *
 *   pending    a message held until the sender says which project it is for;
 *   sticky     the project they last used, so a follow-up needs no project name;
 *   last item  what their last message became, for the one-word REQUEST / FILE
 *              correction.
 *
 * The row is keyed by phone and carries no organization, because a sender is
 * not tied to one workspace: a foreman may work for two design firms and a
 * homeowner may have hired both. That makes this cross-tenant routing state by
 * nature, readable only under the system scope (the table's RLS policy admits
 * nothing else). The plain reads below declare `SYSTEM_SCOPE` themselves; the
 * transactional methods cannot, because a transaction's scope is fixed when it
 * opens, so they rely on the intake opening its transactions inside
 * `runInScope(SYSTEM_SCOPE, …)` — which `IntakeService.handleInbound` does.
 *
 * Nothing in here is evidence. It is a convenience cache over facts recorded
 * elsewhere (inbound messages, change orders, documents); losing a row costs
 * the sender one extra "which project?" question, never a record.
 */

/** One project a sender may be talking about, with who they are on it. */
export interface ConversationCandidate {
  organizationId: string;
  projectId: string;
  projectNumber: string;
  title: string;
  /** How the sender is known in that workspace. */
  sender: { kind: 'EMPLOYEE' | 'CONTACT'; id: string };
}

export interface PendingChoice {
  /** The held message, processed once the sender answers. */
  inboundMessageId: string;
  /** In the order they were listed in the question, so "2" means the second. */
  candidates: ConversationCandidate[];
}

export interface LastItem {
  inboundMessageId: string;
  organizationId: string;
  projectId: string;
  kind: 'REQUEST' | 'CONTENT';
  /** Set when the item became (or was converted into) a request. */
  changeOrderId: string | null;
  sender: { kind: 'EMPLOYEE' | 'CONTACT'; id: string };
  at: string;
}

export interface ConversationRow {
  id: string;
  phoneE164: string;
  pending: PendingChoice | null;
  pendingExpiresAt: Date | null;
  stickyOrganizationId: string | null;
  stickyProjectId: string | null;
  stickyUntil: Date | null;
  lastItem: LastItem | null;
  updatedAt: Date;
}

export class ConversationRepository {
  constructor(readonly db: Database) {}

  async findByPhone(phoneE164: string, db: Database = this.db): Promise<ConversationRow | null> {
    const result = await runInScope(SYSTEM_SCOPE, () =>
      db.execute<ConversationRecord>(sql`
        SELECT ${COLUMNS} FROM whatsapp_conversations WHERE phone_e164 = ${phoneE164}
      `),
    );
    const row = result.rows[0];
    return row ? mapConversation(row) : null;
  }

  /**
   * Locks (creating if needed) the sender's row for the rest of the
   * transaction. Two messages from one phone processed at once — a photo and
   * its caption arrive as separate webhooks — must see one order, or the
   * second could answer a question the first has not asked yet.
   */
  async lockForPhone(tx: TransactionContext, phoneE164: string): Promise<ConversationRow> {
    await tx.db.execute(sql`
      INSERT INTO whatsapp_conversations (id, phone_e164)
      VALUES (${newId()}::uuid, ${phoneE164})
      ON CONFLICT (phone_e164) DO NOTHING
    `);
    const result = await tx.db.execute<ConversationRecord>(sql`
      SELECT ${COLUMNS} FROM whatsapp_conversations
      WHERE phone_e164 = ${phoneE164}
      FOR UPDATE
    `);
    const row = result.rows[0];
    if (!row) throw new Error('whatsapp_conversations row missing after upsert');
    return mapConversation(row);
  }

  async setPending(
    tx: TransactionContext,
    phoneE164: string,
    pending: PendingChoice,
    expiresAt: Date,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE whatsapp_conversations
      SET pending = ${JSON.stringify(pending)}::jsonb,
          pending_expires_at = ${expiresAt.toISOString()}::timestamptz
      WHERE phone_e164 = ${phoneE164}
    `);
  }

  async clearPending(tx: TransactionContext, phoneE164: string): Promise<void> {
    await tx.db.execute(sql`
      UPDATE whatsapp_conversations SET pending = NULL, pending_expires_at = NULL
      WHERE phone_e164 = ${phoneE164}
    `);
  }

  /**
   * Records where the last message went: it becomes the sticky project for the
   * next `stickyUntil`, and the item a REQUEST / FILE reply would correct.
   */
  async recordItem(
    tx: TransactionContext,
    phoneE164: string,
    item: LastItem,
    stickyUntil: Date,
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE whatsapp_conversations
      SET last_item = ${JSON.stringify(item)}::jsonb,
          sticky_organization_id = ${item.organizationId}::uuid,
          sticky_project_id = ${item.projectId}::uuid,
          sticky_until = ${stickyUntil.toISOString()}::timestamptz
      WHERE phone_e164 = ${phoneE164}
    `);
  }

  /** Choices nobody answered in time, oldest first, for the hourly sweep. */
  async listExpiredPending(now: Date, limit = 100): Promise<ConversationRow[]> {
    const result = await runInScope(SYSTEM_SCOPE, () =>
      this.db.execute<ConversationRecord>(sql`
        SELECT ${COLUMNS} FROM whatsapp_conversations
        WHERE pending IS NOT NULL AND pending_expires_at <= ${now.toISOString()}::timestamptz
        ORDER BY pending_expires_at
        LIMIT ${limit}
      `),
    );
    return result.rows.map(mapConversation);
  }
}

const COLUMNS = sql`
  id, phone_e164, pending, pending_expires_at, sticky_organization_id, sticky_project_id,
  sticky_until, last_item, updated_at
`;

type ConversationRecord = {
  id: string;
  phone_e164: string;
  pending: unknown;
  pending_expires_at: Date | string | null;
  sticky_organization_id: string | null;
  sticky_project_id: string | null;
  sticky_until: Date | string | null;
  last_item: unknown;
  updated_at: Date | string;
};

function mapConversation(row: ConversationRecord): ConversationRow {
  return {
    id: row.id,
    phoneE164: row.phone_e164,
    pending: toJsonOrNull<PendingChoice>(row.pending),
    pendingExpiresAt: toDateOrNull(row.pending_expires_at),
    stickyOrganizationId: row.sticky_organization_id,
    stickyProjectId: row.sticky_project_id,
    stickyUntil: toDateOrNull(row.sticky_until),
    lastItem: toJsonOrNull<LastItem>(row.last_item),
    updatedAt: toDate(row.updated_at),
  };
}

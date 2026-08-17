import { sql } from 'drizzle-orm';
import type { ScheduledReminder } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate } from '../row-types.js';

/**
 * Reminder schedule persistence — report §8.6.
 *
 * The dedupe key is `UNIQUE`, so re-running the scheduler after a retry cannot
 * create a second reminder for the same step and channel.
 */

export interface DueReminder {
  id: string;
  organizationId: string;
  versionId: string;
  policyStep: number;
  channel: string;
  dedupeKey: string;
  dueAt: Date;
}

export class ReminderRepository {
  constructor(private readonly db: Database) {}

  async schedule(
    tx: TransactionContext,
    organizationId: string,
    versionId: string,
    channel: string,
    reminders: readonly ScheduledReminder[],
  ): Promise<number> {
    let inserted = 0;
    for (const reminder of reminders) {
      const result = await tx.db.execute(sql`
        INSERT INTO reminder_schedules
          (id, organization_id, version_id, policy_step, channel, dedupe_key, due_at)
        VALUES (
          ${newId()}::uuid, ${organizationId}::uuid, ${versionId}::uuid,
          ${reminder.policyStep}, ${channel}, ${reminder.dedupeKey},
          ${reminder.dueAt.toISOString()}::timestamptz
        )
        ON CONFLICT (dedupe_key) DO NOTHING
      `);
      inserted += result.rowCount ?? 0;
    }
    return inserted;
  }

  async findDue(db: Database, limit: number): Promise<DueReminder[]> {
    const result = await db.execute<{
      id: string;
      organization_id: string;
      version_id: string;
      policy_step: number;
      channel: string;
      dedupe_key: string;
      due_at: Date;
    }>(sql`
      SELECT id, organization_id, version_id, policy_step, channel, dedupe_key, due_at
      FROM reminder_schedules
      WHERE sent_at IS NULL AND suppressed_reason IS NULL AND due_at <= now()
      ORDER BY due_at
      LIMIT ${limit}
    `);
    return result.rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      versionId: r.version_id,
      policyStep: r.policy_step,
      channel: r.channel,
      dedupeKey: r.dedupe_key,
      dueAt: toDate(r.due_at),
    }));
  }

  async markSent(db: Database, id: string): Promise<void> {
    await db.execute(sql`
      UPDATE reminder_schedules SET sent_at = now() WHERE id = ${id}::uuid
    `);
  }

  /** Suppression is recorded, not deleted, so the reason stays auditable. */
  async markSuppressed(db: Database, id: string, reason: string): Promise<void> {
    await db.execute(sql`
      UPDATE reminder_schedules SET suppressed_reason = ${reason} WHERE id = ${id}::uuid
    `);
  }

  /** Outside local hours or in cooldown: try again later rather than drop. */
  async defer(db: Database, id: string, retryAt: Date): Promise<void> {
    await db.execute(sql`
      UPDATE reminder_schedules SET due_at = ${retryAt.toISOString()}::timestamptz
      WHERE id = ${id}::uuid
    `);
  }

  async cancelForVersion(
    tx: TransactionContext,
    versionId: string,
    reason: string,
  ): Promise<number> {
    const result = await tx.db.execute(sql`
      UPDATE reminder_schedules SET suppressed_reason = ${reason}
      WHERE version_id = ${versionId}::uuid AND sent_at IS NULL AND suppressed_reason IS NULL
    `);
    return result.rowCount ?? 0;
  }
}

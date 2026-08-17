import { sql } from 'drizzle-orm';
import type { OutboxTopic } from '@extrawork/contracts';
import type { Database, TransactionContext } from './client.js';
import { newId } from './ids.js';

/**
 * Transactional outbox — report §13.2.
 *
 * "Every external side effect originates as an outbox_events row committed with
 * the domain change." Nothing in this module calls a provider; the worker
 * leases rows after the commit, which is what keeps report §7.6 ("do not keep
 * database transactions open while calling external providers") true by
 * construction.
 */

export interface OutboxEventInput {
  topic: OutboxTopic | string;
  aggregateId: string;
  organizationId: string | null;
  payload: Record<string, unknown>;
  /** Delay before the worker may pick it up. */
  availableAt?: Date;
}

export interface OutboxRow {
  id: string;
  organizationId: string | null;
  topic: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  createdAt: Date;
}

/** MUST be called with the transaction's db handle, never the pool. */
export async function publishOutbox(
  tx: TransactionContext,
  events: OutboxEventInput | OutboxEventInput[],
): Promise<string[]> {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return [];

  const ids: string[] = [];
  for (const event of list) {
    const id = newId();
    ids.push(id);
    await tx.db.execute(sql`
      INSERT INTO outbox_events (id, organization_id, topic, aggregate_id, payload, available_at)
      VALUES (
        ${id}::uuid,
        ${event.organizationId}::uuid,
        ${event.topic},
        ${event.aggregateId}::uuid,
        ${JSON.stringify(event.payload)}::jsonb,
        ${(event.availableAt ?? new Date()).toISOString()}::timestamptz
      )
    `);
  }
  return ids;
}

/**
 * Leases a batch with `FOR UPDATE SKIP LOCKED` (report §7.8, §13.4) so several
 * worker replicas can drain the outbox without contending.
 */
export async function leaseOutboxBatch(
  db: Database,
  options: { limit: number; leaseSeconds: number },
): Promise<OutboxRow[]> {
  const result = await db.execute<{
    id: string;
    organization_id: string | null;
    topic: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
    attempt_count: number;
    created_at: Date;
  }>(sql`
    WITH claimed AS (
      SELECT id
      FROM outbox_events
      WHERE published_at IS NULL
        AND dead_lettered_at IS NULL
        AND available_at <= now()
        AND (leased_until IS NULL OR leased_until < now())
      ORDER BY available_at, created_at
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events o
       SET leased_until = now() + make_interval(secs => ${options.leaseSeconds}),
           attempt_count = o.attempt_count + 1
      FROM claimed
     WHERE o.id = claimed.id
    RETURNING o.id, o.organization_id, o.topic, o.aggregate_id, o.payload,
              o.attempt_count, o.created_at
  `);

  return result.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    topic: r.topic,
    aggregateId: r.aggregate_id,
    payload: r.payload,
    attemptCount: r.attempt_count,
    createdAt: r.created_at,
  }));
}

export async function markOutboxPublished(db: Database, id: string): Promise<void> {
  await db.execute(sql`
    UPDATE outbox_events
       SET published_at = now(), leased_until = NULL, last_error_code = NULL
     WHERE id = ${id}::uuid
  `);
}

/**
 * Records a failure and schedules the retry. Once attempts are exhausted the
 * row is dead-lettered with its payload preserved (report §13.4).
 */
export async function markOutboxFailed(
  db: Database,
  id: string,
  errorCode: string,
  retryDelaySeconds: number | null,
): Promise<'RETRY' | 'DEAD_LETTER'> {
  if (retryDelaySeconds === null) {
    await db.execute(sql`
      UPDATE outbox_events
         SET dead_lettered_at = now(), leased_until = NULL,
             last_error_code = ${errorCode}, last_error_at = now()
       WHERE id = ${id}::uuid
    `);
    return 'DEAD_LETTER';
  }
  await db.execute(sql`
    UPDATE outbox_events
       SET available_at = now() + make_interval(secs => ${retryDelaySeconds}),
           leased_until = NULL,
           last_error_code = ${errorCode},
           last_error_at = now()
     WHERE id = ${id}::uuid
  `);
  return 'RETRY';
}

/** Feeds the "age of oldest critical outbox event" SLI (report §13.5). */
export async function oldestUnpublishedAgeSeconds(db: Database): Promise<number> {
  const result = await db.execute<{ age: string | null }>(sql`
    SELECT EXTRACT(EPOCH FROM (now() - min(created_at)))::text AS age
    FROM outbox_events
    WHERE published_at IS NULL AND dead_lettered_at IS NULL
  `);
  const raw = result.rows[0]?.age;
  return raw ? Number.parseFloat(raw) : 0;
}

/** Operator replay of a dead-lettered event (report §13.6). */
export async function replayOutboxEvent(db: Database, id: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE outbox_events
       SET dead_lettered_at = NULL, published_at = NULL, available_at = now(),
           attempt_count = 0, leased_until = NULL
     WHERE id = ${id}::uuid AND published_at IS NULL
  `);
  return (result.rowCount ?? 0) > 0;
}

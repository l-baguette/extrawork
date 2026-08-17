import { sql } from 'drizzle-orm';
import type { ActorType } from '@extrawork/contracts';
import {
  chainEvents,
  verifyChain,
  type AuditEventInput,
  type ChainedAuditEvent,
  type ChainVerificationResult,
  type TenantContext,
} from '@extrawork/domain';
import type { Database, TransactionContext } from './../client.js';
import { newId } from '../ids.js';
import { toBuffer, toDate } from '../row-types.js';

/**
 * Audit writer — report §14.3 `AuditWriter.append(tx, events)` and §8.5.
 *
 * Always called inside the domain transaction, so the event and the state
 * change it describes commit together (report §7.5).
 *
 * The chain tail is read `FOR UPDATE` on the aggregate's latest row, which
 * serialises concurrent appends to the same aggregate and guarantees a gapless
 * sequence. Different aggregates never block each other.
 */

export interface AuditWriter {
  append(
    tx: TransactionContext,
    ctx: TenantContext,
    events: AuditEventInput[],
  ): Promise<ChainedAuditEvent[]>;
}

interface ChainTail {
  sequence: number;
  eventHash: Buffer;
}

async function lockChainTail(
  tx: TransactionContext,
  aggregateType: string,
  aggregateId: string,
): Promise<ChainTail | null> {
  const result = await tx.db.execute<{ sequence: string; event_hash: Buffer }>(sql`
    SELECT sequence, event_hash
    FROM audit_events
    WHERE aggregate_type = ${aggregateType} AND aggregate_id = ${aggregateId}::uuid
    ORDER BY sequence DESC
    LIMIT 1
    FOR UPDATE
  `);
  const row = result.rows[0];
  if (!row) return null;
  return { sequence: Number(row.sequence), eventHash: toBuffer(row.event_hash) };
}

export class PostgresAuditWriter implements AuditWriter {
  async append(
    tx: TransactionContext,
    ctx: TenantContext,
    events: AuditEventInput[],
  ): Promise<ChainedAuditEvent[]> {
    if (events.length === 0) return [];

    // Group by aggregate so each chain is extended under its own tail lock.
    const byAggregate = new Map<string, AuditEventInput[]>();
    for (const event of events) {
      const key = `${event.aggregateType}:${event.aggregateId}`;
      const list = byAggregate.get(key);
      if (list) list.push(event);
      else byAggregate.set(key, [event]);
    }

    const written: ChainedAuditEvent[] = [];

    // Sorted so two transactions touching the same pair of aggregates always
    // take the locks in the same order and cannot deadlock.
    for (const key of [...byAggregate.keys()].sort()) {
      const group = byAggregate.get(key) as AuditEventInput[];
      const first = group[0] as AuditEventInput;
      const tail = await lockChainTail(tx, first.aggregateType, first.aggregateId);
      const chained = chainEvents(group, tail);

      for (const event of chained) {
        await tx.db.execute(sql`
          INSERT INTO audit_events
            (id, organization_id, project_id, aggregate_type, aggregate_id, sequence,
             event_type, actor_type, actor_id, payload, occurred_at, previous_hash, event_hash)
          VALUES (
            ${newId()}::uuid,
            ${ctx.organizationId}::uuid,
            ${event.projectId ?? null}::uuid,
            ${event.aggregateType},
            ${event.aggregateId}::uuid,
            ${event.sequence},
            ${event.eventType},
            ${event.actorType}::actor_type,
            ${event.actorId},
            ${JSON.stringify(event.payload)}::jsonb,
            ${event.occurredAt.toISOString()}::timestamptz,
            ${event.previousHash},
            ${event.eventHash}
          )
        `);
        written.push(event);
      }
    }

    return written;
  }
}

export interface AuditEventRow extends ChainedAuditEvent {
  id: string;
  organizationId: string;
}

export async function readChain(
  db: Database,
  ctx: TenantContext,
  aggregateType: string,
  aggregateId: string,
): Promise<AuditEventRow[]> {
  const result = await db.execute<{
    id: string;
    organization_id: string;
    project_id: string | null;
    aggregate_type: string;
    aggregate_id: string;
    sequence: string;
    event_type: string;
    actor_type: ActorType;
    actor_id: string | null;
    payload: Record<string, unknown>;
    occurred_at: Date;
    previous_hash: Buffer | null;
    event_hash: Buffer;
  }>(sql`
    SELECT id, organization_id, project_id, aggregate_type, aggregate_id, sequence,
           event_type, actor_type, actor_id, payload, occurred_at, previous_hash, event_hash
    FROM audit_events
    WHERE organization_id = ${ctx.organizationId}::uuid
      AND aggregate_type = ${aggregateType}
      AND aggregate_id = ${aggregateId}::uuid
    ORDER BY sequence ASC
  `);

  return result.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    projectId: r.project_id,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    sequence: Number(r.sequence),
    eventType: r.event_type,
    actorType: r.actor_type,
    actorId: r.actor_id,
    payload: r.payload,
    occurredAt: toDate(r.occurred_at),
    previousHash: r.previous_hash ? toBuffer(r.previous_hash) : null,
    eventHash: toBuffer(r.event_hash),
  }));
}

/**
 * Full recomputation of one aggregate's chain. Called by the evidence
 * generator, the nightly integrity job, and after a restore (report §11.6).
 */
export async function verifyAggregateChain(
  db: Database,
  ctx: TenantContext,
  aggregateType: string,
  aggregateId: string,
): Promise<ChainVerificationResult & { eventCount: number; terminalHash: string | null }> {
  const events = await readChain(db, ctx, aggregateType, aggregateId);
  const result = verifyChain(events);
  const terminal = events[events.length - 1];
  return {
    ...result,
    eventCount: events.length,
    terminalHash: terminal ? terminal.eventHash.toString('hex') : null,
  };
}

/** Whole-tenant sweep used by the integrity job. */
export async function listAggregatesForOrganization(
  db: Database,
  organizationId: string,
): Promise<Array<{ aggregateType: string; aggregateId: string }>> {
  const result = await db.execute<{ aggregate_type: string; aggregate_id: string }>(sql`
    SELECT DISTINCT aggregate_type, aggregate_id
    FROM audit_events
    WHERE organization_id = ${organizationId}::uuid
  `);
  return result.rows.map((r) => ({ aggregateType: r.aggregate_type, aggregateId: r.aggregate_id }));
}

export const auditWriter = new PostgresAuditWriter();

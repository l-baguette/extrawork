import { createHash } from 'node:crypto';
import type { ActorType } from '@extrawork/contracts';
import { canonicalize } from '../canonical/jcs.js';

/**
 * Append-only audit chain — report §8.5.
 *
 *   event_hash[0] = SHA256(canonical(event[0]))
 *   event_hash[n] = SHA256(event_hash[n-1] || canonical(event[n]))
 *
 * Scope: one chain per aggregate (`aggregate_type` + `aggregate_id`), with a
 * gapless `sequence`. The evidence manifest pins the terminal event hash.
 *
 * Honest limitation, restated from the report so nobody over-claims: this
 * detects later modification of the stored history. It does not independently
 * prove when a hash existed. External timestamping is a deliberate P2 item.
 */

export interface AuditEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  actorType: ActorType;
  actorId: string | null;
  occurredAt: Date;
  payload: Record<string, unknown>;
  projectId?: string | null;
}

export interface ChainedAuditEvent extends AuditEventInput {
  sequence: number;
  previousHash: Buffer | null;
  eventHash: Buffer;
}

/**
 * The exact object that gets hashed. Only these fields participate: the
 * database row id and insertion time are storage metadata, not history, and
 * including them would make the chain unverifiable after a restore.
 */
export function canonicalEventBody(event: AuditEventInput & { sequence: number }): string {
  return canonicalize({
    actorId: event.actorId,
    actorType: event.actorType,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload as never,
    sequence: event.sequence,
  });
}

export function computeEventHash(
  event: AuditEventInput & { sequence: number },
  previousHash: Buffer | null,
): Buffer {
  const hash = createHash('sha256');
  if (previousHash) hash.update(previousHash);
  hash.update(canonicalEventBody(event), 'utf8');
  return hash.digest();
}

/**
 * Chains a batch of events onto an existing tail. Used inside the domain
 * transaction so that events, domain rows and outbox rows commit together.
 */
export function chainEvents(
  events: readonly AuditEventInput[],
  tail: { sequence: number; eventHash: Buffer } | null,
): ChainedAuditEvent[] {
  let sequence = tail?.sequence ?? 0;
  let previousHash: Buffer | null = tail?.eventHash ?? null;

  return events.map((event) => {
    sequence += 1;
    const withSequence = { ...event, sequence };
    const eventHash = computeEventHash(withSequence, previousHash);
    const chained: ChainedAuditEvent = { ...withSequence, previousHash, eventHash };
    previousHash = eventHash;
    return chained;
  });
}

export interface ChainVerificationResult {
  valid: boolean;
  /** Index of the first event that failed, if any. */
  failedAtSequence: number | null;
  reason: string | null;
}

/**
 * Recomputes an entire chain. Run by the evidence generator, the nightly
 * integrity job, and after a database restore (report §11.6).
 */
export function verifyChain(events: readonly ChainedAuditEvent[]): ChainVerificationResult {
  let previousHash: Buffer | null = null;
  let expectedSequence: number | null = null;

  for (const event of events) {
    if (expectedSequence !== null && event.sequence !== expectedSequence) {
      return {
        valid: false,
        failedAtSequence: event.sequence,
        reason: `Sequence gap: expected ${expectedSequence}, found ${event.sequence}`,
      };
    }
    if (previousHash === null) {
      if (event.previousHash !== null) {
        return {
          valid: false,
          failedAtSequence: event.sequence,
          reason: 'First event in the verified range carries a previous hash but none was supplied',
        };
      }
    } else if (!event.previousHash || !previousHash.equals(event.previousHash)) {
      return {
        valid: false,
        failedAtSequence: event.sequence,
        reason: 'Previous-hash link does not match the preceding event',
      };
    }

    const recomputed = computeEventHash(event, event.previousHash);
    if (!recomputed.equals(event.eventHash)) {
      return {
        valid: false,
        failedAtSequence: event.sequence,
        reason: 'Event hash does not match a recomputation of the event body',
      };
    }

    previousHash = event.eventHash;
    expectedSequence = event.sequence + 1;
  }

  return { valid: true, failedAtSequence: null, reason: null };
}

/** Verifies a slice that starts partway through a chain. */
export function verifyChainFrom(
  events: readonly ChainedAuditEvent[],
  knownPreviousHash: Buffer | null,
): ChainVerificationResult {
  if (events.length === 0) return { valid: true, failedAtSequence: null, reason: null };
  const [first] = events;
  if (!first) return { valid: true, failedAtSequence: null, reason: null };
  if (knownPreviousHash) {
    if (!first.previousHash || !first.previousHash.equals(knownPreviousHash)) {
      return {
        valid: false,
        failedAtSequence: first.sequence,
        reason: 'Chain slice does not attach to the supplied previous hash',
      };
    }
  }
  // Re-run the full walk with the slice's own first previousHash treated as valid.
  let previousHash: Buffer | null = first.previousHash;
  let expectedSequence = first.sequence;
  for (const event of events) {
    if (event.sequence !== expectedSequence) {
      return {
        valid: false,
        failedAtSequence: event.sequence,
        reason: `Sequence gap: expected ${expectedSequence}, found ${event.sequence}`,
      };
    }
    if (event.sequence !== first.sequence) {
      if (!event.previousHash || !previousHash || !previousHash.equals(event.previousHash)) {
        return {
          valid: false,
          failedAtSequence: event.sequence,
          reason: 'Previous-hash link does not match the preceding event',
        };
      }
    }
    if (!computeEventHash(event, event.previousHash).equals(event.eventHash)) {
      return {
        valid: false,
        failedAtSequence: event.sequence,
        reason: 'Event hash does not match a recomputation of the event body',
      };
    }
    previousHash = event.eventHash;
    expectedSequence += 1;
  }
  return { valid: true, failedAtSequence: null, reason: null };
}

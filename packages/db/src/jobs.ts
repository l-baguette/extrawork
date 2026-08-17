import { sql } from 'drizzle-orm';
import {
  JOB_PRIORITY,
  MAX_JOB_ATTEMPTS,
  nextRetryDelaySeconds,
  type JobKind,
} from '@extrawork/contracts';
import type { Database, TransactionContext } from './client.js';
import { newId } from './ids.js';

/**
 * PostgreSQL job queue — ADR-003 and report §13.4.
 *
 * `FOR UPDATE SKIP LOCKED` with a lease timestamp, at-least-once delivery, a
 * dedupe key so repeated enqueues collapse, priorities from report §13.4, and
 * a dead-letter state that preserves the payload.
 */

export interface EnqueueJobInput {
  kind: JobKind;
  organizationId: string | null;
  payload: Record<string, unknown>;
  /** Collapses duplicate intents while the job is PENDING or RUNNING. */
  dedupeKey?: string | null;
  availableAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

export interface JobRow {
  id: string;
  organizationId: string | null;
  kind: JobKind;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  dedupeKey: string | null;
  createdAt: Date;
}

/**
 * Enqueue inside the domain transaction where possible, so the job cannot exist
 * without the change that justified it.
 */
export async function enqueueJob(
  target: TransactionContext | { db: Database },
  input: EnqueueJobInput,
): Promise<string | null> {
  const id = newId();
  const priority = input.priority ?? JOB_PRIORITY[input.kind] ?? 50;

  const result = await target.db.execute<{ id: string }>(sql`
    INSERT INTO job_queue
      (id, organization_id, kind, dedupe_key, payload, priority, available_at, max_attempts)
    VALUES (
      ${id}::uuid,
      ${input.organizationId}::uuid,
      ${input.kind},
      ${input.dedupeKey ?? null},
      ${JSON.stringify(input.payload)}::jsonb,
      ${priority},
      ${(input.availableAt ?? new Date()).toISOString()}::timestamptz,
      ${input.maxAttempts ?? MAX_JOB_ATTEMPTS}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `);

  // A conflict means an identical job is already queued or running. That is the
  // dedupe key doing its job, not an error.
  return result.rows[0]?.id ?? null;
}

export async function claimJobs(
  db: Database,
  options: { limit: number; leaseSeconds: number; workerId: string; kinds?: JobKind[] },
): Promise<JobRow[]> {
  const kindFilter = options.kinds?.length
    ? sql`AND kind = ANY(${sql.raw(`ARRAY[${options.kinds.map((k) => `'${k}'`).join(',')}]`)})`
    : sql``;

  const result = await db.execute<{
    id: string;
    organization_id: string | null;
    kind: JobKind;
    payload: Record<string, unknown>;
    attempt_count: number;
    max_attempts: number;
    dedupe_key: string | null;
    created_at: Date;
  }>(sql`
    WITH claimed AS (
      SELECT id
      FROM job_queue
      WHERE status = 'PENDING'
        AND available_at <= now()
        ${kindFilter}
      ORDER BY priority, available_at
      LIMIT ${options.limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE job_queue j
       SET status = 'RUNNING',
           leased_until = now() + make_interval(secs => ${options.leaseSeconds}),
           leased_by = ${options.workerId},
           attempt_count = j.attempt_count + 1
      FROM claimed
     WHERE j.id = claimed.id
    RETURNING j.id, j.organization_id, j.kind, j.payload, j.attempt_count,
              j.max_attempts, j.dedupe_key, j.created_at
  `);

  return result.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    kind: r.kind,
    payload: r.payload,
    attemptCount: r.attempt_count,
    maxAttempts: r.max_attempts,
    dedupeKey: r.dedupe_key,
    createdAt: r.created_at,
  }));
}

/** Extends the lease for long-running work such as PDFs (report §13.4). */
export async function heartbeatJob(db: Database, id: string, leaseSeconds: number): Promise<void> {
  await db.execute(sql`
    UPDATE job_queue
       SET leased_until = now() + make_interval(secs => ${leaseSeconds})
     WHERE id = ${id}::uuid AND status = 'RUNNING'
  `);
}

export async function completeJob(db: Database, id: string): Promise<void> {
  await db.execute(sql`
    UPDATE job_queue
       SET status = 'COMPLETED', completed_at = now(), leased_until = NULL,
           leased_by = NULL, last_error = NULL
     WHERE id = ${id}::uuid
  `);
}

export async function failJob(
  db: Database,
  job: { id: string; attemptCount: number; maxAttempts: number },
  error: string,
  options: { permanent?: boolean } = {},
): Promise<'RETRY' | 'DEAD_LETTER'> {
  // A permanent failure (validation, policy, a missing aggregate) will fail
  // identically on every attempt, so retrying only delays the operator seeing
  // it — report §7.6: "Do not automatically retry validation, authentication,
  // policy, or permanent provider errors."
  const delay = options.permanent
    ? null
    : job.attemptCount >= job.maxAttempts
      ? null
      : nextRetryDelaySeconds(job.attemptCount);

  if (delay === null) {
    await db.execute(sql`
      UPDATE job_queue
         SET status = 'DEAD_LETTER', leased_until = NULL, leased_by = NULL,
             last_error = ${truncateError(error)}, last_error_at = now()
       WHERE id = ${job.id}::uuid
    `);
    return 'DEAD_LETTER';
  }

  await db.execute(sql`
    UPDATE job_queue
       SET status = 'PENDING',
           available_at = now() + make_interval(secs => ${delay}),
           leased_until = NULL, leased_by = NULL,
           last_error = ${truncateError(error)}, last_error_at = now()
     WHERE id = ${job.id}::uuid
  `);
  return 'RETRY';
}

/**
 * Returns jobs whose lease expired (worker crash) to PENDING. At-least-once
 * semantics mean a handler may therefore run twice, which is why every handler
 * is idempotent (report §13.4).
 */
export async function reclaimExpiredLeases(db: Database): Promise<number> {
  const result = await db.execute(sql`
    UPDATE job_queue
       SET status = 'PENDING', leased_until = NULL, leased_by = NULL
     WHERE status = 'RUNNING' AND leased_until < now()
  `);
  return result.rowCount ?? 0;
}

export interface QueueDepth {
  kind: string;
  pending: number;
  running: number;
  deadLetter: number;
  oldestAvailableSeconds: number;
}

export async function queueDepth(db: Database): Promise<QueueDepth[]> {
  const result = await db.execute<{
    kind: string;
    pending: string;
    running: string;
    dead_letter: string;
    oldest: string | null;
  }>(sql`
    SELECT kind,
           count(*) FILTER (WHERE status = 'PENDING')::text AS pending,
           count(*) FILTER (WHERE status = 'RUNNING')::text AS running,
           count(*) FILTER (WHERE status = 'DEAD_LETTER')::text AS dead_letter,
           EXTRACT(EPOCH FROM (now() - min(available_at) FILTER (WHERE status = 'PENDING')))::text AS oldest
    FROM job_queue
    GROUP BY kind
  `);

  return result.rows.map((r) => ({
    kind: r.kind,
    pending: Number.parseInt(r.pending, 10),
    running: Number.parseInt(r.running, 10),
    deadLetter: Number.parseInt(r.dead_letter, 10),
    oldestAvailableSeconds: r.oldest ? Math.max(0, Number.parseFloat(r.oldest)) : 0,
  }));
}

/** Operator replay of a dead-lettered job (report §13.6). */
export async function replayJob(db: Database, id: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE job_queue
       SET status = 'PENDING', attempt_count = 0, available_at = now(),
           leased_until = NULL, leased_by = NULL
     WHERE id = ${id}::uuid AND status = 'DEAD_LETTER'
  `);
  return (result.rowCount ?? 0) > 0;
}

function truncateError(message: string): string {
  // Dead-letter rows preserve the error but must not become a log of secrets.
  return message.slice(0, 2_000);
}

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '@extrawork/contracts';
import { canonicalize } from '@extrawork/domain';
import type { TransactionContext } from './client.js';
import { newId } from './ids.js';

/**
 * Idempotency records — report §7.6.
 *
 * "Store mutating idempotency records with (scope, actor_or_token_id, key)
 * unique. Persist request hash, status, resource ID, response status, response
 * body, and expiry. If the same key and same request hash repeats, return the
 * stored result. If the key repeats with a different payload, return 409
 * IDEMPOTENCY_KEY_REUSED."
 *
 * `begin` runs inside the caller's transaction, so a replay and the original
 * command can never interleave: the second caller blocks on the row lock and
 * then sees the committed result.
 */

const DEFAULT_TTL_HOURS = 24;

export interface IdempotencyBeginResult {
  id: string;
  replay: boolean;
  /** Present only on a replay of a completed command. */
  response: { status: number; body: unknown; resourceId: string | null } | null;
}

/** The request hash uses the canonical JSON form so key order cannot matter. */
export function hashRequest(payload: unknown): Buffer {
  return createHash('sha256')
    .update(canonicalize(payload ?? null), 'utf8')
    .digest();
}

export async function beginIdempotent(
  tx: TransactionContext,
  params: {
    scope: string;
    subjectId: string;
    key: string;
    payload: unknown;
    ttlHours?: number;
  },
): Promise<IdempotencyBeginResult> {
  const requestHash = hashRequest(params.payload);
  const id = newId();
  const expiresAt = new Date(Date.now() + (params.ttlHours ?? DEFAULT_TTL_HOURS) * 3_600_000);

  // Claim the key. ON CONFLICT DO NOTHING means the winner proceeds and any
  // concurrent caller falls through to the SELECT ... FOR UPDATE below.
  const inserted = await tx.db.execute<{ id: string }>(sql`
    INSERT INTO idempotency_records
      (id, scope, subject_id, idempotency_key, request_hash, status, expires_at)
    VALUES (
      ${id}::uuid, ${params.scope}, ${params.subjectId}, ${params.key},
      ${requestHash}, 'IN_PROGRESS', ${expiresAt.toISOString()}::timestamptz
    )
    ON CONFLICT (scope, subject_id, idempotency_key) DO NOTHING
    RETURNING id
  `);

  if (inserted.rows[0]) {
    return { id: inserted.rows[0].id, replay: false, response: null };
  }

  // Someone already holds this key. Lock the row so we observe a settled state.
  const existing = await tx.db.execute<{
    id: string;
    request_hash: Buffer;
    status: string;
    response_status: number | null;
    response_body: unknown;
    resource_id: string | null;
  }>(sql`
    SELECT id, request_hash, status, response_status, response_body, resource_id
    FROM idempotency_records
    WHERE scope = ${params.scope}
      AND subject_id = ${params.subjectId}
      AND idempotency_key = ${params.key}
    FOR UPDATE
  `);

  const row = existing.rows[0];
  if (!row) {
    // The record expired and was cleaned up between the two statements.
    throw new AppError('IDEMPOTENCY_IN_PROGRESS');
  }

  const storedHash = Buffer.isBuffer(row.request_hash)
    ? row.request_hash
    : Buffer.from(row.request_hash as unknown as string, 'hex');

  if (!storedHash.equals(requestHash)) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED');
  }

  if (row.status === 'COMPLETED') {
    return {
      id: row.id,
      replay: true,
      response: {
        status: row.response_status ?? 200,
        body: row.response_body,
        resourceId: row.resource_id,
      },
    };
  }

  if (row.status === 'FAILED') {
    // A failed attempt may be retried with the same key: reset to IN_PROGRESS
    // and let the caller run the command again.
    await tx.db.execute(sql`
      UPDATE idempotency_records
         SET status = 'IN_PROGRESS', completed_at = NULL,
             response_status = NULL, response_body = NULL
       WHERE id = ${row.id}::uuid
    `);
    return { id: row.id, replay: false, response: null };
  }

  // Still IN_PROGRESS, and we hold its lock — meaning the original transaction
  // committed the claim but has not finished. Tell the client to retry.
  throw new AppError('IDEMPOTENCY_IN_PROGRESS');
}

export async function completeIdempotent(
  tx: TransactionContext,
  id: string,
  result: { status: number; body: unknown; resourceId?: string | null },
): Promise<void> {
  await tx.db.execute(sql`
    UPDATE idempotency_records
       SET status = 'COMPLETED',
           response_status = ${result.status},
           response_body = ${JSON.stringify(result.body ?? null)}::jsonb,
           resource_id = ${result.resourceId ?? null}::uuid,
           completed_at = now()
     WHERE id = ${id}::uuid
  `);
}

export async function failIdempotent(
  tx: TransactionContext,
  id: string,
  status: number,
): Promise<void> {
  await tx.db.execute(sql`
    UPDATE idempotency_records
       SET status = 'FAILED', response_status = ${status}, completed_at = now()
     WHERE id = ${id}::uuid
  `);
}

export async function purgeExpiredIdempotency(tx: TransactionContext): Promise<number> {
  const result = await tx.db.execute(sql`
    DELETE FROM idempotency_records WHERE expires_at < now()
  `);
  return result.rowCount ?? 0;
}

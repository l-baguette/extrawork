import { sql } from 'drizzle-orm';
import {
  formatDocumentNumber,
  sequenceScope,
  type SequenceKind,
  type TenantContext,
} from '@extrawork/domain';
import type { TransactionContext } from '../client.js';
import { ORG_SCOPE_UUID } from '../ids.js';

/**
 * Numbering allocation — report §8.2, using the report's own UPSERT.
 *
 * Runs inside the caller's transaction. If that transaction rolls back the
 * allocation is lost, leaving a gap — which the report explicitly accepts:
 * "Numbers may have gaps after transaction or draft cancellation. Never reuse a
 * number because reuse damages auditability."
 */
export async function allocateNumber(
  tx: TransactionContext,
  ctx: TenantContext,
  kind: SequenceKind,
  projectId: string | null,
): Promise<{ allocated: number; formatted: string }> {
  const scope = sequenceScope(kind, projectId);
  const scopeProjectId = scope.projectId ?? ORG_SCOPE_UUID;

  const result = await tx.db.execute<{ allocated: number }>(sql`
    INSERT INTO document_sequences (organization_id, project_id, kind, next_value)
    VALUES (${ctx.organizationId}::uuid, ${scopeProjectId}::uuid, ${kind}, 2)
    ON CONFLICT (organization_id, project_id, kind)
    DO UPDATE SET next_value = document_sequences.next_value + 1,
                  updated_at = now()
    RETURNING next_value - 1 AS allocated
  `);

  const allocated = result.rows[0]?.allocated;
  if (allocated === undefined) {
    throw new Error(`Failed to allocate a ${kind} number`);
  }

  return { allocated, formatted: formatDocumentNumber(kind, allocated) };
}

/** Read-only peek used by the composer to preview the next number. */
export async function peekNextNumber(
  tx: TransactionContext,
  ctx: TenantContext,
  kind: SequenceKind,
  projectId: string | null,
): Promise<string> {
  const scope = sequenceScope(kind, projectId);
  const scopeProjectId = scope.projectId ?? ORG_SCOPE_UUID;

  const result = await tx.db.execute<{ next_value: number }>(sql`
    SELECT next_value FROM document_sequences
    WHERE organization_id = ${ctx.organizationId}::uuid
      AND project_id = ${scopeProjectId}::uuid
      AND kind = ${kind}
  `);

  return formatDocumentNumber(kind, result.rows[0]?.next_value ?? 1);
}

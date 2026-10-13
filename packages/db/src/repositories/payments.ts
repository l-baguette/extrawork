import { sql } from 'drizzle-orm';
import type { TransactionContext } from '../client.js';
import { toDate } from '../row-types.js';

export type PaymentIntentStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface PaymentIntentRow {
  id: string;
  organizationId: string;
  projectId: string | null;
  versionId: string | null;
  amountMinor: bigint;
  currency: string;
  status: PaymentIntentStatus;
  provider: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  updatedAt: Date;
}

interface PaymentIntentRecord extends Record<string, unknown> {
  id: string;
  organization_id: string;
  project_id: string | null;
  version_id: string | null;
  amount_minor: string;
  currency: string;
  status: PaymentIntentStatus;
  provider: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  updated_at: Date | string;
}

function mapPaymentIntent(row: PaymentIntentRecord): PaymentIntentRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    versionId: row.version_id,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
    status: row.status,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    providerPaymentId: row.provider_payment_id,
    updatedAt: toDate(row.updated_at),
  };
}

export class PaymentRepository {
  /** Locks by provider identity so verification and transition are atomic. */
  async lockByProviderOrder(
    tx: TransactionContext,
    provider: string,
    providerOrderId: string,
  ): Promise<PaymentIntentRow | null> {
    const result = await tx.db.execute<PaymentIntentRecord>(sql`
      SELECT id, organization_id, project_id, version_id, amount_minor, currency,
             status, provider, provider_order_id, provider_payment_id, updated_at
      FROM payment_intents
      WHERE provider = ${provider}
        AND provider_order_id = ${providerOrderId}
      FOR UPDATE
    `);
    const row = result.rows[0];
    return row ? mapPaymentIntent(row) : null;
  }

  async updateFromProvider(
    tx: TransactionContext,
    intent: PaymentIntentRow,
    input: { status: PaymentIntentStatus; providerPaymentId: string | null },
  ): Promise<void> {
    await tx.db.execute(sql`
      UPDATE payment_intents
      SET status = ${input.status},
          provider_payment_id = COALESCE(${input.providerPaymentId}, provider_payment_id),
          updated_at = now()
      WHERE id = ${intent.id}::uuid
        AND organization_id = ${intent.organizationId}::uuid
    `);
  }
}

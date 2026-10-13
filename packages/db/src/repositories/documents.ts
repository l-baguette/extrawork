import { sql } from 'drizzle-orm';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull, toInt, toJsonOrNull } from '../row-types.js';

/**
 * Generated documents (evidence PDFs, packs, exports) and message records.
 *
 * Report §8.5 requires template version, renderer version, generated file hash,
 * storage object version and generation time to be stored with every document.
 */

export interface GeneratedDocumentRow {
  id: string;
  organizationId: string;
  projectId: string | null;
  versionId: string | null;
  kind: string;
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
  storageKey: string | null;
  fileSha256: Buffer | null;
  byteSize: bigint | null;
  templateVersion: string;
  rendererVersion: string | null;
  generatorVersion: string | null;
  storageObjectVersion: string | null;
  manifest: Record<string, unknown> | null;
  manifestSha256: Buffer | null;
  error: string | null;
  generationLeaseToken: string | null;
  generationLeasedUntil: Date | null;
  generationAttemptCount: number;
  requestedAt: Date;
  generatedAt: Date | null;
}

export class DocumentRepository {
  constructor(private readonly db: Database) {}

  async requestEvidence(
    tx: TransactionContext,
    ctx: TenantContext,
    input: { projectId: string; versionId: string; templateVersion: string },
  ): Promise<string> {
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO generated_documents
        (id, organization_id, project_id, version_id, kind, status, template_version)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid,
        ${input.versionId}::uuid, 'EVIDENCE_PDF', 'PENDING', ${input.templateVersion}
      )
    `);
    return id;
  }

  async requestExport(
    tx: TransactionContext,
    ctx: TenantContext,
    input: { projectId: string | null; kind: string; templateVersion: string },
  ): Promise<string> {
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO generated_documents
        (id, organization_id, project_id, kind, status, template_version)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid,
        ${input.kind}, 'PENDING', ${input.templateVersion}
      )
    `);
    return id;
  }

  /** Claims or reclaims a generation lease for this worker attempt. */
  async claimForGeneration(
    db: Database,
    organizationId: string,
    id: string,
    leaseToken: string,
    leaseSeconds: number,
  ): Promise<boolean> {
    const result = await db.execute(sql`
      UPDATE generated_documents SET
        status = 'GENERATING',
        generation_lease_token = ${leaseToken},
        generation_leased_until = now() + make_interval(secs => ${leaseSeconds}),
        generation_attempt_count = generation_attempt_count + 1
      WHERE id = ${id}::uuid
        AND organization_id = ${organizationId}::uuid
        AND (
          status IN ('PENDING','FAILED')
          OR (status = 'GENERATING' AND generation_leased_until < now())
        )
    `);
    return (result.rowCount ?? 0) > 0;
  }

  async markReady(
    db: Database,
    organizationId: string,
    id: string,
    leaseToken: string,
    input: {
      storageKey: string;
      fileSha256: Buffer;
      byteSize: bigint;
      rendererVersion: string;
      generatorVersion: string;
      storageObjectVersion: string | null;
      manifest: unknown;
      manifestSha256: Buffer;
    },
  ): Promise<boolean> {
    const result = await db.execute(sql`
      UPDATE generated_documents SET
        status = 'READY',
        storage_key = ${input.storageKey},
        file_sha256 = ${input.fileSha256},
        byte_size = ${input.byteSize.toString()}::bigint,
        renderer_version = ${input.rendererVersion},
        generator_version = ${input.generatorVersion},
        storage_object_version = ${input.storageObjectVersion},
        manifest = ${JSON.stringify(input.manifest)}::jsonb,
        manifest_sha256 = ${input.manifestSha256},
        error = NULL,
        generated_at = now(),
        generation_lease_token = NULL,
        generation_leased_until = NULL
      WHERE id = ${id}::uuid
        AND organization_id = ${organizationId}::uuid
        AND status = 'GENERATING'
        AND generation_lease_token = ${leaseToken}
    `);
    return (result.rowCount ?? 0) > 0;
  }

  async markFailed(
    db: Database,
    organizationId: string,
    id: string,
    leaseToken: string,
    error: string,
  ): Promise<boolean> {
    const result = await db.execute(sql`
      UPDATE generated_documents SET
        status = 'FAILED', error = ${error.slice(0, 2_000)},
        generation_lease_token = NULL, generation_leased_until = NULL
      WHERE id = ${id}::uuid
        AND organization_id = ${organizationId}::uuid
        AND status = 'GENERATING'
        AND generation_lease_token = ${leaseToken}
    `);
    return (result.rowCount ?? 0) > 0;
  }

  async findById(
    ctx: TenantContext,
    id: string,
    db: Database = this.db,
  ): Promise<GeneratedDocumentRow | null> {
    const result = await db.execute<DocumentRecord>(sql`
      SELECT ${DOC_COLUMNS} FROM generated_documents
      WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapDocument(row) : null;
  }

  /** Latest evidence PDF for a version, whatever its state. */
  async findLatestForVersion(
    ctx: TenantContext,
    versionId: string,
    kind = 'EVIDENCE_PDF',
  ): Promise<GeneratedDocumentRow | null> {
    const result = await this.db.execute<DocumentRecord>(sql`
      SELECT ${DOC_COLUMNS} FROM generated_documents
      WHERE version_id = ${versionId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
        AND kind = ${kind}
      ORDER BY requested_at DESC
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? mapDocument(row) : null;
  }

  async listForProject(ctx: TenantContext, projectId: string): Promise<GeneratedDocumentRow[]> {
    const result = await this.db.execute<DocumentRecord>(sql`
      SELECT ${DOC_COLUMNS} FROM generated_documents
      WHERE project_id = ${projectId}::uuid AND organization_id = ${ctx.organizationId}::uuid
      ORDER BY requested_at DESC
      LIMIT 100
    `);
    return result.rows.map(mapDocument);
  }
}

// --- Messages ---------------------------------------------------------------

export interface MessageRow {
  id: string;
  organizationId: string;
  versionId: string | null;
  contactId: string | null;
  channel: string;
  purpose: string;
  status: string;
  provider: string | null;
  providerAccountId: string | null;
  providerMessageId: string | null;
  createdAt: Date;
}

export type DeliveryRecipientKind = 'CUSTOMER' | 'EMPLOYEE' | 'OWNER';

export interface MessageDeliveryPayload {
  body: string;
  organizationName: string;
  subject?: string;
  template?: {
    name: string;
    languageCode: string;
    bodyParameters: string[];
  };
}

export interface MessageDeliveryRow {
  id: string;
  organizationId: string;
  versionId: string;
  contactId: string | null;
  decisionId: string;
  channel: string;
  purpose: 'DECISION_RECEIPT' | 'TEAM_DECISION';
  status: string;
  recipientKind: DeliveryRecipientKind;
  recipientName: string;
  recipientAddress: string;
  deliveryPayload: MessageDeliveryPayload;
  deliveryAttemptCount: number;
  deliveryLeaseToken: string | null;
  deliveryLeasedUntil: Date | null;
  dedupeKey: string;
  provider: string | null;
  providerAccountId: string | null;
  providerMessageId: string | null;
  sentAt: Date | null;
  errorCode: string | null;
  errorDetail: string | null;
}

interface MessageDeliveryRecord extends Record<string, unknown> {
  id: string;
  organization_id: string;
  version_id: string;
  contact_id: string | null;
  decision_id: string;
  channel: string;
  purpose: 'DECISION_RECEIPT' | 'TEAM_DECISION';
  status: string;
  recipient_kind: DeliveryRecipientKind;
  recipient_name: string;
  recipient_address: string;
  delivery_payload: MessageDeliveryPayload;
  delivery_attempt_count: number | string;
  delivery_lease_token: string | null;
  delivery_leased_until: Date | string | null;
  dedupe_key: string;
  provider: string | null;
  provider_account_id: string | null;
  provider_message_id: string | null;
  sent_at: Date | string | null;
  error_code: string | null;
  error_detail: string | null;
}

const DELIVERY_COLUMNS = sql.raw(`
  id, organization_id, version_id, contact_id, decision_id, channel, purpose,
  status, recipient_kind, recipient_name, recipient_address, delivery_payload,
  delivery_attempt_count, delivery_lease_token, delivery_leased_until, dedupe_key,
  provider, provider_account_id, provider_message_id, sent_at, error_code, error_detail
`);

export class MessageRepository {
  constructor(private readonly db: Database) {}

  /**
   * Records a message intent. In the native-share MVP the terminal status is
   * SHARE_INTENT_OPENED, never SENT — the system cannot observe delivery
   * (report §10.3).
   *
   * `providerMessageId` is the provider's own handle for the message (Meta's
   * `wamid`). It is written here, at the only moment the system holds it: the
   * gateway returns it from `send`, and a delivery-status webhook arriving
   * minutes later carries nothing else that identifies the row. Without it
   * `findByProviderMessageId` cannot resolve the status back to a message, and
   * every status update is dropped as "unknown provider message id" — so a
   * message would sit at its send-time status forever while the customer's
   * phone shows two ticks. Null for the callers that record an intent before
   * any send has happened.
   */
  async record(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      versionId: string | null;
      contactId: string | null;
      channel: string;
      purpose: string;
      status: string;
      dedupeKey?: string | null;
      provider?: string | null;
      providerAccountId?: string | null;
      providerMessageId?: string | null;
      suppressionReason?: string | null;
    },
  ): Promise<string | null> {
    const id = newId();
    const result = await tx.db.execute<{ id: string }>(sql`
      INSERT INTO messages
        (id, organization_id, version_id, contact_id, channel, purpose, status,
         dedupe_key, provider, provider_account_id, provider_message_id, suppression_reason)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.versionId}::uuid,
        ${input.contactId}::uuid, ${input.channel}, ${input.purpose}, ${input.status},
        ${input.dedupeKey ?? null}, ${input.provider ?? null},
        ${input.providerAccountId ?? null}, ${input.providerMessageId ?? null},
        ${input.suppressionReason ?? null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    return result.rows[0]?.id ?? null;
  }

  /**
   * Creates one durable provider-send intent per recipient and channel.
   *
   * The partial unique index on `dedupe_key` is the concurrency boundary. A
   * parent job may be retried after committing its fan-out, so this is an
   * atomic upsert rather than SELECT-then-INSERT. The no-op update gives both
   * the winning insert and a conflicting retry the same row id.
   */
  async createDeliveryIntent(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      versionId: string;
      contactId: string | null;
      decisionId: string;
      channel: string;
      purpose: 'DECISION_RECEIPT' | 'TEAM_DECISION';
      recipientKind: DeliveryRecipientKind;
      recipientName: string;
      recipientAddress: string;
      deliveryPayload: MessageDeliveryPayload;
      dedupeKey: string;
    },
  ): Promise<string> {
    const result = await tx.db.execute<{ id: string; organization_id: string }>(sql`
      INSERT INTO messages
        (id, organization_id, version_id, contact_id, decision_id, channel, purpose,
         status, recipient_kind, recipient_name, recipient_address, delivery_payload,
         dedupe_key)
      VALUES (
        ${newId()}::uuid, ${ctx.organizationId}::uuid, ${input.versionId}::uuid,
        ${input.contactId}::uuid, ${input.decisionId}::uuid, ${input.channel},
        ${input.purpose}, 'PENDING', ${input.recipientKind}, ${input.recipientName},
        ${input.recipientAddress}, ${JSON.stringify(input.deliveryPayload)}::jsonb,
        ${input.dedupeKey}
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL
      DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key
      RETURNING id, organization_id
    `);
    const row = result.rows[0];
    if (!row || row.organization_id !== ctx.organizationId) {
      throw new Error('Delivery intent conflicted outside its tenant scope');
    }
    return row.id;
  }

  /**
   * Claims exactly one delivery without holding a transaction open while the
   * provider is called. An expired SENDING lease is recoverable after a worker
   * crash; a provider-level FAILED status is not retried when `sent_at` proves
   * the provider had already accepted the send.
   */
  async claimDelivery(
    db: Database,
    ctx: TenantContext,
    messageId: string,
    leaseToken: string,
    leaseSeconds: number,
  ): Promise<MessageDeliveryRow | null> {
    const result = await db.execute<MessageDeliveryRecord>(sql`
      UPDATE messages
         SET status = 'SENDING',
             delivery_attempt_count = delivery_attempt_count + 1,
             delivery_lease_token = ${leaseToken},
             delivery_leased_until = now() + make_interval(secs => ${Math.max(1, leaseSeconds)}),
             error_code = NULL,
             error_detail = NULL,
             updated_at = now()
       WHERE id = ${messageId}::uuid
         AND organization_id = ${ctx.organizationId}::uuid
         AND delivery_payload IS NOT NULL
         AND (
           status = 'PENDING'
           OR (status = 'FAILED' AND sent_at IS NULL)
           OR (status = 'SENDING' AND delivery_leased_until < now())
         )
      RETURNING ${DELIVERY_COLUMNS}
    `);
    const row = result.rows[0];
    return row ? mapDelivery(row) : null;
  }

  async findDelivery(
    db: Database,
    ctx: TenantContext,
    messageId: string,
  ): Promise<MessageDeliveryRow | null> {
    const result = await db.execute<MessageDeliveryRecord>(sql`
      SELECT ${DELIVERY_COLUMNS}
      FROM messages
      WHERE id = ${messageId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
        AND delivery_payload IS NOT NULL
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? mapDelivery(row) : null;
  }

  /**
   * Provider success is monotonic and may finish even after the local lease
   * expired: the external acceptance is still a real fact. A stale failure,
   * however, is ownership-guarded below so it cannot overwrite a newer send.
   */
  async markDeliverySent(
    db: Database,
    ctx: TenantContext,
    messageId: string,
    input: {
      channel: string;
      status: 'ACCEPTED' | 'SENT';
      provider: string;
      providerAccountId?: string | null;
      providerMessageId: string | null;
    },
  ): Promise<boolean> {
    const result = await db.execute<{ id: string }>(sql`
      UPDATE messages
         SET channel = ${input.channel},
             status = ${input.status},
             provider = ${input.provider},
             provider_account_id = ${input.providerAccountId ?? null},
             provider_message_id = ${input.providerMessageId},
             sent_at = COALESCE(sent_at, now()),
             delivery_lease_token = NULL,
             delivery_leased_until = NULL,
             error_code = NULL,
             error_detail = NULL,
             updated_at = now()
       WHERE id = ${messageId}::uuid
         AND organization_id = ${ctx.organizationId}::uuid
         AND delivery_payload IS NOT NULL
         AND sent_at IS NULL
         AND status IN ('PENDING','SENDING','FAILED')
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async markDeliveryFailed(
    db: Database,
    ctx: TenantContext,
    messageId: string,
    leaseToken: string,
    errorCode: string,
    errorDetail: string,
  ): Promise<boolean> {
    const result = await db.execute<{ id: string }>(sql`
      UPDATE messages
         SET status = 'FAILED',
             delivery_lease_token = NULL,
             delivery_leased_until = NULL,
             error_code = ${errorCode},
             error_detail = ${errorDetail.slice(0, 1000)},
             updated_at = now()
       WHERE id = ${messageId}::uuid
         AND organization_id = ${ctx.organizationId}::uuid
         AND status = 'SENDING'
         AND delivery_lease_token = ${leaseToken}
         AND sent_at IS NULL
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async updateStatus(
    db: Database,
    messageId: string,
    status: string,
    providerMessageId: string | null,
    errorCode: string | null,
  ): Promise<void> {
    await db.execute(sql`
      UPDATE messages SET status = ${status},
                          provider_message_id = COALESCE(${providerMessageId}, provider_message_id),
                          error_code = ${errorCode}
      WHERE id = ${messageId}::uuid
    `);
  }

  async appendEvent(
    db: Database,
    input: {
      organizationId: string;
      messageId: string;
      status: string;
      providerEventAt: Date | null;
      payload: unknown;
    },
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO message_events
        (id, organization_id, message_id, status, provider_event_at, payload)
      VALUES (
        ${newId()}::uuid, ${input.organizationId}::uuid, ${input.messageId}::uuid,
        ${input.status}, ${input.providerEventAt?.toISOString() ?? null}::timestamptz,
        ${JSON.stringify(input.payload ?? null)}::jsonb
      )
    `);
  }

  async listForVersion(ctx: TenantContext, versionId: string): Promise<MessageRow[]> {
    const result = await this.db.execute<{
      id: string;
      organization_id: string;
      version_id: string | null;
      contact_id: string | null;
      channel: string;
      purpose: string;
      status: string;
      provider_message_id: string | null;
      provider: string | null;
      provider_account_id: string | null;
      created_at: Date;
    }>(sql`
      SELECT id, organization_id, version_id, contact_id, channel, purpose, status,
             provider, provider_account_id, provider_message_id, created_at
      FROM messages
      WHERE version_id = ${versionId}::uuid AND organization_id = ${ctx.organizationId}::uuid
      ORDER BY created_at DESC
    `);
    return result.rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      versionId: r.version_id,
      contactId: r.contact_id,
      channel: r.channel,
      purpose: r.purpose,
      status: r.status,
      provider: r.provider,
      providerAccountId: r.provider_account_id,
      providerMessageId: r.provider_message_id,
      createdAt: toDate(r.created_at),
    }));
  }

  /** Most recent reminder for a version, used for the cooldown rule (§8.6). */
  /** Resolves the message a provider status webhook refers to (report §13.2). */
  async findByProviderMessageId(
    db: Database,
    provider: string,
    providerAccountId: string | null,
    providerMessageId: string,
  ): Promise<{ id: string; organizationId: string; status: string } | null> {
    const result = await db.execute<{
      id: string;
      organization_id: string;
      status: string;
      provider_account_id: string | null;
    }>(sql`
      SELECT id, organization_id, status, provider_account_id
      FROM messages
      WHERE provider = ${provider}
        AND provider_message_id = ${providerMessageId}
        AND (
          provider_account_id = ${providerAccountId}
          OR provider_account_id IS NULL
        )
      ORDER BY (provider_account_id = ${providerAccountId}) DESC NULLS LAST
      LIMIT 2
    `);
    const exact = result.rows.find(
      (row) => row.provider_account_id !== null && row.provider_account_id === providerAccountId,
    );
    const row = exact ?? (result.rows.length === 1 ? result.rows[0] : undefined);
    return row ? { id: row.id, organizationId: row.organization_id, status: row.status } : null;
  }

  async lastReminderAt(ctx: TenantContext, versionId: string): Promise<Date | null> {
    const result = await this.db.execute<{ last: Date | null }>(sql`
      SELECT max(created_at) AS last FROM messages
      WHERE version_id = ${versionId}::uuid
        AND organization_id = ${ctx.organizationId}::uuid
        AND purpose = 'REMINDER'
    `);
    return result.rows[0]?.last ?? null;
  }
}

function mapDelivery(row: MessageDeliveryRecord): MessageDeliveryRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    versionId: row.version_id,
    contactId: row.contact_id,
    decisionId: row.decision_id,
    channel: row.channel,
    purpose: row.purpose,
    status: row.status,
    recipientKind: row.recipient_kind,
    recipientName: row.recipient_name,
    recipientAddress: row.recipient_address,
    deliveryPayload: row.delivery_payload,
    deliveryAttemptCount: toInt(row.delivery_attempt_count),
    deliveryLeaseToken: row.delivery_lease_token,
    deliveryLeasedUntil: toDateOrNull(row.delivery_leased_until),
    dedupeKey: row.dedupe_key,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    providerMessageId: row.provider_message_id,
    sentAt: toDateOrNull(row.sent_at),
    errorCode: row.error_code,
    errorDetail: row.error_detail,
  };
}

// --- Webhook inbox ----------------------------------------------------------

export interface WebhookEventRow {
  id: string;
  provider: string;
  providerAccountId: string | null;
  providerEventId: string;
  /** The adapter's own classification. Null on rows stored before 0009. */
  kind: string | null;
  signatureVerified: boolean;
  /** The provider payload exactly as received; never reused as a domain model. */
  rawPayload: Record<string, unknown> | null;
  providerEventAt: Date | null;
  processedAt: Date | null;
  processError: string | null;
}

export class WebhookInboxRepository {
  constructor(private readonly db: Database) {}

  /**
   * Report §13.2: verify the signature first, insert the raw event with a
   * unique provider key, acknowledge duplicates with 200.
   * Returns null when the event was already recorded.
   */
  async insert(
    db: Database,
    input: {
      provider: string;
      providerAccountId: string | null;
      providerEventId: string;
      signatureVerified: boolean;
      rawPayload: unknown;
      headers: Record<string, string>;
      providerEventAt: Date | null;
      kind?: string | null;
    },
  ): Promise<string | null> {
    const id = newId();
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO webhook_inbox
        (id, provider, provider_account_id, provider_event_id, signature_verified,
         raw_payload, headers, provider_event_at, kind)
      VALUES (
        ${id}::uuid, ${input.provider}, ${input.providerAccountId}, ${input.providerEventId},
        ${input.signatureVerified}, ${JSON.stringify(input.rawPayload)}::jsonb,
        ${JSON.stringify(input.headers)}::jsonb,
        ${input.providerEventAt?.toISOString() ?? null}::timestamptz,
        ${input.kind ?? null}
      )
      ON CONFLICT (provider, provider_account_id, provider_event_id) DO NOTHING
      RETURNING id
    `);
    return result.rows[0]?.id ?? null;
  }

  async findById(db: Database, id: string): Promise<WebhookEventRow | null> {
    const result = await db.execute<{
      id: string;
      provider: string;
      provider_account_id: string | null;
      provider_event_id: string;
      signature_verified: boolean;
      raw_payload: unknown;
      provider_event_at: Date | null;
      processed_at: Date | null;
      process_error: string | null;
      kind: string | null;
    }>(sql`
      SELECT id, provider, provider_account_id, provider_event_id, signature_verified,
             raw_payload, provider_event_at, processed_at, process_error, kind
      FROM webhook_inbox WHERE id = ${id}::uuid
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider,
      providerAccountId: row.provider_account_id,
      providerEventId: row.provider_event_id,
      kind: row.kind,
      signatureVerified: row.signature_verified,
      rawPayload: toJsonOrNull(row.raw_payload),
      providerEventAt: toDateOrNull(row.provider_event_at),
      processedAt: toDateOrNull(row.processed_at),
      processError: row.process_error,
    };
  }

  async markProcessed(db: Database, id: string, error: string | null): Promise<void> {
    await db.execute(sql`
      UPDATE webhook_inbox SET processed_at = now(), process_error = ${error}
      WHERE id = ${id}::uuid
    `);
  }

  /** Records a retryable normalisation failure without acknowledging the row. */
  async recordProcessingError(db: Database, id: string, error: string): Promise<void> {
    await db.execute(sql`
      UPDATE webhook_inbox SET process_error = ${error.slice(0, 2_000)}
      WHERE id = ${id}::uuid AND processed_at IS NULL
    `);
  }

  /** Report §9.8: raw provider payloads are kept 90 days. */
  async purgeOldRawPayloads(db: Database, days = 90): Promise<number> {
    const result = await db.execute(sql`
      DELETE FROM webhook_inbox
      WHERE received_at < now() - make_interval(days => ${days})
    `);
    return result.rowCount ?? 0;
  }
}

const DOC_COLUMNS = sql`
  id, organization_id, project_id, version_id, kind, status, storage_key, file_sha256,
  byte_size, template_version, renderer_version, generator_version,
  storage_object_version, manifest, manifest_sha256, error,
  generation_lease_token, generation_leased_until, generation_attempt_count,
  requested_at, generated_at
`;

type DocumentRecord = {
  id: string;
  organization_id: string;
  project_id: string | null;
  version_id: string | null;
  kind: string;
  status: GeneratedDocumentRow['status'];
  storage_key: string | null;
  file_sha256: Buffer | null;
  byte_size: string | null;
  template_version: string;
  renderer_version: string | null;
  generator_version: string | null;
  storage_object_version: string | null;
  manifest: Record<string, unknown> | null;
  manifest_sha256: Buffer | null;
  error: string | null;
  generation_lease_token: string | null;
  generation_leased_until: Date | null;
  generation_attempt_count: number;
  requested_at: Date;
  generated_at: Date | null;
};

function mapDocument(row: DocumentRecord): GeneratedDocumentRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    versionId: row.version_id,
    kind: row.kind,
    status: row.status,
    storageKey: row.storage_key,
    fileSha256: row.file_sha256,
    byteSize: row.byte_size === null ? null : BigInt(row.byte_size),
    templateVersion: row.template_version,
    rendererVersion: row.renderer_version,
    generatorVersion: row.generator_version,
    storageObjectVersion: row.storage_object_version,
    manifest: row.manifest,
    manifestSha256: row.manifest_sha256,
    error: row.error,
    generationLeaseToken: row.generation_lease_token,
    generationLeasedUntil: toDateOrNull(row.generation_leased_until),
    generationAttemptCount: row.generation_attempt_count,
    requestedAt: toDate(row.requested_at),
    generatedAt: toDateOrNull(row.generated_at),
  };
}

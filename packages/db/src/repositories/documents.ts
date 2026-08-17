import { sql } from 'drizzle-orm';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull, toJsonOrNull } from '../row-types.js';

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

  /** Claims the row so a retried job does not render the same PDF twice. */
  async claimForGeneration(db: Database, id: string): Promise<boolean> {
    const result = await db.execute(sql`
      UPDATE generated_documents SET status = 'GENERATING'
      WHERE id = ${id}::uuid AND status IN ('PENDING','FAILED')
    `);
    return (result.rowCount ?? 0) > 0;
  }

  async markReady(
    db: Database,
    id: string,
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
  ): Promise<void> {
    await db.execute(sql`
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
        generated_at = now()
      WHERE id = ${id}::uuid
    `);
  }

  async markFailed(db: Database, id: string, error: string): Promise<void> {
    await db.execute(sql`
      UPDATE generated_documents SET status = 'FAILED', error = ${error.slice(0, 2_000)}
      WHERE id = ${id}::uuid
    `);
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
  providerMessageId: string | null;
  createdAt: Date;
}

export class MessageRepository {
  constructor(private readonly db: Database) {}

  /**
   * Records a message intent. In the native-share MVP the terminal status is
   * SHARE_INTENT_OPENED, never SENT — the system cannot observe delivery
   * (report §10.3).
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
      suppressionReason?: string | null;
    },
  ): Promise<string | null> {
    const id = newId();
    const result = await tx.db.execute<{ id: string }>(sql`
      INSERT INTO messages
        (id, organization_id, version_id, contact_id, channel, purpose, status,
         dedupe_key, provider, suppression_reason)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.versionId}::uuid,
        ${input.contactId}::uuid, ${input.channel}, ${input.purpose}, ${input.status},
        ${input.dedupeKey ?? null}, ${input.provider ?? null}, ${input.suppressionReason ?? null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    return result.rows[0]?.id ?? null;
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
      created_at: Date;
    }>(sql`
      SELECT id, organization_id, version_id, contact_id, channel, purpose, status,
             provider_message_id, created_at
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
      providerMessageId: r.provider_message_id,
      createdAt: toDate(r.created_at),
    }));
  }

  /** Most recent reminder for a version, used for the cooldown rule (§8.6). */
  /** Resolves the message a provider status webhook refers to (report §13.2). */
  async findByProviderMessageId(
    db: Database,
    providerMessageId: string,
  ): Promise<{ id: string; organizationId: string; status: string } | null> {
    const result = await db.execute<{
      id: string;
      organization_id: string;
      status: string;
    }>(sql`
      SELECT id, organization_id, status
      FROM messages
      WHERE provider_message_id = ${providerMessageId}
      LIMIT 1
    `);
    const row = result.rows[0];
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

// --- Webhook inbox ----------------------------------------------------------

export interface WebhookEventRow {
  id: string;
  provider: string;
  providerAccountId: string | null;
  providerEventId: string;
  signatureVerified: boolean;
  /** The provider payload exactly as received; never reused as a domain model. */
  rawPayload: Record<string, unknown> | null;
  providerEventAt: Date | null;
  processedAt: Date | null;
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
    },
  ): Promise<string | null> {
    const id = newId();
    const result = await db.execute<{ id: string }>(sql`
      INSERT INTO webhook_inbox
        (id, provider, provider_account_id, provider_event_id, signature_verified,
         raw_payload, headers, provider_event_at)
      VALUES (
        ${id}::uuid, ${input.provider}, ${input.providerAccountId}, ${input.providerEventId},
        ${input.signatureVerified}, ${JSON.stringify(input.rawPayload)}::jsonb,
        ${JSON.stringify(input.headers)}::jsonb,
        ${input.providerEventAt?.toISOString() ?? null}::timestamptz
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
    }>(sql`
      SELECT id, provider, provider_account_id, provider_event_id, signature_verified,
             raw_payload, provider_event_at, processed_at
      FROM webhook_inbox WHERE id = ${id}::uuid
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider,
      providerAccountId: row.provider_account_id,
      providerEventId: row.provider_event_id,
      signatureVerified: row.signature_verified,
      rawPayload: toJsonOrNull(row.raw_payload),
      providerEventAt: toDateOrNull(row.provider_event_at),
      processedAt: toDateOrNull(row.processed_at),
    };
  }

  async markProcessed(db: Database, id: string, error: string | null): Promise<void> {
    await db.execute(sql`
      UPDATE webhook_inbox SET processed_at = now(), process_error = ${error}
      WHERE id = ${id}::uuid
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
  storage_object_version, manifest, manifest_sha256, error, requested_at, generated_at
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
    requestedAt: toDate(row.requested_at),
    generatedAt: toDateOrNull(row.generated_at),
  };
}

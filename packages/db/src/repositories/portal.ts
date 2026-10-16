import { sql } from 'drizzle-orm';
import { AppError, type FolderVisibility } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull, toInt } from '../row-types.js';
import { runInScope, SYSTEM_SCOPE } from '../tenant-scope.js';
import { generateOpaqueToken } from './identity.js';

/**
 * Homeowner portal links (migration 0023) — spec 2026-10-12, D5.
 *
 * A portal link is a read-only window onto one project for one contact of
 * that project's customer. Token discipline is the approval link's: 32 random
 * bytes from the shared opaque-token helper, only the SHA-256 stored, so a
 * leaked database cannot be turned into working links. Because the plaintext
 * is never kept, a lost link is replaced by minting a fresh one rather than
 * "resent".
 *
 * Every method is tenant-scoped except `findByTokenHash`, which is the
 * bootstrap lookup that *names* the tenant (like `approvals.findByToken`).
 *
 * The projection reads below (`listSentRequests`, `listClientDocuments`,
 * `findClientDocument`, `findReadyEvidence`) are what decide what a homeowner
 * may see, so the visibility rules live in the SQL and not in a caller's
 * filter: never a DRAFT version (which includes every proposal still with the
 * designer), never a document outside a CLIENT folder.
 */

export interface PortalLinkRow {
  id: string;
  organizationId: string;
  projectId: string;
  contactId: string;
  contactName: string;
  createdVia: 'WEB' | 'WHATSAPP';
  createdByUserId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  lastViewedAt: Date | null;
  viewCount: number;
  createdAt: Date;
}

/** What a portal token resolves to before any tenant is known. */
export interface PortalTokenLookup {
  linkId: string;
  organizationId: string;
  projectId: string;
  contactId: string;
  expiresAt: Date;
}

export interface PortalRequestRow {
  changeOrderId: string;
  number: string;
  versionId: string;
  versionNumber: number;
  title: string;
  scope: string;
  room: string | null;
  workCategory: string | null;
  status: string;
  totalDeltaMinor: bigint;
  scheduleDeltaDays: number;
  sentAt: Date | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  /** The newest READY evidence PDF for this version, if any. */
  evidenceDocumentId: string | null;
}

export interface PortalDocumentRow {
  id: string;
  folderName: string;
  folderVisibility: FolderVisibility;
  kind: 'FILE' | 'LINK' | 'NOTE';
  title: string;
  url: string | null;
  body: string | null;
  mimeType: string | null;
  byteSize: bigint | null;
  scanStatus: string | null;
  fileObjectId: string | null;
  createdAt: Date;
}

export interface PortalEvidenceRow {
  id: string;
  storageKey: string;
  changeOrderNumber: string;
}

export class PortalRepository {
  constructor(readonly db: Database) {}

  async create(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      projectId: string;
      contactId: string;
      createdVia: 'WEB' | 'WHATSAPP';
      createdByUserId: string | null;
      expiresAt: Date;
    },
  ): Promise<{ link: PortalLinkRow; token: string }> {
    const { token, hash } = generateOpaqueToken();
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO project_portal_links
        (id, organization_id, project_id, contact_id, token_sha256, created_via,
         created_by_user_id, expires_at)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid,
        ${input.contactId}::uuid, ${hash}, ${input.createdVia},
        ${input.createdByUserId}::uuid, ${input.expiresAt.toISOString()}::timestamptz
      )
    `);
    const link = await this.findById(tx.db, ctx, id);
    if (!link) throw new AppError('INTERNAL_ERROR', { message: 'Portal link vanished on insert' });
    return { link, token };
  }

  async findById(db: Database, ctx: TenantContext, id: string): Promise<PortalLinkRow | null> {
    const result = await db.execute<LinkRecord>(sql`
      SELECT ${LINK_COLUMNS}
      FROM project_portal_links l
      JOIN contacts c ON c.organization_id = l.organization_id AND c.id = l.contact_id
      WHERE l.organization_id = ${ctx.organizationId}::uuid AND l.id = ${id}::uuid
    `);
    const row = result.rows[0];
    return row ? mapLink(row) : null;
  }

  /** Every link on a project, newest first, including revoked and expired ones. */
  async listForProject(ctx: TenantContext, projectId: string): Promise<PortalLinkRow[]> {
    const result = await this.db.execute<LinkRecord>(sql`
      SELECT ${LINK_COLUMNS}
      FROM project_portal_links l
      JOIN contacts c ON c.organization_id = l.organization_id AND c.id = l.contact_id
      WHERE l.organization_id = ${ctx.organizationId}::uuid
        AND l.project_id = ${projectId}::uuid
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT 100
    `);
    return result.rows.map(mapLink);
  }

  /** Revokes a live link. False when it was already revoked (idempotent). */
  async revoke(tx: TransactionContext, ctx: TenantContext, id: string): Promise<boolean> {
    const result = await tx.db.execute(sql`
      UPDATE project_portal_links SET revoked_at = now()
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND id = ${id}::uuid AND revoked_at IS NULL
    `);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Resolves a portal token to its project.
   *
   * System-scoped because the token is what *establishes* the tenant, exactly
   * as `approvals.findByToken` does: there is no organization to scope to until
   * this has run. It refuses, in SQL, a revoked or expired link and one whose
   * workspace is CLOSED or SUSPENDED, so no caller can forget to check. A link
   * whose contact has since been erased is refused too — the person it was
   * issued to no longer exists in the record.
   */
  async findByTokenHash(tokenHash: Buffer): Promise<PortalTokenLookup | null> {
    const result = await runInScope(SYSTEM_SCOPE, () =>
      this.db.execute<{
        id: string;
        organization_id: string;
        project_id: string;
        contact_id: string;
        expires_at: Date | string;
      }>(sql`
        SELECT l.id, l.organization_id, l.project_id, l.contact_id, l.expires_at
        FROM project_portal_links l
        JOIN organizations o ON o.id = l.organization_id
        JOIN contacts c ON c.organization_id = l.organization_id AND c.id = l.contact_id
        WHERE l.token_sha256 = ${tokenHash}
          AND l.revoked_at IS NULL
          AND l.expires_at > now()
          AND o.status NOT IN ('CLOSED', 'SUSPENDED')
          AND c.erased_at IS NULL
      `),
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      linkId: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      contactId: row.contact_id,
      expiresAt: toDate(row.expires_at),
    };
  }

  /**
   * Whether a token hash names a link at all, live or not. Used only to choose
   * between "this link has expired" and "this link is not valid" — both are
   * refusals, but a homeowner holding a link that simply ran out deserves to
   * know to ask for a new one. System-scoped for the same reason as above.
   */
  async describeDeadToken(tokenHash: Buffer): Promise<'EXPIRED' | 'REVOKED' | null> {
    const result = await runInScope(SYSTEM_SCOPE, () =>
      this.db.execute<{ revoked: boolean; expired: boolean }>(sql`
        SELECT (revoked_at IS NOT NULL) AS revoked, (expires_at <= now()) AS expired
        FROM project_portal_links WHERE token_sha256 = ${tokenHash}
      `),
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.revoked) return 'REVOKED';
    if (row.expired) return 'EXPIRED';
    return null;
  }

  async recordView(ctx: TenantContext, linkId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE project_portal_links
      SET last_viewed_at = now(), view_count = view_count + 1
      WHERE organization_id = ${ctx.organizationId}::uuid AND id = ${linkId}::uuid
    `);
  }

  /**
   * Every request that was ever put in front of the homeowner, at its latest
   * non-draft version. A version is non-draft exactly when it was sent (the
   * schema requires `sent_at` for every status but DRAFT), so a proposal still
   * with the designer — always a DRAFT — can never appear, nor can a revision
   * the designer is still preparing.
   */
  async listSentRequests(ctx: TenantContext, projectId: string): Promise<PortalRequestRow[]> {
    const result = await this.db.execute<{
      change_order_id: string;
      number: string;
      version_id: string;
      version_number: number;
      title: string;
      scope_description: string;
      room: string | null;
      work_category: string | null;
      status: string;
      total_delta_minor: string;
      schedule_delta_days: number;
      sent_at: Date | string | null;
      decided_at: Date | string | null;
      expires_at: Date | string | null;
      evidence_document_id: string | null;
    }>(sql`
      SELECT DISTINCT ON (co.id)
        co.id AS change_order_id, co.number, v.id AS version_id, v.version_number, v.title,
        v.scope_description, v.room, v.work_category, v.status::text AS status,
        v.total_delta_minor::text AS total_delta_minor, v.schedule_delta_days,
        v.sent_at, v.decided_at, v.expires_at,
        (SELECT gd.id FROM generated_documents gd
          WHERE gd.organization_id = v.organization_id AND gd.version_id = v.id
            AND gd.kind = 'EVIDENCE_PDF' AND gd.status = 'READY' AND gd.storage_key IS NOT NULL
          ORDER BY gd.requested_at DESC LIMIT 1) AS evidence_document_id
      FROM change_orders co
      JOIN change_order_versions v
        ON v.organization_id = co.organization_id AND v.change_order_id = co.id
      WHERE co.organization_id = ${ctx.organizationId}::uuid
        AND co.project_id = ${projectId}::uuid
        AND v.status <> 'DRAFT'
        AND v.sent_at IS NOT NULL
      ORDER BY co.id, v.version_number DESC
    `);
    return result.rows
      .map(
        (row): PortalRequestRow => ({
          changeOrderId: row.change_order_id,
          number: row.number,
          versionId: row.version_id,
          versionNumber: toInt(row.version_number, 1),
          title: row.title,
          scope: row.scope_description,
          room: row.room,
          workCategory: row.work_category,
          status: row.status,
          totalDeltaMinor: BigInt(row.total_delta_minor),
          scheduleDeltaDays: toInt(row.schedule_delta_days, 0),
          sentAt: toDateOrNull(row.sent_at),
          decidedAt: toDateOrNull(row.decided_at),
          expiresAt: toDateOrNull(row.expires_at),
          evidenceDocumentId: row.evidence_document_id,
        }),
      )
      .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0));
  }

  /** Live documents in the project's CLIENT folders, and nothing else (D5). */
  async listClientDocuments(ctx: TenantContext, projectId: string): Promise<PortalDocumentRow[]> {
    const result = await this.db.execute<DocumentRecord>(sql`
      SELECT ${DOCUMENT_COLUMNS}
      ${DOCUMENT_FROM}
      WHERE d.organization_id = ${ctx.organizationId}::uuid
        AND d.project_id = ${projectId}::uuid
        AND d.deleted_at IS NULL
        AND f.visibility = 'CLIENT'
      ORDER BY f.position, d.created_at DESC, d.id DESC
      LIMIT 500
    `);
    return result.rows.map(mapDocument);
  }

  async findClientDocument(
    ctx: TenantContext,
    projectId: string,
    documentId: string,
  ): Promise<PortalDocumentRow | null> {
    const result = await this.db.execute<DocumentRecord>(sql`
      SELECT ${DOCUMENT_COLUMNS}
      ${DOCUMENT_FROM}
      WHERE d.organization_id = ${ctx.organizationId}::uuid
        AND d.project_id = ${projectId}::uuid
        AND d.id = ${documentId}::uuid
        AND d.deleted_at IS NULL
        AND f.visibility = 'CLIENT'
    `);
    const row = result.rows[0];
    return row ? mapDocument(row) : null;
  }

  /**
   * A READY evidence PDF of a request on this project that was actually sent.
   * The join through a non-draft version is the same rule as
   * `listSentRequests`, so a portal download can never reach further than
   * the portal page itself shows.
   */
  async findReadyEvidence(
    ctx: TenantContext,
    projectId: string,
    generatedDocumentId: string,
  ): Promise<PortalEvidenceRow | null> {
    const result = await this.db.execute<{
      id: string;
      storage_key: string;
      number: string;
    }>(sql`
      SELECT gd.id, gd.storage_key, co.number
      FROM generated_documents gd
      JOIN change_order_versions v
        ON v.organization_id = gd.organization_id AND v.id = gd.version_id
      JOIN change_orders co
        ON co.organization_id = v.organization_id AND co.id = v.change_order_id
      WHERE gd.organization_id = ${ctx.organizationId}::uuid
        AND gd.id = ${generatedDocumentId}::uuid
        AND gd.kind = 'EVIDENCE_PDF'
        AND gd.status = 'READY'
        AND gd.storage_key IS NOT NULL
        AND co.project_id = ${projectId}::uuid
        AND v.status <> 'DRAFT'
    `);
    const row = result.rows[0];
    return row ? { id: row.id, storageKey: row.storage_key, changeOrderNumber: row.number } : null;
  }
}

const LINK_COLUMNS = sql`
  l.id, l.organization_id, l.project_id, l.contact_id, c.name AS contact_name, l.created_via,
  l.created_by_user_id, l.expires_at, l.revoked_at, l.last_viewed_at, l.view_count, l.created_at
`;

type LinkRecord = {
  id: string;
  organization_id: string;
  project_id: string;
  contact_id: string;
  contact_name: string;
  created_via: 'WEB' | 'WHATSAPP';
  created_by_user_id: string | null;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  last_viewed_at: Date | string | null;
  view_count: number;
  created_at: Date | string;
};

function mapLink(row: LinkRecord): PortalLinkRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    createdVia: row.created_via,
    createdByUserId: row.created_by_user_id,
    expiresAt: toDate(row.expires_at),
    revokedAt: toDateOrNull(row.revoked_at),
    lastViewedAt: toDateOrNull(row.last_viewed_at),
    viewCount: toInt(row.view_count, 0),
    createdAt: toDate(row.created_at),
  };
}

const DOCUMENT_COLUMNS = sql`
  d.id, f.name AS folder_name, f.visibility AS folder_visibility, d.kind, d.title, d.url, d.body,
  d.created_at, fo.id AS file_object_id, fo.byte_size::text AS byte_size,
  COALESCE(fo.detected_mime_type, fo.declared_mime_type) AS mime_type,
  fo.scan_status::text AS scan_status
`;

const DOCUMENT_FROM = sql`
  FROM project_documents d
  JOIN project_folders f ON f.organization_id = d.organization_id AND f.id = d.folder_id
  LEFT JOIN file_objects fo ON fo.organization_id = d.organization_id AND fo.id = d.file_object_id
`;

type DocumentRecord = {
  id: string;
  folder_name: string;
  folder_visibility: FolderVisibility;
  kind: 'FILE' | 'LINK' | 'NOTE';
  title: string;
  url: string | null;
  body: string | null;
  created_at: Date | string;
  file_object_id: string | null;
  byte_size: string | null;
  mime_type: string | null;
  scan_status: string | null;
};

function mapDocument(row: DocumentRecord): PortalDocumentRow {
  return {
    id: row.id,
    folderName: row.folder_name,
    folderVisibility: row.folder_visibility,
    kind: row.kind,
    title: row.title,
    url: row.url,
    body: row.body,
    mimeType: row.mime_type,
    byteSize: row.byte_size === null ? null : BigInt(row.byte_size),
    scanStatus: row.scan_status,
    fileObjectId: row.file_object_id,
    createdAt: toDate(row.created_at),
  };
}

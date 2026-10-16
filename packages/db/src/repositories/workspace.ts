import { sql } from 'drizzle-orm';
import {
  AppError,
  DEFAULT_PROJECT_FOLDERS,
  type DocumentKind,
  type FolderSystemKey,
  type FolderVisibility,
} from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate } from '../row-types.js';

/**
 * Project folders and documents — migration 0022, spec 2026-10-12 D10–D12.
 *
 * `ensureDefaultFolders` / `systemFolderId` are shared: project creation and
 * WhatsApp filing both depend on them. Everything else here serves the Files
 * tab and its routes.
 *
 * Visibility is enforced in the queries themselves, not left to the caller to
 * filter: a read made on behalf of a collaborator passes
 * `includeInternal: false`, and an INTERNAL folder or anything in it simply
 * does not come back (spec D10, "COLLABORATOR members never see INTERNAL").
 */

export interface FolderRow {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  visibility: FolderVisibility;
  systemKey: FolderSystemKey | null;
  position: number;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentRow {
  id: string;
  organizationId: string;
  projectId: string;
  folderId: string;
  folderVisibility: FolderVisibility;
  kind: DocumentKind;
  title: string;
  notes: string | null;
  url: string | null;
  body: string | null;
  source: 'WEB' | 'WHATSAPP' | 'PORTAL';
  file: {
    fileObjectId: string;
    filename: string;
    mimeType: string;
    byteSize: bigint;
    scanStatus: 'PENDING' | 'SCANNING' | 'CLEAN' | 'REJECTED' | 'FAILED';
    hasDerivative: boolean;
  } | null;
  addedByUserId: string | null;
  addedByLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewDocument {
  projectId: string;
  folderId: string;
  kind: DocumentKind;
  title: string;
  notes?: string | null;
  fileObjectId?: string | null;
  url?: string | null;
  body?: string | null;
  source?: 'WEB' | 'WHATSAPP' | 'PORTAL';
  addedByUserId?: string | null;
  addedByEmployeeId?: string | null;
  addedByContactId?: string | null;
  inboundMessageId?: string | null;
}

export interface VisibilityScope {
  /** False for collaborators: INTERNAL folders and their contents are invisible. */
  includeInternal: boolean;
}

export class WorkspaceRepository {
  constructor(readonly db: Database) {}

  /**
   * Creates any of the default folders the project does not have yet.
   *
   * Idempotent: keyed on (project, system_key), so calling it on every
   * project creation, every workspace read and every WhatsApp filing is safe,
   * and a project created before migration 0022 acquires its folders the first
   * time anyone looks. A default the owner renamed is matched by key, not by
   * name, so it is never recreated beside the renamed one.
   */
  async ensureDefaultFolders(
    tx: TransactionContext,
    ctx: TenantContext,
    projectId: string,
  ): Promise<void> {
    let position = 0;
    for (const folder of DEFAULT_PROJECT_FOLDERS) {
      await tx.db.execute(sql`
        INSERT INTO project_folders
          (id, organization_id, project_id, name, visibility, system_key, position, created_by_user_id)
        SELECT ${newId()}::uuid, ${ctx.organizationId}::uuid, ${projectId}::uuid,
               ${folder.name}, ${folder.visibility}, ${folder.systemKey}, ${position}, NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM project_folders
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND project_id = ${projectId}::uuid
            AND (system_key = ${folder.systemKey} OR lower(btrim(name)) = lower(${folder.name}))
        )
      `);
      position += 10;
    }
  }

  /** The id of a project's default folder, creating the defaults if needed. */
  async systemFolderId(
    tx: TransactionContext,
    ctx: TenantContext,
    projectId: string,
    systemKey: (typeof DEFAULT_PROJECT_FOLDERS)[number]['systemKey'],
  ): Promise<string> {
    await this.ensureDefaultFolders(tx, ctx, projectId);
    const result = await tx.db.execute<{ id: string }>(sql`
      SELECT id FROM project_folders
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND project_id = ${projectId}::uuid
        AND system_key = ${systemKey}
    `);
    const row = result.rows[0];
    if (!row) throw new Error(`default folder ${systemKey} missing after ensureDefaultFolders`);
    return row.id;
  }

  // --- Folders ----------------------------------------------------------------

  /** Folders in display order, each with its count of live documents. */
  async listFolders(
    db: Database,
    ctx: TenantContext,
    projectId: string,
    scope: VisibilityScope,
  ): Promise<FolderRow[]> {
    const result = await db.execute<FolderRecord>(sql`
      SELECT ${FOLDER_COLUMNS}
      FROM project_folders f
      WHERE f.organization_id = ${ctx.organizationId}::uuid
        AND f.project_id = ${projectId}::uuid
        ${scope.includeInternal ? sql`` : sql`AND f.visibility <> 'INTERNAL'`}
      ORDER BY f.position, f.created_at, f.id
    `);
    return result.rows.map(mapFolder);
  }

  async findFolder(
    db: Database,
    ctx: TenantContext,
    folderId: string,
    scope: VisibilityScope,
  ): Promise<FolderRow | null> {
    const result = await db.execute<FolderRecord>(sql`
      SELECT ${FOLDER_COLUMNS}
      FROM project_folders f
      WHERE f.organization_id = ${ctx.organizationId}::uuid
        AND f.id = ${folderId}::uuid
        ${scope.includeInternal ? sql`` : sql`AND f.visibility <> 'INTERNAL'`}
    `);
    const row = result.rows[0];
    return row ? mapFolder(row) : null;
  }

  async requireFolder(
    db: Database,
    ctx: TenantContext,
    folderId: string,
    scope: VisibilityScope,
  ): Promise<FolderRow> {
    const folder = await this.findFolder(db, ctx, folderId, scope);
    if (!folder) throw new AppError('FOLDER_NOT_FOUND');
    return folder;
  }

  /** Locks a folder row so concurrent delete/rename/move see one order. */
  async lockFolder(tx: TransactionContext, ctx: TenantContext, folderId: string): Promise<void> {
    await tx.db.execute(sql`
      SELECT id FROM project_folders
      WHERE organization_id = ${ctx.organizationId}::uuid AND id = ${folderId}::uuid
      FOR UPDATE
    `);
  }

  async createFolder(
    tx: TransactionContext,
    ctx: TenantContext,
    input: { projectId: string; name: string; visibility: FolderVisibility },
  ): Promise<FolderRow> {
    await this.assertNameFree(tx, ctx, input.projectId, input.name, null);
    const id = newId();
    // New folders go after everything else; positions are spaced by ten so a
    // reorder can slot one between two others without renumbering the rest.
    await translateFolderErrors(() =>
      tx.db.execute(sql`
        INSERT INTO project_folders
          (id, organization_id, project_id, name, visibility, system_key, position, created_by_user_id)
        SELECT ${id}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid,
               ${input.name}, ${input.visibility}, NULL,
               COALESCE(MAX(position), -10) + 10, ${ctx.userId}::uuid
        FROM project_folders
        WHERE organization_id = ${ctx.organizationId}::uuid AND project_id = ${input.projectId}::uuid
      `),
    );
    return this.requireFolder(tx.db, ctx, id, { includeInternal: true });
  }

  async updateFolder(
    tx: TransactionContext,
    ctx: TenantContext,
    folder: FolderRow,
    patch: { name?: string; visibility?: FolderVisibility; position?: number },
  ): Promise<FolderRow> {
    if (patch.name !== undefined) {
      await this.assertNameFree(tx, ctx, folder.projectId, patch.name, folder.id);
    }
    await translateFolderErrors(() =>
      tx.db.execute(sql`
        UPDATE project_folders SET
          name = COALESCE(${patch.name ?? null}, name),
          visibility = COALESCE(${patch.visibility ?? null}, visibility),
          position = COALESCE(${patch.position ?? null}::integer, position)
        WHERE organization_id = ${ctx.organizationId}::uuid AND id = ${folder.id}::uuid
      `),
    );
    return this.requireFolder(tx.db, ctx, folder.id, { includeInternal: true });
  }

  /**
   * Deletes an empty folder.
   *
   * A soft-deleted document still references its folder (the foreign key is
   * RESTRICT, and the row is kept for the record), so those are re-homed to
   * the project's first default folder before the delete. They stay deleted
   * and invisible; the audit chain already records where each one was.
   */
  async deleteFolder(tx: TransactionContext, ctx: TenantContext, folder: FolderRow): Promise<void> {
    const live = await tx.db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM project_documents
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND folder_id = ${folder.id}::uuid AND deleted_at IS NULL
    `);
    if (Number.parseInt(live.rows[0]?.count ?? '0', 10) > 0) {
      throw new AppError('FOLDER_NOT_EMPTY');
    }
    const home = await this.systemFolderId(
      tx,
      ctx,
      folder.projectId,
      DEFAULT_PROJECT_FOLDERS[0]?.systemKey ?? 'PLANS',
    );
    await tx.db.execute(sql`
      UPDATE project_documents SET folder_id = ${home}::uuid
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND folder_id = ${folder.id}::uuid AND deleted_at IS NOT NULL
    `);
    await tx.db.execute(sql`
      DELETE FROM project_folders
      WHERE organization_id = ${ctx.organizationId}::uuid AND id = ${folder.id}::uuid
    `);
  }

  private async assertNameFree(
    tx: TransactionContext,
    ctx: TenantContext,
    projectId: string,
    name: string,
    exceptFolderId: string | null,
  ): Promise<void> {
    const result = await tx.db.execute<{ id: string }>(sql`
      SELECT id FROM project_folders
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND project_id = ${projectId}::uuid
        AND lower(btrim(name)) = lower(btrim(${name}))
        ${exceptFolderId ? sql`AND id <> ${exceptFolderId}::uuid` : sql``}
    `);
    if (result.rows.length > 0) throw new AppError('FOLDER_NAME_TAKEN');
  }

  // --- Documents ----------------------------------------------------------------

  /** Live documents on a project, newest first within each folder. */
  async listDocuments(
    db: Database,
    ctx: TenantContext,
    projectId: string,
    scope: VisibilityScope,
  ): Promise<DocumentRow[]> {
    const result = await db.execute<DocumentRecord>(sql`
      SELECT ${DOCUMENT_COLUMNS}
      ${DOCUMENT_FROM}
      WHERE d.organization_id = ${ctx.organizationId}::uuid
        AND d.project_id = ${projectId}::uuid
        AND d.deleted_at IS NULL
        ${scope.includeInternal ? sql`` : sql`AND f.visibility <> 'INTERNAL'`}
      ORDER BY d.created_at DESC, d.id DESC
    `);
    return result.rows.map(mapDocument);
  }

  async findDocument(
    db: Database,
    ctx: TenantContext,
    documentId: string,
    scope: VisibilityScope,
  ): Promise<DocumentRow | null> {
    const result = await db.execute<DocumentRecord>(sql`
      SELECT ${DOCUMENT_COLUMNS}
      ${DOCUMENT_FROM}
      WHERE d.organization_id = ${ctx.organizationId}::uuid
        AND d.id = ${documentId}::uuid
        AND d.deleted_at IS NULL
        ${scope.includeInternal ? sql`` : sql`AND f.visibility <> 'INTERNAL'`}
    `);
    const row = result.rows[0];
    return row ? mapDocument(row) : null;
  }

  async requireDocument(
    db: Database,
    ctx: TenantContext,
    documentId: string,
    scope: VisibilityScope,
  ): Promise<DocumentRow> {
    const document = await this.findDocument(db, ctx, documentId, scope);
    if (!document) throw new AppError('DOCUMENT_NOT_FOUND');
    return document;
  }

  async insertDocument(
    tx: TransactionContext,
    ctx: TenantContext,
    input: NewDocument,
  ): Promise<DocumentRow> {
    const id = newId();
    await tx.db.execute(sql`
      INSERT INTO project_documents
        (id, organization_id, project_id, folder_id, kind, title, notes, file_object_id, url,
         body, source, added_by_user_id, added_by_employee_id, added_by_contact_id,
         inbound_message_id)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid,
        ${input.folderId}::uuid, ${input.kind}, ${input.title}, ${input.notes ?? null},
        ${input.fileObjectId ?? null}::uuid, ${input.url ?? null}, ${input.body ?? null},
        ${input.source ?? 'WEB'}, ${input.addedByUserId ?? null}::uuid,
        ${input.addedByEmployeeId ?? null}::uuid, ${input.addedByContactId ?? null}::uuid,
        ${input.inboundMessageId ?? null}::uuid
      )
    `);
    return this.requireDocument(tx.db, ctx, id, { includeInternal: true });
  }

  async updateDocument(
    tx: TransactionContext,
    ctx: TenantContext,
    documentId: string,
    patch: { title?: string; notes?: string | null; folderId?: string },
  ): Promise<DocumentRow> {
    await tx.db.execute(sql`
      UPDATE project_documents SET
        title = COALESCE(${patch.title ?? null}, title),
        notes = ${patch.notes === undefined ? sql`notes` : sql`${patch.notes}`},
        folder_id = COALESCE(${patch.folderId ?? null}::uuid, folder_id)
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND id = ${documentId}::uuid AND deleted_at IS NULL
    `);
    return this.requireDocument(tx.db, ctx, documentId, { includeInternal: true });
  }

  /** Soft delete: the row, and the stored file, stay for the record. */
  async softDeleteDocument(
    tx: TransactionContext,
    ctx: TenantContext,
    documentId: string,
  ): Promise<boolean> {
    const result = await tx.db.execute(sql`
      UPDATE project_documents SET deleted_at = now(), deleted_by_user_id = ${ctx.userId}::uuid
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND id = ${documentId}::uuid AND deleted_at IS NULL
    `);
    return (result.rowCount ?? 0) > 0;
  }

  /** The virtual "Approvals & change records" folder's counts. */
  async approvalCounts(
    db: Database,
    ctx: TenantContext,
    projectId: string,
  ): Promise<{ requestCount: number; decidedCount: number }> {
    const result = await db.execute<{ requests: string; decided: string }>(sql`
      SELECT
        (SELECT count(*) FROM change_orders
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND project_id = ${projectId}::uuid)::text AS requests,
        (SELECT count(*) FROM decisions
          WHERE organization_id = ${ctx.organizationId}::uuid
            AND project_id = ${projectId}::uuid)::text AS decided
    `);
    const row = result.rows[0];
    return {
      requestCount: Number.parseInt(row?.requests ?? '0', 10),
      decidedCount: Number.parseInt(row?.decided ?? '0', 10),
    };
  }

  /** A user's display name, for "who added it" and notification copy. */
  async userDisplayName(db: Database, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const result = await db.execute<{ display_name: string }>(sql`
      SELECT display_name FROM users WHERE id = ${userId}::uuid
    `);
    return result.rows[0]?.display_name ?? null;
  }
}

async function translateFolderErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const pg = error as { code?: string; constraint?: string } | null;
    // The pre-check makes this a race-only path: two people creating the same
    // name at once still get the friendly answer.
    if (pg?.code === '23505' && pg.constraint === 'project_folders_name_uidx') {
      throw new AppError('FOLDER_NAME_TAKEN');
    }
    throw error;
  }
}

const FOLDER_COLUMNS = sql`
  f.id, f.organization_id, f.project_id, f.name, f.visibility, f.system_key, f.position,
  f.created_at, f.updated_at,
  (SELECT count(*) FROM project_documents d
    WHERE d.organization_id = f.organization_id AND d.folder_id = f.id
      AND d.deleted_at IS NULL)::text AS document_count
`;

type FolderRecord = {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  visibility: FolderVisibility;
  system_key: FolderSystemKey | null;
  position: number;
  created_at: Date | string;
  updated_at: Date | string;
  document_count: string;
};

function mapFolder(row: FolderRecord): FolderRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    visibility: row.visibility,
    systemKey: row.system_key,
    position: Number(row.position),
    documentCount: Number.parseInt(row.document_count, 10),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

// "Who added it": a user by name; a WhatsApp sender by their roster or contact
// name with what they are, since they have no account to be named by.
const DOCUMENT_COLUMNS = sql`
  d.id, d.organization_id, d.project_id, d.folder_id, f.visibility AS folder_visibility,
  d.kind, d.title, d.notes, d.url, d.body, d.source, d.added_by_user_id,
  d.created_at, d.updated_at,
  fo.id AS file_object_id, fo.original_filename, fo.byte_size::text AS byte_size,
  COALESCE(fo.detected_mime_type, fo.declared_mime_type) AS mime_type,
  fo.scan_status::text AS scan_status,
  (fo.derivative_storage_key IS NOT NULL) AS has_derivative,
  COALESCE(
    u.display_name,
    e.name || ' (site team)',
    c.name || ' (homeowner)'
  ) AS added_by_label
`;

const DOCUMENT_FROM = sql`
  FROM project_documents d
  JOIN project_folders f
    ON f.organization_id = d.organization_id AND f.id = d.folder_id
  LEFT JOIN file_objects fo
    ON fo.organization_id = d.organization_id AND fo.id = d.file_object_id
  LEFT JOIN users u ON u.id = d.added_by_user_id
  LEFT JOIN employees e
    ON e.organization_id = d.organization_id AND e.id = d.added_by_employee_id
  LEFT JOIN contacts c
    ON c.organization_id = d.organization_id AND c.id = d.added_by_contact_id
`;

type DocumentRecord = {
  id: string;
  organization_id: string;
  project_id: string;
  folder_id: string;
  folder_visibility: FolderVisibility;
  kind: DocumentKind;
  title: string;
  notes: string | null;
  url: string | null;
  body: string | null;
  source: DocumentRow['source'];
  added_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  file_object_id: string | null;
  original_filename: string | null;
  byte_size: string | null;
  mime_type: string | null;
  scan_status: NonNullable<DocumentRow['file']>['scanStatus'] | null;
  has_derivative: boolean | null;
  added_by_label: string | null;
};

function mapDocument(row: DocumentRecord): DocumentRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    folderId: row.folder_id,
    folderVisibility: row.folder_visibility,
    kind: row.kind,
    title: row.title,
    notes: row.notes,
    url: row.url,
    body: row.body,
    source: row.source,
    file:
      row.file_object_id && row.scan_status
        ? {
            fileObjectId: row.file_object_id,
            filename: row.original_filename ?? 'file',
            mimeType: row.mime_type ?? 'application/octet-stream',
            byteSize: BigInt(row.byte_size ?? '0'),
            scanStatus: row.scan_status,
            hasDerivative: Boolean(row.has_derivative),
          }
        : null,
    addedByUserId: row.added_by_user_id,
    addedByLabel: row.added_by_label,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

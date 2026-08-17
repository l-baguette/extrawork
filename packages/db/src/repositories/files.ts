import { sql } from 'drizzle-orm';
import { AppError } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';
import { toDate, toDateOrNull } from '../row-types.js';

/**
 * File object registry. Report §9.7 (storage architecture and quarantine) and
 * §12.1 (type/size allowlist, malware scan, private storage).
 *
 * Bytes never touch this table — only metadata, the storage key and the scan
 * verdict. A file is not usable until `scan_status = 'CLEAN'`.
 */

export interface FileObjectRow {
  id: string;
  organizationId: string;
  projectId: string | null;
  storageKey: string;
  promotedStorageKey: string | null;
  derivativeStorageKey: string | null;
  originalFilename: string;
  declaredMimeType: string | null;
  detectedMimeType: string | null;
  byteSize: bigint;
  sha256: Buffer | null;
  scanStatus: 'PENDING' | 'SCANNING' | 'CLEAN' | 'REJECTED' | 'FAILED';
  scanDetail: string | null;
  purpose: string;
  imageWidth: number | null;
  imageHeight: number | null;
  uploadedAt: Date | null;
  createdAt: Date;
}

export class FileRepository {
  constructor(private readonly db: Database) {}

  async register(
    tx: TransactionContext,
    ctx: TenantContext,
    input: {
      /** Supplied by the caller when the storage key must embed the id. */
      id?: string;
      projectId: string | null;
      storageKey: string;
      filename: string;
      declaredMimeType: string;
      byteSize: bigint;
      purpose: string;
      sha256: Buffer | null;
    },
  ): Promise<FileObjectRow> {
    const id = input.id ?? newId();
    await tx.db.execute(sql`
      INSERT INTO file_objects
        (id, organization_id, project_id, storage_key, original_filename,
         declared_mime_type, byte_size, purpose, sha256, uploaded_by_user_id)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}::uuid, ${input.projectId}::uuid,
        ${input.storageKey}, ${input.filename}, ${input.declaredMimeType},
        ${input.byteSize.toString()}::bigint, ${input.purpose}, ${input.sha256},
        ${ctx.userId}::uuid
      )
    `);
    return this.requireById(ctx, id, tx.db);
  }

  async findById(
    ctx: TenantContext,
    id: string,
    db: Database = this.db,
  ): Promise<FileObjectRow | null> {
    const result = await db.execute<FileRecord>(sql`
      SELECT ${FILE_COLUMNS} FROM file_objects
      WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
    const row = result.rows[0];
    return row ? mapFile(row) : null;
  }

  async requireById(
    ctx: TenantContext,
    id: string,
    db: Database = this.db,
  ): Promise<FileObjectRow> {
    const row = await this.findById(ctx, id, db);
    if (!row) throw new AppError('ATTACHMENT_NOT_FOUND');
    return row;
  }

  /** Marks the byte upload complete so the scan job can be enqueued. */
  async markUploaded(tx: TransactionContext, ctx: TenantContext, id: string): Promise<void> {
    await tx.db.execute(sql`
      UPDATE file_objects SET uploaded_at = now(), scan_status = 'PENDING'
      WHERE id = ${id}::uuid AND organization_id = ${ctx.organizationId}::uuid
    `);
  }

  async claimForScan(db: Database, id: string): Promise<boolean> {
    const result = await db.execute(sql`
      UPDATE file_objects SET scan_status = 'SCANNING'
      WHERE id = ${id}::uuid AND scan_status IN ('PENDING','FAILED')
    `);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Records the scan verdict. Promotion out of quarantine only happens on a
   * clean verdict (report §9.7).
   */
  async recordScanResult(
    db: Database,
    id: string,
    input: {
      status: 'CLEAN' | 'REJECTED' | 'FAILED';
      detail: string | null;
      detectedMimeType: string | null;
      sha256: Buffer | null;
      promotedStorageKey: string | null;
      derivativeStorageKey: string | null;
      imageWidth: number | null;
      imageHeight: number | null;
      storageVersion: string | null;
    },
  ): Promise<void> {
    await db.execute(sql`
      UPDATE file_objects SET
        scan_status = ${input.status}::scan_status,
        scan_detail = ${input.detail},
        detected_mime_type = COALESCE(${input.detectedMimeType}, detected_mime_type),
        sha256 = COALESCE(${input.sha256}, sha256),
        promoted_storage_key = COALESCE(${input.promotedStorageKey}, promoted_storage_key),
        derivative_storage_key = COALESCE(${input.derivativeStorageKey}, derivative_storage_key),
        image_width = COALESCE(${input.imageWidth}, image_width),
        image_height = COALESCE(${input.imageHeight}, image_height),
        storage_version = COALESCE(${input.storageVersion}, storage_version),
        scanned_at = now()
      WHERE id = ${id}::uuid
    `);
  }

  /**
   * Report §9.5: deduplicate uploaded bytes within an organization by SHA-256,
   * but only after a clean scan, and keep separate logical records.
   */
  async findCleanDuplicate(
    ctx: TenantContext,
    sha256: Buffer,
    excludeId: string,
  ): Promise<FileObjectRow | null> {
    const result = await this.db.execute<FileRecord>(sql`
      SELECT ${FILE_COLUMNS} FROM file_objects
      WHERE organization_id = ${ctx.organizationId}::uuid
        AND sha256 = ${sha256}
        AND scan_status = 'CLEAN'
        AND id <> ${excludeId}::uuid
      ORDER BY created_at
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? mapFile(row) : null;
  }

  async listPendingScans(
    db: Database,
    limit: number,
  ): Promise<Array<{ id: string; organizationId: string }>> {
    const result = await db.execute<{ id: string; organization_id: string }>(sql`
      SELECT id, organization_id FROM file_objects
      WHERE scan_status = 'PENDING' AND uploaded_at IS NOT NULL
      ORDER BY uploaded_at
      LIMIT ${limit}
    `);
    return result.rows.map((r) => ({ id: r.id, organizationId: r.organization_id }));
  }

  /** Only a CLEAN file may be shown to a customer or embedded in evidence. */
  assertViewable(file: FileObjectRow): void {
    if (file.scanStatus !== 'CLEAN') {
      throw new AppError(
        file.scanStatus === 'REJECTED' ? 'FILE_SCAN_FAILED' : 'ATTACHMENT_NOT_READY',
        { details: { scanStatus: file.scanStatus } },
      );
    }
  }
}

const FILE_COLUMNS = sql`
  id, organization_id, project_id, storage_key, promoted_storage_key,
  derivative_storage_key, original_filename, declared_mime_type, detected_mime_type,
  byte_size, sha256, scan_status, scan_detail, purpose, image_width, image_height,
  uploaded_at, created_at
`;

type FileRecord = {
  id: string;
  organization_id: string;
  project_id: string | null;
  storage_key: string;
  promoted_storage_key: string | null;
  derivative_storage_key: string | null;
  original_filename: string;
  declared_mime_type: string | null;
  detected_mime_type: string | null;
  byte_size: string;
  sha256: Buffer | null;
  scan_status: FileObjectRow['scanStatus'];
  scan_detail: string | null;
  purpose: string;
  image_width: number | null;
  image_height: number | null;
  uploaded_at: Date | null;
  created_at: Date;
};

function mapFile(row: FileRecord): FileObjectRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    storageKey: row.storage_key,
    promotedStorageKey: row.promoted_storage_key,
    derivativeStorageKey: row.derivative_storage_key,
    originalFilename: row.original_filename,
    declaredMimeType: row.declared_mime_type,
    detectedMimeType: row.detected_mime_type,
    byteSize: BigInt(row.byte_size),
    sha256: row.sha256,
    scanStatus: row.scan_status,
    scanDetail: row.scan_detail,
    purpose: row.purpose,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    uploadedAt: toDateOrNull(row.uploaded_at),
    createdAt: toDate(row.created_at),
  };
}

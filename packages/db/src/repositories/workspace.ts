import { sql } from 'drizzle-orm';
import { DEFAULT_PROJECT_FOLDERS } from '@extrawork/contracts';
import type { TenantContext } from '@extrawork/domain';
import type { Database, TransactionContext } from '../client.js';
import { newId } from '../ids.js';

/**
 * Project folders and documents — migration 0022, spec 2026-10-12 D10–D12.
 * Slice C fills in the rest; `ensureDefaultFolders` is shared because project
 * creation and WhatsApp filing both depend on it.
 */
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
}

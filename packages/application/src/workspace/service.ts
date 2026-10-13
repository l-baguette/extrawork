import {
  AppError,
  DOMAIN_EVENTS,
  type AddDocumentInput,
  type CreateFolderInput,
  type UpdateDocumentInput,
  type UpdateFolderInput,
} from '@extrawork/contracts';
import type { DocumentRow, FolderRow, TransactionContext, VisibilityScope } from '@extrawork/db';
import {
  authorize,
  defaultLinkTitle,
  defaultNoteTitle,
  hasProjectAccess,
  roleAllows,
  type Actor,
} from '@extrawork/domain';
import { isImage } from '@extrawork/files';
import type { AppContext, RequestContext } from '../context.js';
import { NotificationService } from '../notifications/service.js';

/**
 * The project as a shared folder — spec 2026-10-12, D10–D12.
 *
 * Who may do what (spec RACI): everyone on a project reads its PROJECT and
 * CLIENT folders and may add files, links and notes to them; only the
 * designer's firm sees INTERNAL folders; only designer roles rename, move or
 * remove anything (`document:manage`). Every rule is checked here, never
 * inferred from what the UI chose to show.
 *
 * Order of checks: the thing is looked up *as the actor can see it* first, so
 * an INTERNAL folder or document is a 404 to a collaborator rather than a 403
 * that confirms it exists; the action is authorised after that.
 */

export interface WorkspaceView {
  projectId: string;
  folders: FolderRow[];
  documents: DocumentRow[];
  approvals: { requestCount: number; decidedCount: number };
  storage: { quotaBytes: bigint; usedBytes: bigint };
  canManageFolders: boolean;
  canUpload: boolean;
}

export class WorkspaceService {
  private readonly notifications: NotificationService;

  constructor(readonly app: AppContext) {
    this.notifications = new NotificationService(app);
  }

  /** What the actor may see: collaborators never see INTERNAL folders (D10). */
  static scopeFor(actor: Actor): VisibilityScope {
    return { includeInternal: actor.role !== 'COLLABORATOR' };
  }

  canManage(actor: Actor): boolean {
    return roleAllows(actor.role, 'document:manage');
  }

  async getWorkspace(ctx: RequestContext, projectId: string): Promise<WorkspaceView> {
    authorize(ctx.actor, 'document:read', {
      organizationId: ctx.tenant.organizationId,
      projectId,
    });
    await this.app.repos.projects.requireById(ctx.tenant, projectId);
    const scope = WorkspaceService.scopeFor(ctx.actor);

    // Folders are created lazily — a project made before migration 0022 gets
    // its defaults the first time anyone opens the Files tab.
    return this.app.uow.transaction(async (tx) => {
      await this.app.repos.workspace.ensureDefaultFolders(tx, ctx.tenant, projectId);
      const [folders, documents, approvals, organization, used] = await Promise.all([
        this.app.repos.workspace.listFolders(tx.db, ctx.tenant, projectId, scope),
        this.app.repos.workspace.listDocuments(tx.db, ctx.tenant, projectId, scope),
        this.app.repos.workspace.approvalCounts(tx.db, ctx.tenant, projectId),
        this.app.repos.organizations.findById(ctx.tenant),
        this.app.repos.organizations.storageUsedBytes(ctx.tenant, tx.db),
      ]);
      return {
        projectId,
        folders,
        documents,
        approvals,
        storage: { quotaBytes: organization?.storageQuotaBytes ?? 0n, usedBytes: used },
        canManageFolders: this.canManage(ctx.actor),
        canUpload: roleAllows(ctx.actor.role, 'document:upload'),
      };
    });
  }

  // --- Folders ----------------------------------------------------------------

  async createFolder(
    ctx: RequestContext,
    projectId: string,
    input: CreateFolderInput,
  ): Promise<FolderRow> {
    authorize(ctx.actor, 'document:manage', {
      organizationId: ctx.tenant.organizationId,
      projectId,
    });
    await this.app.repos.projects.requireById(ctx.tenant, projectId);
    return this.app.uow.transaction(async (tx) => {
      await this.app.repos.workspace.ensureDefaultFolders(tx, ctx.tenant, projectId);
      return this.app.repos.workspace.createFolder(tx, ctx.tenant, {
        projectId,
        name: input.name,
        visibility: input.visibility,
      });
    });
  }

  async updateFolder(
    ctx: RequestContext,
    folderId: string,
    patch: UpdateFolderInput,
  ): Promise<FolderRow> {
    const folder = await this.visibleFolder(ctx, folderId);
    authorize(ctx.actor, 'document:manage', {
      organizationId: folder.organizationId,
      projectId: folder.projectId,
    });
    // "From WhatsApp" is where site messages land; making it INTERNAL would
    // hide collaborators' own messages from them, so its audience is fixed.
    // Every default may be renamed: intake finds it by key, not by name.
    if (
      folder.systemKey === 'WHATSAPP' &&
      patch.visibility !== undefined &&
      patch.visibility !== folder.visibility
    ) {
      throw new AppError('FOLDER_PROTECTED', {
        message: 'The From WhatsApp folder is always shared with everyone on the project.',
      });
    }
    return this.app.uow.transaction(async (tx) => {
      await this.app.repos.workspace.lockFolder(tx, ctx.tenant, folder.id);
      return this.app.repos.workspace.updateFolder(tx, ctx.tenant, folder, patch);
    });
  }

  async deleteFolder(ctx: RequestContext, folderId: string): Promise<void> {
    const folder = await this.visibleFolder(ctx, folderId);
    authorize(ctx.actor, 'document:manage', {
      organizationId: folder.organizationId,
      projectId: folder.projectId,
    });
    if (folder.systemKey) throw new AppError('FOLDER_PROTECTED');
    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.workspace.lockFolder(tx, ctx.tenant, folder.id);
      await this.app.repos.workspace.deleteFolder(tx, ctx.tenant, folder);
    });
  }

  private async visibleFolder(ctx: RequestContext, folderId: string): Promise<FolderRow> {
    const folder = await this.app.repos.workspace.requireFolder(
      this.app.uow.db,
      ctx.tenant,
      folderId,
      WorkspaceService.scopeFor(ctx.actor),
    );
    // A folder on a project the actor is not granted is as invisible as one in
    // another workspace.
    if (!this.hasProject(ctx.actor, folder.projectId)) throw new AppError('FOLDER_NOT_FOUND');
    return folder;
  }

  // --- Documents ----------------------------------------------------------------

  async addDocument(
    ctx: RequestContext,
    projectId: string,
    input: AddDocumentInput,
  ): Promise<DocumentRow> {
    authorize(ctx.actor, 'document:upload', {
      organizationId: ctx.tenant.organizationId,
      projectId,
    });
    const project = await this.app.repos.projects.requireById(ctx.tenant, projectId);
    const scope = WorkspaceService.scopeFor(ctx.actor);

    return this.app.uow.transaction(async (tx) => {
      await this.app.repos.workspace.ensureDefaultFolders(tx, ctx.tenant, projectId);
      const folder = await this.app.repos.workspace.findFolder(
        tx.db,
        ctx.tenant,
        input.folderId,
        scope,
      );
      if (!folder || folder.projectId !== projectId) throw new AppError('FOLDER_NOT_FOUND');

      let title: string;
      let fileObjectId: string | null = null;
      if (input.kind === 'FILE') {
        const file = await this.app.repos.files.findById(ctx.tenant, input.fileObjectId, tx.db);
        // Only a file uploaded *for this project's folders* may be filed here:
        // a change-request photo or another project's drawing is not, even in
        // the same workspace.
        if (!file || file.projectId !== projectId || file.purpose !== 'PROJECT_DOCUMENT') {
          throw new AppError('ATTACHMENT_NOT_FOUND');
        }
        if (file.scanStatus === 'REJECTED') {
          throw new AppError('FILE_SCAN_FAILED', { details: { scanDetail: file.scanDetail } });
        }
        fileObjectId = file.id;
        title = input.title ?? file.originalFilename;
      } else if (input.kind === 'LINK') {
        title = input.title ?? defaultLinkTitle(input.url);
      } else {
        title = input.title ?? defaultNoteTitle(input.body);
      }

      const document = await this.app.repos.workspace.insertDocument(tx, ctx.tenant, {
        projectId,
        folderId: folder.id,
        kind: input.kind,
        title,
        notes: input.kind === 'NOTE' ? null : (input.notes ?? null),
        fileObjectId,
        url: input.kind === 'LINK' ? input.url : null,
        body: input.kind === 'NOTE' ? input.body : null,
        source: 'WEB',
        addedByUserId: ctx.actor.userId,
      });

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'project',
          aggregateId: projectId,
          projectId,
          eventType: DOMAIN_EVENTS.PROJECT_DOCUMENT_ADDED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            documentId: document.id,
            kind: document.kind,
            folderId: folder.id,
            folderName: folder.name,
            title: document.title,
            ...(fileObjectId ? { fileObjectId } : {}),
          },
        },
      ]);

      await this.notifyAdded(tx, ctx, project.title, folder, document);
      return document;
    });
  }

  async updateDocument(
    ctx: RequestContext,
    documentId: string,
    patch: UpdateDocumentInput,
  ): Promise<DocumentRow> {
    const document = await this.visibleDocument(ctx, documentId);
    authorize(ctx.actor, 'document:manage', {
      organizationId: document.organizationId,
      projectId: document.projectId,
    });
    return this.app.uow.transaction(async (tx) => {
      if (patch.folderId && patch.folderId !== document.folderId) {
        const target = await this.app.repos.workspace.findFolder(
          tx.db,
          ctx.tenant,
          patch.folderId,
          WorkspaceService.scopeFor(ctx.actor),
        );
        // Moving between projects would silently change who can see a file.
        if (!target || target.projectId !== document.projectId) {
          throw new AppError('FOLDER_NOT_FOUND');
        }
      }
      return this.app.repos.workspace.updateDocument(tx, ctx.tenant, document.id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
      });
    });
  }

  async deleteDocument(ctx: RequestContext, documentId: string): Promise<void> {
    const document = await this.visibleDocument(ctx, documentId);
    authorize(ctx.actor, 'document:manage', {
      organizationId: document.organizationId,
      projectId: document.projectId,
    });
    await this.app.uow.transaction(async (tx) => {
      const removed = await this.app.repos.workspace.softDeleteDocument(
        tx,
        ctx.tenant,
        document.id,
      );
      if (!removed) throw new AppError('DOCUMENT_NOT_FOUND');
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'project',
          aggregateId: document.projectId,
          projectId: document.projectId,
          eventType: DOMAIN_EVENTS.PROJECT_DOCUMENT_REMOVED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            documentId: document.id,
            kind: document.kind,
            folderId: document.folderId,
            title: document.title,
          },
        },
      ]);
    });
  }

  /**
   * A short-lived signed URL for a stored file. CLEAN files only. The default
   * is the original, as an attachment, and opaque bytes for anything that is
   * not an image (D10). `preview` serves an image's sanitised, EXIF-stripped
   * derivative instead — the same path change-request photos use.
   */
  async download(
    ctx: RequestContext,
    documentId: string,
    variant: 'original' | 'preview' = 'original',
  ): Promise<{ downloadUrl: string; filename: string; expiresAt: Date }> {
    const document = await this.visibleDocument(ctx, documentId);
    authorize(ctx.actor, 'document:read', {
      organizationId: document.organizationId,
      projectId: document.projectId,
    });
    if (document.kind !== 'FILE' || !document.file) throw new AppError('DOCUMENT_NOT_FOUND');
    const file = await this.app.repos.files.requireById(ctx.tenant, document.file.fileObjectId);
    this.app.repos.files.assertViewable(file);

    const mime = file.detectedMimeType ?? file.declaredMimeType ?? '';
    const ttl = this.app.env.SIGNED_URL_TTL_SECONDS;
    const expiresAt = new Date(this.app.clock.now().getTime() + ttl * 1000);
    if (variant === 'preview') {
      if (!isImage(mime) || !file.derivativeStorageKey) throw new AppError('DOCUMENT_NOT_FOUND');
      const filename = `${file.originalFilename.replace(/\.[^.]+$/, '')}.webp`;
      return {
        downloadUrl: await this.app.objectStore.createDownload(
          file.derivativeStorageKey,
          ttl,
          filename,
        ),
        filename,
        expiresAt,
      };
    }
    return {
      downloadUrl: await this.app.objectStore.createDownload(
        file.promotedStorageKey ?? file.storageKey,
        ttl,
        file.originalFilename,
        { forceDownload: !isImage(mime) },
      ),
      filename: file.originalFilename,
      expiresAt,
    };
  }

  private async visibleDocument(ctx: RequestContext, documentId: string): Promise<DocumentRow> {
    const document = await this.app.repos.workspace.requireDocument(
      this.app.uow.db,
      ctx.tenant,
      documentId,
      WorkspaceService.scopeFor(ctx.actor),
    );
    if (!this.hasProject(ctx.actor, document.projectId)) throw new AppError('DOCUMENT_NOT_FOUND');
    return document;
  }

  private hasProject(actor: Actor, projectId: string): boolean {
    return hasProjectAccess(actor, projectId);
  }

  /**
   * Shared folders tell everyone on the project; an INTERNAL one only the
   * designers. Never the person who added it.
   */
  private async notifyAdded(
    tx: TransactionContext,
    ctx: RequestContext,
    projectTitle: string,
    folder: FolderRow,
    document: DocumentRow,
  ): Promise<void> {
    const actorLabel = await this.app.repos.workspace.userDisplayName(tx.db, ctx.actor.userId);
    const isNote = document.kind === 'NOTE';
    const what = isNote ? 'a note' : document.kind === 'LINK' ? 'a link' : 'a file';
    await this.notifications.notifyProject(tx, ctx.tenant, {
      projectId: document.projectId,
      audience: folder.visibility === 'INTERNAL' ? 'DESIGNERS' : 'EVERYONE',
      excludeUserIds: [ctx.actor.userId],
      kind: isNote ? 'NOTE_ADDED' : 'DOCUMENT_ADDED',
      title: `${actorLabel ?? 'Someone'} added ${what} to ${folder.name}`,
      body: `${document.title} · ${projectTitle}`,
      linkPath: `/app/projects/${document.projectId}/files`,
      actorLabel,
    });
  }
}

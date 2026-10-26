import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AddDocumentSchema,
  CreateFolderSchema,
  UpdateDocumentSchema,
  UpdateFolderSchema,
  type DocumentDownloadDto,
  type ProjectDocumentDto,
  type ProjectFolderDto,
  type ProjectWorkspaceDto,
} from '@extrawork/contracts';
import type { AppContext, WorkspaceService, WorkspaceView } from '@extrawork/application';
import type { DocumentRow, FolderRow } from '@extrawork/db';
import { detectLinkProvider, type Actor } from '@extrawork/domain';
import { isImage } from '@extrawork/files';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

const IdParams = z.object({ id: z.string().uuid() });
const DownloadQuery = z.object({ variant: z.enum(['original', 'preview']).default('original') });

/**
 * Project folders, files, links and notes — spec 2026-10-12, D10–D12.
 *
 * Every route resolves the organization from the session, never the body,
 * and every visibility and role rule lives in `WorkspaceService`.
 */
export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  _appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });
  const write = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });
  const workspace = (): WorkspaceService => app.services.workspace;

  app.get('/v1/projects/:id/workspace', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const view = await workspace().getWorkspace(auth, id);
    return reply.send(toWorkspaceDto(view, auth.actor, workspace()));
  });

  app.post('/v1/projects/:id/folders', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'document:manage');
    const { id } = IdParams.parse(request.params);
    const input = CreateFolderSchema.parse(request.body);
    const folder = await workspace().createFolder(auth, id, input);
    return reply.status(201).send(toFolderDto(folder, []));
  });

  app.patch('/v1/folders/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'document:manage');
    const { id } = IdParams.parse(request.params);
    const patch = UpdateFolderSchema.parse(request.body);
    const folder = await workspace().updateFolder(auth, id, patch);
    return reply.send(toFolderDto(folder, []));
  });

  app.delete('/v1/folders/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'document:manage');
    const { id } = IdParams.parse(request.params);
    await workspace().deleteFolder(auth, id);
    return reply.status(204).send();
  });

  app.post('/v1/projects/:id/documents', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'document:upload');
    const { id } = IdParams.parse(request.params);
    const input = AddDocumentSchema.parse(request.body);
    const document = await workspace().addDocument(auth, id, input);
    return reply.status(201).send(toDocumentDto(document, workspace().canManage(auth.actor)));
  });

  app.patch('/v1/documents/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'document:manage');
    const { id } = IdParams.parse(request.params);
    const patch = UpdateDocumentSchema.parse(request.body);
    const document = await workspace().updateDocument(auth, id, patch);
    return reply.send(toDocumentDto(document, true));
  });

  app.delete('/v1/documents/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'document:manage');
    const { id } = IdParams.parse(request.params);
    await workspace().deleteDocument(auth, id);
    return reply.status(204).send();
  });

  app.get('/v1/documents/:id/download', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const { variant } = DownloadQuery.parse(request.query);
    const download = await workspace().download(auth, id, variant);
    const body: DocumentDownloadDto = {
      downloadUrl: download.downloadUrl,
      filename: download.filename,
      expiresAt: download.expiresAt.toISOString(),
    };
    return reply.send(body);
  });
}

export function toWorkspaceDto(
  view: WorkspaceView,
  actor: Actor,
  service: WorkspaceService,
): ProjectWorkspaceDto {
  const canManage = service.canManage(actor);
  const byFolder = new Map<string, DocumentRow[]>();
  for (const document of view.documents) {
    const list = byFolder.get(document.folderId) ?? [];
    list.push(document);
    byFolder.set(document.folderId, list);
  }
  return {
    projectId: view.projectId,
    folders: view.folders.map((folder) =>
      toFolderDto(folder, byFolder.get(folder.id) ?? [], canManage),
    ),
    approvals: view.approvals,
    storage: {
      quotaBytes: Number(view.storage.quotaBytes),
      usedBytes: Number(view.storage.usedBytes),
    },
    canManageFolders: view.canManageFolders,
    canUpload: view.canUpload,
  };
}

function toFolderDto(
  folder: FolderRow,
  documents: readonly DocumentRow[],
  canManage = true,
): ProjectFolderDto {
  return {
    id: folder.id,
    name: folder.name,
    visibility: folder.visibility,
    systemKey: folder.systemKey,
    position: folder.position,
    documentCount: folder.documentCount,
    documents: documents.map((d) => toDocumentDto(d, canManage)),
  };
}

export function toDocumentDto(document: DocumentRow, canManage: boolean): ProjectDocumentDto {
  return {
    id: document.id,
    folderId: document.folderId,
    kind: document.kind,
    title: document.title,
    notes: document.notes,
    file: document.file
      ? {
          fileObjectId: document.file.fileObjectId,
          filename: document.file.filename,
          mimeType: document.file.mimeType,
          byteSize: Number(document.file.byteSize),
          scanStatus: document.file.scanStatus,
          previewable:
            isImage(document.file.mimeType) &&
            document.file.hasDerivative &&
            document.file.scanStatus === 'CLEAN',
        }
      : null,
    url: document.url,
    linkProvider: document.url ? detectLinkProvider(document.url) : null,
    body: document.body,
    source: document.source,
    addedByLabel: document.addedByLabel,
    canManage,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

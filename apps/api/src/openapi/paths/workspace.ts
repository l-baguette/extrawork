import {
  AddDocumentSchema,
  CreateFolderSchema,
  DocumentDownloadSchema,
  ProjectDocumentSchema,
  ProjectFolderSchema,
  ProjectWorkspaceSchema,
  UpdateDocumentSchema,
  UpdateFolderSchema,
} from '@extrawork/contracts';
import type { OpenApiModule } from '../module.js';

/**
 * The project as a shared folder — spec 2026-10-12, D10–D12. Collaborators
 * never see INTERNAL folders: those, and anything in them, answer 404 to
 * them rather than 403.
 */
export const workspaceOpenApi: OpenApiModule = {
  schemas: {
    ProjectWorkspace: ProjectWorkspaceSchema,
    ProjectFolder: ProjectFolderSchema,
    ProjectDocument: ProjectDocumentSchema,
    CreateFolder: CreateFolderSchema,
    UpdateFolder: UpdateFolderSchema,
    AddDocument: AddDocumentSchema,
    UpdateDocument: UpdateDocumentSchema,
    DocumentDownload: DocumentDownloadSchema,
  },
  paths: (h) => ({
    '/v1/projects/{id}/workspace': {
      get: {
        tags: ['workspace'],
        summary: "A project's folders and documents as the caller may see them",
        description:
          'Creates the default folders on first read. Includes storage used against the workspace quota and the count of change records.',
        parameters: [h.pathParam('id', 'Project id')],
        responses: {
          '200': h.jsonResponse(
            'Folders in position order with live documents',
            'ProjectWorkspace',
          ),
          ...h.commonErrors,
        },
      },
    },
    '/v1/projects/{id}/folders': {
      post: {
        tags: ['workspace'],
        summary: 'Create a folder (designer roles)',
        parameters: [h.pathParam('id', 'Project id')],
        requestBody: h.jsonBody('CreateFolder'),
        responses: {
          '201': h.jsonResponse('Created', 'ProjectFolder'),
          '409': h.errorResponse('FOLDER_NAME_TAKEN'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/folders/{id}': {
      patch: {
        tags: ['workspace'],
        summary: 'Rename, reorder or change the visibility of a folder (designer roles)',
        description:
          'Default folders may be renamed; the From WhatsApp folder keeps its visibility (FOLDER_PROTECTED).',
        parameters: [h.pathParam('id', 'Folder id')],
        requestBody: h.jsonBody('UpdateFolder'),
        responses: {
          '200': h.jsonResponse('Updated', 'ProjectFolder'),
          '409': h.errorResponse('FOLDER_NAME_TAKEN or FOLDER_PROTECTED'),
          ...h.commonErrors,
        },
      },
      delete: {
        tags: ['workspace'],
        summary: 'Delete an empty, non-default folder (designer roles)',
        parameters: [h.pathParam('id', 'Folder id')],
        responses: {
          '204': { description: 'Deleted' },
          '409': h.errorResponse('FOLDER_NOT_EMPTY or FOLDER_PROTECTED'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/projects/{id}/documents': {
      post: {
        tags: ['workspace'],
        summary: 'Add a file, an https link or a note to a folder',
        description:
          'A FILE must be a PROJECT_DOCUMENT upload of this project. Notifies everyone on the project for shared folders and the designers for INTERNAL ones, never the person adding.',
        parameters: [h.pathParam('id', 'Project id')],
        requestBody: h.jsonBody('AddDocument'),
        responses: {
          '201': h.jsonResponse('Added', 'ProjectDocument'),
          '422': h.errorResponse('FILE_SCAN_FAILED'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/documents/{id}': {
      patch: {
        tags: ['workspace'],
        summary: 'Rename, annotate or move a document within its project (designer roles)',
        parameters: [h.pathParam('id', 'Document id')],
        requestBody: h.jsonBody('UpdateDocument'),
        responses: { '200': h.jsonResponse('Updated', 'ProjectDocument'), ...h.commonErrors },
      },
      delete: {
        tags: ['workspace'],
        summary: 'Remove a document (soft delete, audited; designer roles)',
        parameters: [h.pathParam('id', 'Document id')],
        responses: { '204': { description: 'Removed' }, ...h.commonErrors },
      },
    },
    '/v1/documents/{id}/download': {
      get: {
        tags: ['workspace'],
        summary: 'A short-lived signed URL for a stored file (CLEAN files only)',
        description:
          'Non-image files are always served as attachments with nosniff. `variant=preview` returns the sanitised image derivative.',
        parameters: [
          h.pathParam('id', 'Document id'),
          {
            name: 'variant',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['original', 'preview'], default: 'original' },
          },
        ],
        responses: {
          '200': h.jsonResponse('Signed URL', 'DocumentDownload'),
          '409': h.errorResponse('The file has not passed its scan yet'),
          ...h.commonErrors,
        },
      },
    },
  }),
};

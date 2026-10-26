import { z } from 'zod';
import {
  DocumentKindSchema,
  FolderSystemKeySchema,
  FolderVisibilitySchema,
  InstantSchema,
  LocalDateSchema,
  MilestoneKindSchema,
  UuidSchema,
} from '../primitives.js';

/**
 * The project as a shared folder — spec 2026-10-12, D10–D12.
 *
 * Folders hold documents. A document is an uploaded file, a link (Google
 * Drive, Dropbox, OneDrive or any https URL), or a short note.
 */

const FolderNameSchema = z.string().trim().min(1).max(80);

export const CreateFolderSchema = z.object({
  name: FolderNameSchema,
  visibility: FolderVisibilitySchema.default('PROJECT'),
});
export type CreateFolderInput = z.infer<typeof CreateFolderSchema>;

export const UpdateFolderSchema = z
  .object({
    name: FolderNameSchema,
    visibility: FolderVisibilitySchema,
    position: z.number().int().min(0).max(1_000),
  })
  .partial();
export type UpdateFolderInput = z.infer<typeof UpdateFolderSchema>;

/** https only: an http or javascript: link in a shared folder is a trap. */
export const HttpsUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .url()
  .refine((value) => value.startsWith('https://'), 'Links must start with https://');

export const AddDocumentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('FILE'),
    folderId: UuidSchema,
    /** A file already uploaded through `POST /v1/uploads` with purpose PROJECT_DOCUMENT. */
    fileObjectId: UuidSchema,
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(2_000).optional(),
  }),
  z.object({
    kind: z.literal('LINK'),
    folderId: UuidSchema,
    url: HttpsUrlSchema,
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(2_000).optional(),
  }),
  z.object({
    kind: z.literal('NOTE'),
    folderId: UuidSchema,
    body: z.string().trim().min(1).max(4_000),
    title: z.string().trim().min(1).max(200).optional(),
  }),
]);
export type AddDocumentInput = z.infer<typeof AddDocumentSchema>;

export const UpdateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2_000).nullable(),
    folderId: UuidSchema,
  })
  .partial();
export type UpdateDocumentInput = z.infer<typeof UpdateDocumentSchema>;

/** Recognised link hosts get an icon and a friendly label. */
export const LinkProviderSchema = z.enum(['GOOGLE_DRIVE', 'DROPBOX', 'ONEDRIVE', 'OTHER']);
export type LinkProvider = z.infer<typeof LinkProviderSchema>;

export const ProjectDocumentSchema = z.object({
  id: UuidSchema,
  folderId: UuidSchema,
  kind: DocumentKindSchema,
  title: z.string(),
  notes: z.string().nullable(),
  /** FILE only. */
  file: z
    .object({
      fileObjectId: UuidSchema,
      filename: z.string(),
      mimeType: z.string(),
      byteSize: z.number().int(),
      scanStatus: z.enum(['PENDING', 'SCANNING', 'CLEAN', 'REJECTED', 'FAILED']),
      /** True for images that have a sanitised preview. */
      previewable: z.boolean(),
    })
    .nullable(),
  /** LINK only. */
  url: z.string().nullable(),
  linkProvider: LinkProviderSchema.nullable(),
  /** NOTE only. */
  body: z.string().nullable(),
  source: z.enum(['WEB', 'WHATSAPP', 'PORTAL']),
  /** "Ramesh (site team)", "Priya Sharma (homeowner)", or the user's name. */
  addedByLabel: z.string().nullable(),
  /** True when the signed-in user may rename, move or remove it. */
  canManage: z.boolean(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
});
export type ProjectDocumentDto = z.infer<typeof ProjectDocumentSchema>;

export const ProjectFolderSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  visibility: FolderVisibilitySchema,
  systemKey: FolderSystemKeySchema.nullable(),
  position: z.number().int(),
  documentCount: z.number().int(),
  documents: z.array(ProjectDocumentSchema),
});
export type ProjectFolderDto = z.infer<typeof ProjectFolderSchema>;

export const ProjectWorkspaceSchema = z.object({
  projectId: UuidSchema,
  folders: z.array(ProjectFolderSchema),
  /** The virtual "Approvals & change records" folder. */
  approvals: z.object({
    requestCount: z.number().int(),
    decidedCount: z.number().int(),
  }),
  storage: z.object({
    quotaBytes: z.number().int(),
    usedBytes: z.number().int(),
  }),
  /** True when the signed-in user may create/rename/delete folders. */
  canManageFolders: z.boolean(),
  canUpload: z.boolean(),
});
export type ProjectWorkspaceDto = z.infer<typeof ProjectWorkspaceSchema>;

export const DocumentDownloadSchema = z.object({
  downloadUrl: z.string().url(),
  filename: z.string(),
  expiresAt: InstantSchema,
});
export type DocumentDownloadDto = z.infer<typeof DocumentDownloadSchema>;

// --- Milestones -------------------------------------------------------------

export const CreateMilestoneSchema = z.object({
  title: z.string().trim().min(1).max(160),
  kind: MilestoneKindSchema.default('MILESTONE'),
  dueDate: LocalDateSchema,
  notes: z.string().trim().max(2_000).optional(),
  clientVisible: z.boolean().default(true),
});
export type CreateMilestoneInput = z.infer<typeof CreateMilestoneSchema>;

export const UpdateMilestoneSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    kind: MilestoneKindSchema,
    dueDate: LocalDateSchema,
    notes: z.string().trim().max(2_000).nullable(),
    clientVisible: z.boolean(),
    completed: z.boolean(),
  })
  .partial();
export type UpdateMilestoneInput = z.infer<typeof UpdateMilestoneSchema>;

export const MilestoneSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  title: z.string(),
  kind: MilestoneKindSchema,
  dueDate: LocalDateSchema,
  notes: z.string().nullable(),
  clientVisible: z.boolean(),
  completedAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
});
export type MilestoneDto = z.infer<typeof MilestoneSchema>;

export const MilestoneListSchema = z.object({
  items: z.array(MilestoneSchema),
  /** True when the signed-in user may add, edit, complete or delete (designer roles). */
  canManage: z.boolean(),
});
export type MilestoneListDto = z.infer<typeof MilestoneListSchema>;

import type { FileObjectDto, PresignedUploadDto, ProjectDocumentDto } from '@extrawork/contracts';
import {
  PROJECT_FILE_TYPES,
  pollScanStatus,
  preflightUpload,
  sha256Hex,
  type PollOptions,
  type ScanSnapshot,
  type ScanState,
} from '../features/composer/attachment-upload';
import { ApiError, api, newIdempotencyKey } from './api';

/**
 * One file into a project folder: presign → PUT → complete → wait for the
 * scan → add it to the folder (spec 2026-10-12, D10–D11).
 *
 * Shared by the Files tab and the new-project form, and built on the
 * composer's pure helpers (pre-flight, type resolution, digest, scan polling)
 * rather than a copy of them, so a phone that reports '' for a DWG is treated
 * the same way everywhere.
 *
 * Imports are relative, not `@/…`, so the unit-test project can load this file
 * and drive the sequence with fakes.
 *
 * The file is added to the folder only once the scan has a verdict, so a
 * refused file never appears in anyone's folder; if the worker gives no
 * verdict in time it is added anyway, still marked "Checking", because the
 * download stays blocked server-side until it is clean.
 */

export type UploadStage = 'WAITING' | 'UPLOADING' | 'CHECKING' | 'FILING' | 'DONE' | 'FAILED';

export interface UploadProgress {
  stage: UploadStage;
  /** 0–1 while UPLOADING; null otherwise. */
  fraction: number | null;
}

export interface ProjectUploadTarget {
  projectId: string;
  folderId: string;
}

/** Raw PUT to the signed URL, with progress. Never sends session cookies. */
export type PutBytes = (
  upload: Pick<PresignedUploadDto, 'uploadUrl' | 'method' | 'headers'>,
  bytes: ArrayBuffer,
  onProgress: (fraction: number) => void,
) => Promise<void>;

export interface ProjectUploadDeps {
  api: typeof api;
  put: PutBytes;
  poll?: PollOptions;
}

export class ProjectUploadError extends Error {
  constructor(
    message: string,
    /** True when the server refused the file itself; retrying will not help. */
    readonly refused: boolean,
  ) {
    super(message);
    this.name = 'ProjectUploadError';
  }
}

export const UPLOAD_STAGE_LABELS: Record<UploadStage, string> = {
  WAITING: 'Waiting',
  UPLOADING: 'Uploading',
  CHECKING: 'Checking',
  FILING: 'Adding to folder',
  DONE: 'Added',
  FAILED: 'Not added',
};

/** A sentence a person on site can act on, for anything this sequence throws. */
export function describeUploadFailure(error: unknown): ProjectUploadError {
  if (error instanceof ProjectUploadError) return error;
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'STORAGE_QUOTA_EXCEEDED':
        return new ProjectUploadError(
          'Your workspace is out of storage. Remove old files or ask the owner to raise the limit.',
          true,
        );
      case 'FILE_TOO_LARGE':
      case 'PAYLOAD_TOO_LARGE':
        return new ProjectUploadError('That file is too large to upload.', true);
      case 'FILE_TYPE_NOT_ALLOWED':
      case 'UNSUPPORTED_MEDIA_TYPE':
      case 'FILE_SCAN_FAILED':
        return new ProjectUploadError(error.message, true);
      case 'FORBIDDEN':
        return new ProjectUploadError('You cannot add files to this project.', true);
      case 'SERVICE_UNAVAILABLE':
        return new ProjectUploadError(error.message, false);
      default:
        return new ProjectUploadError(`${error.message} (reference ${error.requestId})`, false);
    }
  }
  return new ProjectUploadError(
    'The upload did not complete. Check your connection and try again.',
    false,
  );
}

/** The browser PUT. XHR rather than fetch, because only XHR reports upload progress. */
export const xhrPut: PutBytes = (upload, bytes, onProgress) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.uploadUrl);
    for (const [name, value] of Object.entries(upload.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new ProjectUploadError('The upload did not complete. Try again.', false));
    };
    request.onerror = () =>
      reject(new ProjectUploadError('The upload stopped. Check your connection.', false));
    request.send(bytes);
  });

const DEFAULT_DEPS: ProjectUploadDeps = { api, put: xhrPut };

export async function uploadProjectFile(
  file: File | { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> },
  target: ProjectUploadTarget,
  onProgress: (progress: UploadProgress) => void = () => undefined,
  deps: ProjectUploadDeps = DEFAULT_DEPS,
): Promise<ProjectDocumentDto> {
  const checked = preflightUpload(file, { allowed: PROJECT_FILE_TYPES });
  if (!checked.ok) throw new ProjectUploadError(checked.reason, true);

  try {
    onProgress({ stage: 'UPLOADING', fraction: 0 });
    const bytes = await file.arrayBuffer();
    const presigned = await deps.api<PresignedUploadDto>('/v1/uploads', {
      method: 'POST',
      idempotencyKey: newIdempotencyKey(),
      body: {
        filename: checked.filename,
        contentType: checked.contentType,
        byteSize: file.size,
        purpose: 'PROJECT_DOCUMENT',
        projectId: target.projectId,
        sha256: await sha256Hex(bytes),
      },
    });

    await deps.put(presigned, bytes, (fraction) =>
      onProgress({ stage: 'UPLOADING', fraction: Math.min(1, Math.max(0, fraction)) }),
    );

    onProgress({ stage: 'CHECKING', fraction: null });
    await deps.api<FileObjectDto>('/v1/uploads/complete', {
      method: 'POST',
      body: { fileObjectId: presigned.fileObjectId },
    });

    const scan: ScanSnapshot | null = await pollScanStatus(async () => {
      const current = await deps.api<FileObjectDto>(`/v1/files/${presigned.fileObjectId}`);
      return { scanStatus: current.scanStatus as ScanState, scanDetail: current.scanDetail };
    }, deps.poll);
    if (scan && scan.scanStatus !== 'CLEAN') {
      throw new ProjectUploadError(
        scan.scanDetail ??
          (scan.scanStatus === 'REJECTED'
            ? 'This file was refused by the safety check.'
            : 'This file could not be checked. Try uploading it again.'),
        scan.scanStatus === 'REJECTED',
      );
    }

    onProgress({ stage: 'FILING', fraction: null });
    const document = await deps.api<ProjectDocumentDto>(
      `/v1/projects/${target.projectId}/documents`,
      {
        method: 'POST',
        body: { kind: 'FILE', folderId: target.folderId, fileObjectId: presigned.fileObjectId },
      },
    );
    onProgress({ stage: 'DONE', fraction: null });
    return document;
  } catch (error) {
    throw describeUploadFailure(error);
  }
}

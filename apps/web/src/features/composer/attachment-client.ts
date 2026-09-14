import type { FileObjectDto, PresignedUploadDto } from '@extrawork/contracts';
import { api, newIdempotencyKey } from '@/lib/api';
import {
  preflightUpload,
  pollScanStatus,
  sha256Hex,
  type ScanSnapshot,
  type ScanState,
} from './attachment-upload';

/**
 * The three-call upload sequence from report §9.7.
 *
 * The PUT goes straight to object storage — S3 in every real environment, the
 * local signed-URL endpoint in development — so it is a bare `fetch`. Sending
 * session cookies to a presigned S3 URL would be both useless and a credential
 * leak to a third-party origin, which is why this does not use `api()`.
 *
 * Lives in its own file, separate from `attachment-upload.ts`, because it
 * imports `@/lib/api` — a Next.js path alias the unit-test project does not
 * resolve. `attachment-upload.ts` stays import-alias-free so its 17 tests keep
 * loading it by relative path.
 */
export async function uploadAttachment(
  file: File,
  projectId: string,
): Promise<{ fileObjectId: string; scan: ScanSnapshot | null }> {
  const checked = preflightUpload(file);
  if (!checked.ok) throw new Error(checked.reason);

  const bytes = await file.arrayBuffer();
  const presigned = await api<PresignedUploadDto>('/v1/uploads', {
    method: 'POST',
    idempotencyKey: newIdempotencyKey(),
    body: {
      filename: checked.filename,
      contentType: checked.contentType,
      byteSize: file.size,
      purpose: 'CHANGE_ATTACHMENT',
      projectId,
      sha256: await sha256Hex(bytes),
    },
  });

  const stored = await fetch(presigned.uploadUrl, {
    method: presigned.method,
    headers: presigned.headers,
    body: bytes,
  });
  if (!stored.ok) throw new Error('The upload did not complete. Check your connection.');

  const completed = await api<FileObjectDto>('/v1/uploads/complete', {
    method: 'POST',
    body: { fileObjectId: presigned.fileObjectId },
  });

  const scan = await pollScanStatus(async () => {
    const current = await api<FileObjectDto>(`/v1/files/${presigned.fileObjectId}`);
    return { scanStatus: current.scanStatus as ScanState, scanDetail: current.scanDetail };
  });

  return { fileObjectId: completed.id, scan };
}

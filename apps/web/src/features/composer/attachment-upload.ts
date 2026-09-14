import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_FILE_BYTES,
  type AllowedMimeType,
} from '@extrawork/contracts';

/**
 * Browser-side upload pre-flight.
 *
 * The API repeats every one of these checks and remains authoritative. This
 * exists so a contractor on a site learns that a 40 MB video is not a
 * photograph before spending their data on it, rather than after.
 */

const ALLOWED = new Set<string>(ALLOWED_UPLOAD_MIME_TYPES);

/**
 * Extension fallback.
 *
 * Android and older iOS Safari hand over an empty `File.type` for HEIC and
 * occasionally for JPEG. Trusting the browser alone would make the camera
 * button appear broken on exactly the handsets this product targets. The
 * server still decides from the magic bytes, so a wrong guess here is caught
 * one step later and never reaches storage.
 */
const BY_EXTENSION: Record<string, AllowedMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
  pdf: 'application/pdf',
};

/** Path separators and control characters never reach the storage key. */
export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .split(/[/\\]/)
    .join('')
    // Matching control characters in order to strip them is the point, so the
    // no-control-regex rule is deliberately suppressed, as it is in
    // packages/contracts/src/api/files.ts for the same reason.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : 'upload';
}

export function resolveContentType(file: { name: string; type: string }): AllowedMimeType | null {
  if (ALLOWED.has(file.type)) return file.type as AllowedMimeType;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? null;
}

export type PreflightResult =
  | { ok: true; contentType: AllowedMimeType; filename: string }
  | { ok: false; reason: string };

function megabytes(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MB`;
}

export function preflightUpload(file: {
  name: string;
  type: string;
  size: number;
}): PreflightResult {
  const contentType = resolveContentType(file);
  if (!contentType) {
    return { ok: false, reason: 'Photographs and PDFs only (JPEG, PNG, WebP, HEIC or PDF).' };
  }
  if (file.size <= 0) {
    return { ok: false, reason: 'That file is empty.' };
  }
  const cap = MAX_FILE_BYTES[contentType];
  if (file.size > cap) {
    return { ok: false, reason: `That file is larger than ${megabytes(cap)}.` };
  }
  return { ok: true, contentType, filename: sanitizeFilename(file.name) };
}

/** Lowercase hex SHA-256, sent with the upload so the server can re-verify it. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

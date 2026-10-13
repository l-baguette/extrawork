import {
  ALLOWED_UPLOAD_MIME_TYPES,
  CHANGE_ATTACHMENT_MIME_TYPES,
  MAX_FILE_BYTES,
  UPLOAD_EXTENSION_TYPES,
  type AllowedMimeType,
} from '@extrawork/contracts';

/**
 * Browser-side upload pre-flight.
 *
 * The API repeats every one of these checks and remains authoritative. This
 * exists so a contractor on a site learns that a 40 MB video is not a
 * photograph before spending their data on it, rather than after.
 */

/** Everything a project folder accepts (spec 2026-10-12, D10). */
export const PROJECT_FILE_TYPES: ReadonlySet<AllowedMimeType> = new Set<AllowedMimeType>(
  ALLOWED_UPLOAD_MIME_TYPES,
);

/**
 * Extension fallback.
 *
 * Android and older iOS Safari hand over an empty `File.type` for HEIC and
 * occasionally for JPEG, or send `application/octet-stream` (uninformative).
 * Trusting only the browser's claim when it is uninformative would make the
 * camera button appear broken on exactly the handsets this product targets.
 * When the browser reports an informative but disallowed type (e.g., video/mp4),
 * we reject it immediately — that is a deliberate user action, not a platform gap.
 * The server still decides from the magic bytes, so a wrong guess here is caught
 * one step later and never reaches storage.
 */
const BY_EXTENSION: Readonly<Record<string, AllowedMimeType>> = UPLOAD_EXTENSION_TYPES;

/**
 * Types browsers report for files we accept under another name. Windows labels
 * every .csv as an Excel file, and CAD files arrive under half a dozen
 * unofficial names. Each alias only applies when the extension agrees, so a
 * real legacy .xls is never waved through as a CSV.
 */
const TYPE_ALIASES: Readonly<
  Record<string, { extensions: readonly string[]; type: AllowedMimeType }>
> = {
  'application/vnd.ms-excel': { extensions: ['csv'], type: 'text/csv' },
  'application/csv': { extensions: ['csv'], type: 'text/csv' },
  'application/x-csv': { extensions: ['csv'], type: 'text/csv' },
  'text/x-csv': { extensions: ['csv'], type: 'text/csv' },
  'text/comma-separated-values': { extensions: ['csv'], type: 'text/csv' },
  'image/vnd.dwg': { extensions: ['dwg'], type: 'application/acad' },
  'image/x-dwg': { extensions: ['dwg'], type: 'application/acad' },
  'application/x-dwg': { extensions: ['dwg'], type: 'application/acad' },
  'application/dwg': { extensions: ['dwg'], type: 'application/acad' },
  'image/vnd.dxf': { extensions: ['dxf'], type: 'application/dxf' },
  'image/x-dxf': { extensions: ['dxf'], type: 'application/dxf' },
  'application/x-dxf': { extensions: ['dxf'], type: 'application/dxf' },
};

/** Formats refused outright, with the reason the server would give. */
const REFUSED_EXTENSIONS: Readonly<Record<string, string>> = {
  xls: 'Older .xls/.doc files can carry macros. Save it as .xlsx or .docx and upload it again.',
  doc: 'Older .xls/.doc files can carry macros. Save it as .xlsx or .docx and upload it again.',
  ppt: 'Older .ppt files can carry macros. Save it as .pptx and upload it again.',
  xlsm: 'This file contains macros. Save it as .xlsx (without macros) and upload it again.',
  docm: 'This file contains macros. Save it as .docx (without macros) and upload it again.',
  pptm: 'This file contains macros. Save it as .pptx (without macros) and upload it again.',
};

function extensionOf(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : '';
}

/** A type is uninformative if the browser provided no meaningful classification. */
function isUninformativeType(type: string): boolean {
  return type === '' || type === 'application/octet-stream';
}

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

/**
 * The upload type for a picked file, or null when it is not one `allowed`
 * accepts. Defaults to the change-request attachment list, which is what the
 * composer offers; project folders pass `PROJECT_FILE_TYPES`.
 */
export function resolveContentType(
  file: { name: string; type: string },
  allowed: ReadonlySet<AllowedMimeType> = CHANGE_ATTACHMENT_MIME_TYPES,
): AllowedMimeType | null {
  const extension = extensionOf(file.name);
  let resolved: AllowedMimeType | null = null;
  if ((ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) {
    resolved = file.type as AllowedMimeType;
  } else if (isUninformativeType(file.type)) {
    resolved = BY_EXTENSION[extension] ?? null;
  } else {
    const alias = TYPE_ALIASES[file.type];
    if (alias && alias.extensions.includes(extension)) resolved = alias.type;
  }
  return resolved && allowed.has(resolved) ? resolved : null;
}

export type PreflightResult =
  | { ok: true; contentType: AllowedMimeType; filename: string }
  | { ok: false; reason: string };

function megabytes(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MB`;
}

const ATTACHMENT_TYPES_REASON =
  'Photographs and PDFs only (JPEG, PNG, WebP, HEIC or PDF), or an Excel sheet (.xlsx).';
const PROJECT_TYPES_REASON =
  'That type of file cannot be added. Use photos, PDFs, Excel, Word or PowerPoint (.xlsx, .docx, .pptx), CSV, TXT, or DWG/DXF drawings.';

export function preflightUpload(
  file: { name: string; type: string; size: number },
  options: { allowed?: ReadonlySet<AllowedMimeType> } = {},
): PreflightResult {
  const allowed = options.allowed ?? CHANGE_ATTACHMENT_MIME_TYPES;
  const refused = REFUSED_EXTENSIONS[extensionOf(file.name)];
  if (refused) return { ok: false, reason: refused };
  const contentType = resolveContentType(file, allowed);
  if (!contentType) {
    return {
      ok: false,
      reason:
        allowed === CHANGE_ATTACHMENT_MIME_TYPES ? ATTACHMENT_TYPES_REASON : PROJECT_TYPES_REASON,
    };
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

/** The `accept` attribute for a file input offering `types`. */
export function acceptAttribute(types: ReadonlySet<AllowedMimeType>): string {
  const extensions = Object.entries(UPLOAD_EXTENSION_TYPES)
    .filter(([, type]) => types.has(type))
    .map(([extension]) => `.${extension}`);
  return [...types, ...extensions].join(',');
}

/** Lowercase hex SHA-256, sent with the upload so the server can re-verify it. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export type ScanState = 'PENDING' | 'SCANNING' | 'CLEAN' | 'REJECTED' | 'FAILED';

export interface ScanSnapshot {
  scanStatus: ScanState;
  scanDetail: string | null;
}

export interface PollOptions {
  attempts?: number;
  delayMs?: (attempt: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

const SETTLED: ReadonlySet<ScanState> = new Set<ScanState>(['CLEAN', 'REJECTED', 'FAILED']);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Waits for the quarantine scan to reach a verdict.
 *
 * Returns `null` rather than throwing when the budget runs out, because "no
 * verdict yet" is not an error — it is usually a worker that is not running in
 * development, and the composer should say so instead of failing the upload.
 */
export async function pollScanStatus(
  read: () => Promise<ScanSnapshot>,
  options: PollOptions = {},
): Promise<ScanSnapshot | null> {
  const attempts = options.attempts ?? 20;
  // 1s, 2s, 3s, 4s, 5s, then 5s capped (15 more times): roughly 85 seconds total.
  const delayMs = options.delayMs ?? ((attempt: number) => Math.min(attempt * 1000, 5000));
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const snapshot = await read();
    if (SETTLED.has(snapshot.scanStatus)) return snapshot;
    if (attempt < attempts) await sleep(delayMs(attempt));
  }
  return null;
}

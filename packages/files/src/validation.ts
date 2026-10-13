import { createHash } from 'node:crypto';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  AppError,
  MAX_FILE_BYTES,
  type AllowedMimeType,
} from '@extrawork/contracts';
import { inspectOfficePackage, isZip } from './office.js';

/**
 * Upload validation — report §12.1 ("file type/size allowlist, malware scan,
 * image re-encode for display") and §9.7 (magic-byte MIME, image decodability,
 * hash).
 *
 * Declared types are never trusted. The verdict comes from the bytes.
 */

export interface MagicSignature {
  mime: AllowedMimeType;
  test: (bytes: Buffer) => boolean;
}

const SIGNATURES: MagicSignature[] = [
  {
    mime: 'image/jpeg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/heic',
    test: (b) => {
      if (b.length < 12) return false;
      if (b.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
      const brand = b.subarray(8, 12).toString('ascii');
      return ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand);
    },
  },
  {
    mime: 'application/pdf',
    test: (b) => b.length > 5 && b.subarray(0, 5).toString('ascii') === '%PDF-',
  },
];

export function detectMimeType(bytes: Buffer): AllowedMimeType | null {
  const sniffed = sniffContent(bytes);
  if (sniffed.kind === 'type') return sniffed.mime;
  if (sniffed.kind === 'text') return sniffed.dxf ? 'application/dxf' : 'text/plain';
  return null;
}

/** OLE2 compound file: legacy .xls/.doc/.ppt, which can carry VBA. */
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export const LEGACY_OFFICE_REASON =
  'Older .xls/.doc files can carry macros. Save it as .xlsx or .docx and upload it again.';

/** The types whose bytes are plain text, where content cannot tell them apart. */
const TEXT_TYPES: ReadonlySet<AllowedMimeType> = new Set<AllowedMimeType>([
  'text/csv',
  'text/plain',
]);

/**
 * What the bytes are, before the declared type is consulted.
 *
 *  - `type`    a binary format with a decisive signature
 *  - `text`    valid UTF-8 with no NUL bytes; CSV and TXT are indistinguishable
 *              here, so the declared type decides between them (spec D10)
 *  - `refuse`  a format we recognise and refuse, with the reason to show
 *  - `unknown` nothing on the allowlist
 */
type Sniffed =
  | { kind: 'type'; mime: AllowedMimeType }
  | { kind: 'text'; dxf: boolean }
  | { kind: 'refuse'; reason: string; mime: AllowedMimeType | null }
  | { kind: 'unknown' };

function sniffContent(bytes: Buffer): Sniffed {
  for (const signature of SIGNATURES) {
    if (signature.test(bytes)) return { kind: 'type', mime: signature.mime };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(OLE2_SIGNATURE)) {
    return { kind: 'refuse', reason: LEGACY_OFFICE_REASON, mime: null };
  }
  if (isZip(bytes)) {
    const office = inspectOfficePackage(bytes);
    return office.ok
      ? { kind: 'type', mime: office.mime }
      : { kind: 'refuse', reason: office.reason, mime: null };
  }
  // AutoCAD DWG: "AC10xx" version magic (AC1009 … AC1032).
  if (bytes.length >= 6 && /^AC1\d/.test(bytes.subarray(0, 4).toString('latin1'))) {
    return { kind: 'type', mime: 'application/acad' };
  }
  if (isUtf8Text(bytes)) return { kind: 'text', dxf: looksLikeDxf(bytes) };
  return { kind: 'unknown' };
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Valid UTF-8 (a BOM is allowed) with no NUL byte anywhere. */
export function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  const body = bytes.subarray(0, 3).equals(UTF8_BOM) ? bytes.subarray(3) : bytes;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(body);
    return true;
  } catch {
    return false;
  }
}

const DXF_SECTIONS = new Set(['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);

/**
 * ASCII DXF is pairs of lines: a group code, then a value. A real file opens
 * with `0 / SECTION / 2 / <name>` within its first few KB; free text does not.
 */
export function looksLikeDxf(bytes: Buffer): boolean {
  const lines = bytes
    .subarray(0, 8 * 1024)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim());
  for (let i = 0; i + 3 < lines.length; i += 1) {
    if (
      lines[i] === '0' &&
      lines[i + 1]?.toUpperCase() === 'SECTION' &&
      lines[i + 2] === '2' &&
      DXF_SECTIONS.has(lines[i + 3]?.toUpperCase() ?? '')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the content against the declared type. Text is the one place the
 * declared type is believed — between CSV and TXT, which the bytes cannot
 * distinguish — and only once the bytes are proven to be text.
 */
function resolveDetected(
  sniffed: Sniffed,
  declared: AllowedMimeType,
): { detected: AllowedMimeType | null; reason: string | null } {
  switch (sniffed.kind) {
    case 'type':
      return sniffed.mime === declared
        ? { detected: sniffed.mime, reason: null }
        : {
            detected: sniffed.mime,
            reason: `File contents are ${sniffed.mime} but ${declared} was declared`,
          };
    case 'refuse':
      return { detected: sniffed.mime, reason: sniffed.reason };
    case 'text':
      if (TEXT_TYPES.has(declared)) return { detected: declared, reason: null };
      if (declared === 'application/dxf') {
        return sniffed.dxf
          ? { detected: 'application/dxf', reason: null }
          : {
              detected: 'text/plain',
              reason: 'File is text but not a DXF drawing (no SECTION structure found)',
            };
      }
      return {
        detected: sniffed.dxf ? 'application/dxf' : 'text/plain',
        reason: `File contents are text but ${declared} was declared`,
      };
    case 'unknown':
      return { detected: null, reason: 'File contents do not match any allowed format' };
  }
}

export interface ValidationVerdict {
  ok: boolean;
  detectedMimeType: AllowedMimeType | null;
  sha256: Buffer;
  byteSize: number;
  reason: string | null;
}

/**
 * Polyglot detection: a file whose magic bytes disagree with what the client
 * declared is rejected outright rather than reclassified, because a
 * disagreement is a strong signal of an attack (report §14.5 security tests
 * call out "malicious file types and polyglots").
 */
export function validateBytes(
  bytes: Buffer,
  declaredMimeType: string,
  declaredByteSize: number,
): ValidationVerdict {
  const sha256 = createHash('sha256').update(bytes).digest();
  const base = { sha256, byteSize: bytes.length };

  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(declaredMimeType as AllowedMimeType)) {
    return { ...base, ok: false, detectedMimeType: null, reason: 'Declared type is not allowed' };
  }
  if (bytes.length === 0) {
    return { ...base, ok: false, detectedMimeType: null, reason: 'File is empty' };
  }
  if (bytes.length !== declaredByteSize) {
    return {
      ...base,
      ok: false,
      detectedMimeType: null,
      reason: `Uploaded ${bytes.length} bytes but ${declaredByteSize} were declared`,
    };
  }

  const resolved = resolveDetected(sniffContent(bytes), declaredMimeType as AllowedMimeType);
  const detected = resolved.detected;
  if (resolved.reason || !detected) {
    return {
      ...base,
      ok: false,
      detectedMimeType: detected,
      reason: resolved.reason ?? 'File contents do not match any allowed format',
    };
  }
  if (bytes.length > MAX_FILE_BYTES[detected]) {
    return {
      ...base,
      ok: false,
      detectedMimeType: detected,
      reason: `File exceeds the ${Math.round(MAX_FILE_BYTES[detected] / (1024 * 1024))} MB limit`,
    };
  }

  // A PDF that carries JavaScript or an embedded launch action is refused: this
  // product only needs static documents, so the safe subset is enough.
  if (detected === 'application/pdf') {
    const head = bytes.subarray(0, Math.min(bytes.length, 2 * 1024 * 1024)).toString('latin1');
    for (const marker of ['/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/OpenAction']) {
      if (head.includes(marker)) {
        return {
          ...base,
          ok: false,
          detectedMimeType: detected,
          reason: `PDF contains an active feature (${marker}) that is not allowed`,
        };
      }
    }
  }

  // SVG and HTML smuggled inside an allowed container.
  const prefix = bytes.subarray(0, 512).toString('latin1').toLowerCase();
  if (prefix.includes('<svg') || prefix.includes('<!doctype html') || prefix.includes('<script')) {
    return {
      ...base,
      ok: false,
      detectedMimeType: detected,
      reason: 'File contains markup that is not allowed',
    };
  }

  return { ...base, ok: true, detectedMimeType: detected, reason: null };
}

export function assertUploadRequestAllowed(input: {
  contentType: string;
  byteSize: number;
  maxUploadBytes: number;
}): void {
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(input.contentType as AllowedMimeType)) {
    throw new AppError('FILE_TYPE_NOT_ALLOWED', { details: { contentType: input.contentType } });
  }
  const typeLimit = MAX_FILE_BYTES[input.contentType as AllowedMimeType];
  const limit = Math.min(typeLimit, input.maxUploadBytes);
  if (input.byteSize > limit) {
    throw new AppError('FILE_TOO_LARGE', {
      message: `That file is larger than the ${Math.round(limit / (1024 * 1024))} MB limit.`,
      details: { maxBytes: limit },
    });
  }
  if (input.byteSize <= 0) {
    throw new AppError('VALIDATION_FAILED', { message: 'File size must be greater than zero' });
  }
}

export function isImage(mime: string): boolean {
  return mime.startsWith('image/');
}

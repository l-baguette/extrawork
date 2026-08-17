import { createHash } from 'node:crypto';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  AppError,
  MAX_FILE_BYTES,
  type AllowedMimeType,
} from '@extrawork/contracts';

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
  for (const signature of SIGNATURES) {
    if (signature.test(bytes)) return signature.mime;
  }
  return null;
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

  const detected = detectMimeType(bytes);
  if (!detected) {
    return {
      ...base,
      ok: false,
      detectedMimeType: null,
      reason: 'File contents do not match any allowed format',
    };
  }
  if (detected !== declaredMimeType) {
    return {
      ...base,
      ok: false,
      detectedMimeType: detected,
      reason: `File contents are ${detected} but ${declaredMimeType} was declared`,
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

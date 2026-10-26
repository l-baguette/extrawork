import { inflateRawSync } from 'node:zlib';
import type { AllowedMimeType } from '@extrawork/contracts';

/**
 * Office Open XML inspection — spec 2026-10-12, D10.
 *
 * An .xlsx/.docx/.pptx is a ZIP package. We read its central directory (never
 * extracting anything to disk) to answer three questions from the bytes alone:
 * is it a real OOXML package, which of the three formats is it, and does it
 * carry macros. The declared type is then held to that answer, exactly as the
 * image and PDF rules hold a declared type to the magic bytes.
 *
 * Macro-enabled siblings (.xlsm/.docm/.pptm) share the same container and main
 * part names, so the extension or main part cannot tell them apart; the
 * `vbaProject.bin` part and the macro-enabled content types can.
 */

export type OfficeInspection = { ok: true; mime: AllowedMimeType } | { ok: false; reason: string };

export const OFFICE_MACRO_REASON =
  'This file contains macros, which are not allowed. Save it without macros (as .xlsx, .docx or .pptx) and upload it again.';
export const OFFICE_INVALID_REASON =
  'This file is not a valid Excel, Word or PowerPoint document. Save it again as .xlsx, .docx or .pptx and upload it.';

const MAIN_PARTS: ReadonlyArray<{ part: string; mime: AllowedMimeType }> = [
  {
    part: 'xl/workbook.xml',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    part: 'word/document.xml',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  {
    part: 'ppt/presentation.xml',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
];

const CONTENT_TYPES_PART = '[Content_Types].xml';
/** The content-types part is a few KB; anything far larger is not a real one. */
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRIES = 20_000;

export function isZip(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

export function inspectOfficePackage(bytes: Buffer): OfficeInspection {
  const entries = readCentralDirectory(bytes);
  if (!entries) return { ok: false, reason: OFFICE_INVALID_REASON };

  const names = new Set(entries.map((e) => e.name));
  if (
    entries.some(
      (e) => /(^|\/)vbaProject\.bin$/i.test(e.name) || /(^|\/)vbaData\.xml$/i.test(e.name),
    )
  ) {
    return { ok: false, reason: OFFICE_MACRO_REASON };
  }

  const contentTypesEntry = entries.find((e) => e.name === CONTENT_TYPES_PART);
  if (!contentTypesEntry) return { ok: false, reason: OFFICE_INVALID_REASON };
  const contentTypes = readEntry(bytes, contentTypesEntry);
  if (contentTypes === null) return { ok: false, reason: OFFICE_INVALID_REASON };
  const declared = contentTypes.toString('utf8').toLowerCase();
  if (declared.includes('macroenabled') || declared.includes('vbaproject')) {
    return { ok: false, reason: OFFICE_MACRO_REASON };
  }

  const matches = MAIN_PARTS.filter((p) => names.has(p.part));
  const [match] = matches;
  // A package claiming to be two formats at once is not something Office makes.
  if (!match || matches.length !== 1) return { ok: false, reason: OFFICE_INVALID_REASON };
  return { ok: true, mime: match.mime };
}

function readCentralDirectory(bytes: Buffer): ZipEntry[] | null {
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) return null;
  const count = bytes.readUInt16LE(eocd + 10);
  const size = bytes.readUInt32LE(eocd + 12);
  const offset = bytes.readUInt32LE(eocd + 16);
  // ZIP64 markers: no Office document within the upload limits needs them.
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return null;
  if (count === 0 || count > MAX_ENTRIES || offset + size > eocd) return null;

  const entries: ZipEntry[] = [];
  let cursor = offset;
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) return null;
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localHeaderOffset = bytes.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > bytes.length) return null;
    // Bit 11: the name is UTF-8. Otherwise CP437, which agrees with latin1 for
    // every ASCII part name we look for.
    const name = bytes.subarray(cursor + 46, nameEnd).toString(flags & 0x0800 ? 'utf8' : 'latin1');
    entries.push({ name, method, compressedSize, localHeaderOffset });
    cursor = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

function readEntry(bytes: Buffer, entry: ZipEntry): Buffer | null {
  const header = entry.localHeaderOffset;
  if (header + 30 > bytes.length || bytes.readUInt32LE(header) !== LOCAL_SIGNATURE) return null;
  const start = header + 30 + bytes.readUInt16LE(header + 26) + bytes.readUInt16LE(header + 28);
  const end = start + entry.compressedSize;
  if (end > bytes.length || entry.compressedSize > MAX_CONTENT_TYPES_BYTES) return null;
  const data = bytes.subarray(start, end);
  try {
    if (entry.method === 0) return data;
    if (entry.method === 8) {
      return inflateRawSync(data, { maxOutputLength: MAX_CONTENT_TYPES_BYTES });
    }
  } catch {
    return null;
  }
  return null;
}

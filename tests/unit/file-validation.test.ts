import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_OFFICE_REASON,
  OFFICE_INVALID_REASON,
  OFFICE_MACRO_REASON,
  StructuralScanner,
  detectMimeType,
  processUploadedFile,
  validateBytes,
} from '@extrawork/files';

/**
 * The project-file allowlist — spec 2026-10-12, D10. Every fixture is built
 * here from a few bytes, so each rule is visible next to its test.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** A minimal ZIP: local headers, a central directory and the end record. */
function zip(entries: Record<string, string>, options: { deflate?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const data = options.deflate ? deflateRawSync(raw) : raw;
    const method = options.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const CONTENT_TYPES = (main: string) =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/x" ContentType="${main}"/></Types>`;

const xlsx = (deflate = true) =>
  zip(
    {
      '[Content_Types].xml': CONTENT_TYPES(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
      ),
      'xl/workbook.xml': '<workbook/>',
    },
    { deflate },
  );

function verdict(bytes: Buffer, declared: string) {
  return validateBytes(bytes, declared, bytes.length);
}

describe('Office Open XML', () => {
  it('accepts an .xlsx, .docx and .pptx whose package matches the declared type', () => {
    expect(verdict(xlsx(), XLSX)).toMatchObject({ ok: true, detectedMimeType: XLSX });
    expect(verdict(xlsx(false), XLSX).ok).toBe(true);
    const docx = zip({
      '[Content_Types].xml': CONTENT_TYPES('application/vnd.ms-word.document.main+xml'),
      'word/document.xml': '<document/>',
    });
    expect(verdict(docx, DOCX)).toMatchObject({ ok: true, detectedMimeType: DOCX });
    const pptx = zip({
      '[Content_Types].xml': CONTENT_TYPES('application/presentation.main+xml'),
      'ppt/presentation.xml': '<presentation/>',
    });
    expect(verdict(pptx, PPTX)).toMatchObject({ ok: true, detectedMimeType: PPTX });
  });

  it('detects the subtype from content, so a .docx declared as .xlsx is refused', () => {
    const docx = zip({
      '[Content_Types].xml': CONTENT_TYPES('application/word.main+xml'),
      'word/document.xml': '<document/>',
    });
    expect(detectMimeType(docx)).toBe(DOCX);
    const result = verdict(docx, XLSX);
    expect(result.ok).toBe(false);
    expect(result.detectedMimeType).toBe(DOCX);
  });

  it('refuses a package carrying vbaProject.bin with a save-without-macros message', () => {
    const xlsm = zip({
      '[Content_Types].xml': CONTENT_TYPES('application/sheet.main+xml'),
      'xl/workbook.xml': '<workbook/>',
      'xl/vbaProject.bin': 'binary',
    });
    expect(verdict(xlsm, XLSX)).toMatchObject({ ok: false, reason: OFFICE_MACRO_REASON });
  });

  it('refuses a macro-enabled content type even without a vbaProject part', () => {
    const docm = zip(
      {
        '[Content_Types].xml': CONTENT_TYPES(
          'application/vnd.ms-word.document.macroEnabled.main+xml',
        ),
        'word/document.xml': '<document/>',
      },
      { deflate: true },
    );
    expect(verdict(docm, DOCX)).toMatchObject({ ok: false, reason: OFFICE_MACRO_REASON });
  });

  it('refuses a ZIP that is not an Office package', () => {
    const plain = zip({ 'readme.txt': 'hello', 'payload.exe': 'MZ' });
    expect(verdict(plain, XLSX)).toMatchObject({ ok: false, reason: OFFICE_INVALID_REASON });
    const noMain = zip({ '[Content_Types].xml': CONTENT_TYPES('x'), 'docProps/app.xml': '<a/>' });
    expect(verdict(noMain, XLSX)).toMatchObject({ ok: false, reason: OFFICE_INVALID_REASON });
  });

  it('refuses a truncated ZIP with no central directory', () => {
    const truncated = xlsx().subarray(0, 40);
    expect(verdict(truncated, XLSX)).toMatchObject({ ok: false, reason: OFFICE_INVALID_REASON });
  });
});

describe('legacy Office', () => {
  it('refuses OLE2 .xls/.doc files whatever they are declared as', () => {
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(512, 0),
    ]);
    expect(verdict(ole, XLSX)).toMatchObject({ ok: false, reason: LEGACY_OFFICE_REASON });
    expect(verdict(ole, DOCX)).toMatchObject({ ok: false, reason: LEGACY_OFFICE_REASON });
    expect(LEGACY_OFFICE_REASON).toBe(
      'Older .xls/.doc files can carry macros. Save it as .xlsx or .docx and upload it again.',
    );
  });
});

describe('CSV and TXT', () => {
  const csv = Buffer.from('Item,Qty,Rate\nTiles,40,85\n', 'utf8');

  it('accepts UTF-8 text declared as CSV or TXT, with or without a BOM', () => {
    expect(verdict(csv, 'text/csv')).toMatchObject({ ok: true, detectedMimeType: 'text/csv' });
    expect(verdict(csv, 'text/plain')).toMatchObject({
      ok: true,
      detectedMimeType: 'text/plain',
    });
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('नमस्ते, ₹1,200\n')]);
    expect(verdict(bom, 'text/csv').ok).toBe(true);
  });

  it('refuses text containing a NUL byte', () => {
    const nul = Buffer.from('a,b\u0000,c\n', 'utf8');
    expect(verdict(nul, 'text/csv').ok).toBe(false);
  });

  it('refuses bytes that are not valid UTF-8', () => {
    const latin = Buffer.from([0x61, 0x2c, 0xe9, 0x2c, 0x62, 0x0a]);
    expect(verdict(latin, 'text/plain').ok).toBe(false);
  });

  it('refuses text declared as a binary type', () => {
    expect(verdict(csv, XLSX).ok).toBe(false);
    expect(verdict(csv, 'application/pdf').ok).toBe(false);
  });

  it('refuses a binary file declared as text', () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 1),
    ]);
    expect(verdict(png, 'text/csv')).toMatchObject({ ok: false, detectedMimeType: 'image/png' });
  });

  it('still refuses markup smuggled in a text file', () => {
    const html = Buffer.from('<!DOCTYPE html><script>alert(1)</script>');
    expect(verdict(html, 'text/plain').ok).toBe(false);
  });
});

describe('CAD drawings', () => {
  it('accepts a DWG by its AC10xx version header', () => {
    const dwg = Buffer.concat([Buffer.from('AC1032'), Buffer.alloc(128, 0)]);
    expect(verdict(dwg, 'application/acad')).toMatchObject({
      ok: true,
      detectedMimeType: 'application/acad',
    });
    const r14 = Buffer.concat([Buffer.from('AC1014'), Buffer.alloc(64, 0)]);
    expect(detectMimeType(r14)).toBe('application/acad');
  });

  it('refuses a DWG declared as something else, and garbage declared as DWG', () => {
    const dwg = Buffer.concat([Buffer.from('AC1027'), Buffer.alloc(64, 0)]);
    expect(verdict(dwg, 'application/pdf').ok).toBe(false);
    const fake = Buffer.concat([Buffer.from('ACAD!!'), Buffer.alloc(64, 0)]);
    expect(verdict(fake, 'application/acad').ok).toBe(false);
  });

  it('accepts an ASCII DXF with a SECTION/HEADER or ENTITIES structure', () => {
    const header = Buffer.from(
      '  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$ACADVER\r\n  1\r\nAC1015\r\n',
    );
    expect(verdict(header, 'application/dxf')).toMatchObject({
      ok: true,
      detectedMimeType: 'application/dxf',
    });
    const entities = Buffer.from('0\nSECTION\n2\nENTITIES\n0\nLINE\n0\nENDSEC\n0\nEOF\n');
    expect(verdict(entities, 'application/dxf').ok).toBe(true);
  });

  it('refuses plain text declared as DXF', () => {
    const text = Buffer.from('This is a note about the drawing, not a drawing.\n');
    expect(verdict(text, 'application/dxf').ok).toBe(false);
  });
});

describe('existing image and PDF rules still hold', () => {
  it('accepts matching images and PDFs and refuses an active PDF', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
    expect(verdict(jpeg, 'image/jpeg').ok).toBe(true);
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 1)]);
    expect(verdict(pdf, 'application/pdf').ok).toBe(true);
    const active = Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction 2 0 R >> endobj\n');
    expect(verdict(active, 'application/pdf').ok).toBe(false);
  });
});

describe('scanner routing', () => {
  it('never sends a non-image file to the image decoder', async () => {
    const bytes = xlsx();
    const result = await processUploadedFile(
      bytes,
      XLSX,
      bytes.length,
      new StructuralScanner(),
      'boq.xlsx',
    );
    expect(result.scan.verdict).toBe('CLEAN');
    expect(result.derivative).toBeNull();
    expect(result.imageWidth).toBeNull();
  });

  it('rejects a refused format before the scanner runs', async () => {
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(64, 0),
    ]);
    const result = await processUploadedFile(
      ole,
      XLSX,
      ole.length,
      new StructuralScanner(),
      'old.xls',
    );
    expect(result.scan).toMatchObject({ verdict: 'REJECTED', detail: LEGACY_OFFICE_REASON });
  });
});

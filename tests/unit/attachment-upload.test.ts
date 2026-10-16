import { describe, expect, it } from 'vitest';
import {
  PROJECT_FILE_TYPES,
  acceptAttribute,
  pollScanStatus,
  preflightUpload,
  resolveContentType,
  sanitizeFilename,
  type ScanSnapshot,
} from '../../apps/web/src/features/composer/attachment-upload.js';

describe('sanitizeFilename', () => {
  it('strips path separators so a filename cannot escape its storage key', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeFilename('folder\\photo.jpg')).toBe('folderphoto.jpg');
  });

  it('keeps ordinary camera filenames intact', () => {
    expect(sanitizeFilename('IMG_0421.HEIC')).toBe('IMG_0421.HEIC');
    expect(sanitizeFilename('site photo-3.jpg')).toBe('site photo-3.jpg');
  });

  it('falls back to a usable name when nothing survives', () => {
    expect(sanitizeFilename('///')).toBe('upload');
  });
});

describe('resolveContentType', () => {
  it('uses the browser-reported type when it is one we accept', () => {
    expect(resolveContentType({ name: 'a.jpg', type: 'image/jpeg' })).toBe('image/jpeg');
  });

  // Android and older iOS Safari hand over an empty string for HEIC and
  // sometimes for JPEG. Rejecting those would make the camera button look
  // broken on exactly the handsets this product is for.
  it('falls back to the extension when the browser reports no type', () => {
    expect(resolveContentType({ name: 'IMG_0421.HEIC', type: '' })).toBe('image/heic');
    expect(resolveContentType({ name: 'scan.PDF', type: '' })).toBe('application/pdf');
  });

  it('returns null for a type we do not accept', () => {
    expect(resolveContentType({ name: 'clip.mp4', type: 'video/mp4' })).toBeNull();
    expect(resolveContentType({ name: 'notes.txt', type: '' })).toBeNull();
  });

  it('rejects informative but disallowed type, even if extension is allowlisted', () => {
    expect(resolveContentType({ name: 'video.jpg', type: 'video/mp4' })).toBeNull();
  });

  it('falls back to extension when browser sends uninformative type like application/octet-stream', () => {
    expect(resolveContentType({ name: 'IMG_0421.HEIC', type: 'application/octet-stream' })).toBe(
      'image/heic',
    );
  });
});

describe('preflightUpload', () => {
  it('accepts an ordinary site photograph', () => {
    const result = preflightUpload({ name: 'wall.jpg', type: 'image/jpeg', size: 2_000_000 });
    expect(result).toEqual({ ok: true, contentType: 'image/jpeg', filename: 'wall.jpg' });
  });

  it('rejects a type outside the allowlist', () => {
    const result = preflightUpload({ name: 'clip.mp4', type: 'video/mp4', size: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Photographs and PDFs');
  });

  it('rejects informative but disallowed type even if filename extension suggests otherwise', () => {
    const result = preflightUpload({ name: 'video.jpg', type: 'video/mp4', size: 1000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Photographs and PDFs');
  });

  it('rejects a file over the cap for its own type', () => {
    const result = preflightUpload({
      name: 'huge.jpg',
      type: 'image/jpeg',
      size: 16 * 1024 * 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('15 MB');
  });

  it('rejects an empty file', () => {
    const result = preflightUpload({ name: 'empty.jpg', type: 'image/jpeg', size: 0 });
    expect(result.ok).toBe(false);
  });
});

describe('project files (spec 2026-10-12, D10)', () => {
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  it('falls back to the extension list for every project type when the browser reports none', () => {
    const project = { allowed: PROJECT_FILE_TYPES };
    expect(resolveContentType({ name: 'BOQ.xlsx', type: '' }, PROJECT_FILE_TYPES)).toBe(XLSX);
    expect(
      resolveContentType(
        { name: 'plan.DWG', type: 'application/octet-stream' },
        PROJECT_FILE_TYPES,
      ),
    ).toBe('application/acad');
    expect(resolveContentType({ name: 'site.dxf', type: '' }, PROJECT_FILE_TYPES)).toBe(
      'application/dxf',
    );
    expect(preflightUpload({ name: 'notes.txt', type: '', size: 20 }, project)).toEqual({
      ok: true,
      contentType: 'text/plain',
      filename: 'notes.txt',
    });
  });

  it('maps the Excel type Windows reports for a .csv only when the extension agrees', () => {
    expect(
      resolveContentType(
        { name: 'rates.csv', type: 'application/vnd.ms-excel' },
        PROJECT_FILE_TYPES,
      ),
    ).toBe('text/csv');
    expect(
      resolveContentType(
        { name: 'rates.xls', type: 'application/vnd.ms-excel' },
        PROJECT_FILE_TYPES,
      ),
    ).toBeNull();
  });

  it('refuses legacy and macro-enabled Office files with a save-as message', () => {
    const legacy = preflightUpload(
      { name: 'BOQ.xls', type: 'application/vnd.ms-excel', size: 100 },
      { allowed: PROJECT_FILE_TYPES },
    );
    expect(legacy).toEqual({
      ok: false,
      reason:
        'Older .xls/.doc files can carry macros. Save it as .xlsx or .docx and upload it again.',
    });
    const macro = preflightUpload(
      { name: 'rates.xlsm', type: '', size: 100 },
      { allowed: PROJECT_FILE_TYPES },
    );
    expect(macro.ok).toBe(false);
    if (!macro.ok) expect(macro.reason).toContain('macros');
  });

  it('keeps the composer to change-attachment types even for a known project type', () => {
    expect(resolveContentType({ name: 'plan.dwg', type: '' })).toBeNull();
    expect(resolveContentType({ name: 'BOQ.xlsx', type: '' })).toBe(XLSX);
    const result = preflightUpload({ name: 'plan.dwg', type: '', size: 100 });
    expect(result.ok).toBe(false);
  });

  it('applies the per-type cap, so a 40 MB drawing passes and a 40 MB CSV does not', () => {
    const project = { allowed: PROJECT_FILE_TYPES };
    expect(preflightUpload({ name: 'a.dwg', type: '', size: 40 * 1024 * 1024 }, project).ok).toBe(
      true,
    );
    const csv = preflightUpload(
      { name: 'a.csv', type: 'text/csv', size: 40 * 1024 * 1024 },
      project,
    );
    expect(csv.ok).toBe(false);
    if (!csv.ok) expect(csv.reason).toContain('5 MB');
  });

  it('builds an accept list of types and extensions', () => {
    const accept = acceptAttribute(PROJECT_FILE_TYPES).split(',');
    expect(accept).toContain('application/acad');
    expect(accept).toContain('.dwg');
    expect(accept).toContain('.xlsx');
    expect(accept).not.toContain('.xls');
  });
});

describe('pollScanStatus', () => {
  const noSleep = async (): Promise<void> => undefined;

  it('returns as soon as the scan settles', async () => {
    const snapshots: ScanSnapshot[] = [
      { scanStatus: 'PENDING', scanDetail: null },
      { scanStatus: 'SCANNING', scanDetail: null },
      { scanStatus: 'CLEAN', scanDetail: null },
    ];
    let calls = 0;
    const result = await pollScanStatus(
      async () => snapshots[calls++] ?? snapshots[snapshots.length - 1]!,
      { sleep: noSleep },
    );
    expect(result).toEqual({ scanStatus: 'CLEAN', scanDetail: null });
    expect(calls).toBe(3);
  });

  it('returns a rejection verdict rather than treating it as unfinished', async () => {
    const result = await pollScanStatus(
      async () => ({ scanStatus: 'REJECTED', scanDetail: 'Not a decodable image' }),
      { sleep: noSleep },
    );
    expect(result).toEqual({ scanStatus: 'REJECTED', scanDetail: 'Not a decodable image' });
  });

  // A worker that is not running must not hang the composer forever.
  it('gives up after the attempt budget and reports no verdict', async () => {
    let calls = 0;
    const result = await pollScanStatus(
      async () => {
        calls++;
        return { scanStatus: 'PENDING', scanDetail: null };
      },
      { attempts: 4, sleep: noSleep },
    );
    expect(result).toBeNull();
    expect(calls).toBe(4);
  });

  it('backs off instead of polling at a fixed fast interval', async () => {
    const waits: number[] = [];
    await pollScanStatus(async () => ({ scanStatus: 'PENDING', scanDetail: null }), {
      attempts: 4,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(waits.at(-1)!).toBeGreaterThan(waits[0]!);
  });
});

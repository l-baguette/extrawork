import { describe, expect, it } from 'vitest';
import {
  documentTypeLabel,
  formatBytes,
  scanStateLabel,
  storageSummary,
} from '../../apps/web/src/lib/files-display.js';

describe('files display', () => {
  it('formats sizes in binary units', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(26)).toBe('0.1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2 GB');
  });

  it('labels files by type, links by provider, and notes as notes', () => {
    const file = (mimeType: string) => ({
      kind: 'FILE' as const,
      linkProvider: null,
      file: {
        fileObjectId: 'x',
        filename: 'x',
        mimeType,
        byteSize: 1,
        scanStatus: 'CLEAN' as const,
        previewable: false,
      },
    });
    expect(documentTypeLabel(file('application/acad'))).toBe('AutoCAD drawing');
    expect(documentTypeLabel(file('application/x-unknown'))).toBe('File');
    expect(documentTypeLabel({ kind: 'LINK', file: null, linkProvider: 'GOOGLE_DRIVE' })).toBe(
      'Google Drive',
    );
    expect(documentTypeLabel({ kind: 'NOTE', file: null, linkProvider: null })).toBe('Note');
  });

  it('says nothing about clean files and flags the rest', () => {
    expect(scanStateLabel('CLEAN')).toBeNull();
    expect(scanStateLabel('PENDING')).toMatchObject({ label: 'Checking', tone: 'waiting' });
    expect(scanStateLabel('REJECTED')).toMatchObject({ label: 'Refused', tone: 'declined' });
  });

  it('summarises storage and warns near the limit', () => {
    const half = storageSummary({ usedBytes: 1024 ** 3, quotaBytes: 2 * 1024 ** 3 });
    expect(half).toEqual({ text: '1 GB of 2 GB used', fraction: 0.5, nearlyFull: false });
    expect(storageSummary({ usedBytes: 3, quotaBytes: 2 }).fraction).toBe(1);
    expect(storageSummary({ usedBytes: 95, quotaBytes: 100 }).nearlyFull).toBe(true);
  });
});

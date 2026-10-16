import {
  MIME_TYPE_LABELS,
  type AllowedMimeType,
  type ProjectDocumentDto,
} from '@extrawork/contracts';

/**
 * Words for the file browser (spec 2026-10-12, D10). Pure and alias-free so
 * the unit project can load it.
 */

/** "2.4 MB", "820 KB", "1.2 GB" — binary units, one decimal under ten. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.trunc(value));
  return `${value > 0 && value < 0.1 ? '0.1' : shown} ${units[unit]}`;
}

const LINK_LABELS: Record<NonNullable<ProjectDocumentDto['linkProvider']>, string> = {
  GOOGLE_DRIVE: 'Google Drive',
  DROPBOX: 'Dropbox',
  ONEDRIVE: 'OneDrive',
  OTHER: 'Link',
};

/** The type chip: "Excel sheet", "Google Drive", "Note". */
export function documentTypeLabel(
  document: Pick<ProjectDocumentDto, 'kind' | 'file' | 'linkProvider'>,
): string {
  if (document.kind === 'NOTE') return 'Note';
  if (document.kind === 'LINK') return LINK_LABELS[document.linkProvider ?? 'OTHER'];
  const mime = document.file?.mimeType ?? '';
  return MIME_TYPE_LABELS[mime as AllowedMimeType] ?? 'File';
}

export type ScanTone = 'approved' | 'waiting' | 'declined' | 'neutral';

/** Null when there is nothing to say: a clean file is just a file. */
export function scanStateLabel(
  scanStatus: NonNullable<ProjectDocumentDto['file']>['scanStatus'],
): { label: string; tone: ScanTone; code: string } | null {
  switch (scanStatus) {
    case 'CLEAN':
      return null;
    case 'PENDING':
    case 'SCANNING':
      return { label: 'Checking', tone: 'waiting', code: 'W' };
    case 'REJECTED':
      return { label: 'Refused', tone: 'declined', code: 'D' };
    case 'FAILED':
      return { label: 'Could not check', tone: 'neutral', code: 'N' };
  }
}

/** Storage as a sentence and a 0–1 fill, clamped. */
export function storageSummary(storage: { usedBytes: number; quotaBytes: number }): {
  text: string;
  fraction: number;
  nearlyFull: boolean;
} {
  const fraction =
    storage.quotaBytes > 0 ? Math.min(1, Math.max(0, storage.usedBytes / storage.quotaBytes)) : 1;
  return {
    text: `${formatBytes(storage.usedBytes)} of ${formatBytes(storage.quotaBytes)} used`,
    fraction,
    nearlyFull: fraction >= 0.9,
  };
}

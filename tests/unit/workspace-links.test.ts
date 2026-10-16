import { describe, expect, it } from 'vitest';
import { defaultLinkTitle, defaultNoteTitle, detectLinkProvider } from '@extrawork/domain';

/** Links in project folders (spec 2026-10-12, D12). */

describe('detectLinkProvider', () => {
  it('recognises Google Drive and Docs links', () => {
    expect(detectLinkProvider('https://drive.google.com/drive/folders/abc')).toBe('GOOGLE_DRIVE');
    expect(detectLinkProvider('https://docs.google.com/spreadsheets/d/abc/edit')).toBe(
      'GOOGLE_DRIVE',
    );
  });

  it('recognises Dropbox and OneDrive / SharePoint links', () => {
    expect(detectLinkProvider('https://www.dropbox.com/s/abc/plan.pdf')).toBe('DROPBOX');
    expect(detectLinkProvider('https://onedrive.live.com/?id=abc')).toBe('ONEDRIVE');
    expect(detectLinkProvider('https://1drv.ms/f/s!abc')).toBe('ONEDRIVE');
    expect(detectLinkProvider('https://acme-my.sharepoint.com/personal/x')).toBe('ONEDRIVE');
  });

  it('matches the host exactly, so look-alike hosts are OTHER', () => {
    expect(detectLinkProvider('https://drive.google.com.evil.test/x')).toBe('OTHER');
    expect(detectLinkProvider('https://evil.test/drive.google.com')).toBe('OTHER');
    expect(detectLinkProvider('https://notsharepoint.com/x')).toBe('OTHER');
    expect(detectLinkProvider('not a url')).toBe('OTHER');
  });
});

describe('default titles', () => {
  it('names a recognised link by its service, any other by its host', () => {
    expect(defaultLinkTitle('https://drive.google.com/x')).toBe('Google Drive link');
    expect(defaultLinkTitle('https://www.example.com/a/b')).toBe('example.com');
  });

  it('titles a note by its first non-empty line, shortened', () => {
    expect(defaultNoteTitle('\n  Tile delivery Friday \nCall Ramesh')).toBe('Tile delivery Friday');
    const long = defaultNoteTitle('x'.repeat(200));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('…')).toBe(true);
  });
});

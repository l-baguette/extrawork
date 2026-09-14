import { describe, expect, it } from 'vitest';
import {
  preflightUpload,
  resolveContentType,
  sanitizeFilename,
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

import { describe, expect, it } from 'vitest';
import { safeNext, withNext } from '../../apps/web/src/lib/safe-next.js';

describe('safeNext — the post-sign-in return path', () => {
  it('keeps a same-origin path', () => {
    expect(safeNext('/invite/abc_DEF-123')).toBe('/invite/abc_DEF-123');
    expect(safeNext('/app/projects/1?tab=team')).toBe('/app/projects/1?tab=team');
  });

  it('refuses anything a browser would treat as another origin', () => {
    for (const hostile of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '',
    ]) {
      expect(safeNext(hostile), hostile).toBe('/app/dashboard');
    }
    expect(safeNext(null)).toBe('/app/dashboard');
    expect(safeNext('/' + 'a'.repeat(600))).toBe('/app/dashboard');
  });

  it('builds a sign-in link only with a safe target', () => {
    expect(withNext('/sign-in', '/invite/tok')).toBe('/sign-in?next=%2Finvite%2Ftok');
    expect(withNext('/sign-in', '//evil.example')).toBe('/sign-in');
    expect(withNext('/sign-in', null)).toBe('/sign-in');
  });
});

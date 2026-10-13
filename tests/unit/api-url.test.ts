import { describe, expect, it } from 'vitest';
import { resolveBrowserApiUrl } from '../../apps/web/src/lib/api.js';

describe('browser API URL resolution', () => {
  it('replaces compiled localhost with the LAN host serving the web app', () => {
    expect(
      resolveBrowserApiUrl('http://localhost:4000', {
        protocol: 'http:',
        hostname: '192.168.1.180',
      }),
    ).toBe('http://192.168.1.180:4000');
  });

  it('replaces a compiled LAN host when the web app is opened on localhost', () => {
    expect(
      resolveBrowserApiUrl('http://192.168.1.180:4000', {
        protocol: 'http:',
        hostname: 'localhost',
      }),
    ).toBe('http://localhost:4000');
  });

  it('keeps loopback aliases on the same cookie host', () => {
    expect(
      resolveBrowserApiUrl('http://localhost:4000', {
        protocol: 'http:',
        hostname: '127.0.0.1',
      }),
    ).toBe('http://127.0.0.1:4000');
  });

  it('preserves an explicitly configured remote API', () => {
    expect(
      resolveBrowserApiUrl('https://api.example.com/', {
        protocol: 'https:',
        hostname: 'app.example.com',
      }),
    ).toBe('https://api.example.com');
  });
});

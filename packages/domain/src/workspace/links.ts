import type { LinkProvider } from '@extrawork/contracts';

/**
 * Links in a project folder — spec 2026-10-12, D12. Drive is linked, not
 * synced, so the most the product can do with a link is recognise where it
 * points and give it a sensible title.
 */

const PROVIDERS: ReadonlyArray<{ provider: LinkProvider; hosts: RegExp }> = [
  { provider: 'GOOGLE_DRIVE', hosts: /^(drive|docs)\.google\.com$/ },
  { provider: 'DROPBOX', hosts: /^(www\.)?dropbox\.com$|^dl\.dropboxusercontent\.com$/ },
  { provider: 'ONEDRIVE', hosts: /^onedrive\.live\.com$|^1drv\.ms$|(^|\.)sharepoint\.com$/ },
];

export const LINK_PROVIDER_LABELS: Readonly<Record<LinkProvider, string>> = {
  GOOGLE_DRIVE: 'Google Drive',
  DROPBOX: 'Dropbox',
  ONEDRIVE: 'OneDrive',
  OTHER: 'Link',
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Which service a link points at. Matched on the exact host, never a substring. */
export function detectLinkProvider(url: string): LinkProvider {
  const host = hostOf(url);
  if (!host) return 'OTHER';
  return PROVIDERS.find((p) => p.hosts.test(host))?.provider ?? 'OTHER';
}

/** "Google Drive link" for a recognised service; otherwise the bare host name. */
export function defaultLinkTitle(url: string): string {
  const provider = detectLinkProvider(url);
  if (provider !== 'OTHER') return `${LINK_PROVIDER_LABELS[provider]} link`;
  const host = hostOf(url);
  return host ? host.replace(/^www\./, '') : 'Link';
}

/** A note's title is its first line, shortened; the body keeps everything. */
export function defaultNoteTitle(body: string): string {
  const firstLine =
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? 'Note';
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 79).trimEnd()}…`;
}

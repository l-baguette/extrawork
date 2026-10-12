/**
 * Where to go after signing in, from a `next` query parameter.
 *
 * Only a same-origin path is accepted: it must start with exactly one `/`.
 * `//evil.example` and `/\evil.example` are protocol-relative to a browser and
 * would turn the sign-in page into an open redirect, so anything else falls
 * back to the default.
 */
export function safeNext(value: string | null | undefined, fallback = '/app/dashboard'): string {
  if (!value || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Control characters (a tab or newline inside "/\t/evil") are ignored by URL
  // parsers and can rebuild a protocol-relative path, so they are refused too.
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 0x20 || value.charCodeAt(i) === 0x7f) return fallback;
  }
  return value;
}

/** `/sign-in?next=...`, or the plain page when there is nowhere safe to return to. */
export function withNext(path: string, next: string | null | undefined): string {
  const target = safeNext(next, '');
  return target ? `${path}?next=${encodeURIComponent(target)}` : path;
}

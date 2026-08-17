import { AppError, type ErrorCode, type ErrorEnvelope } from '@extrawork/contracts';

/**
 * Typed fetch wrapper for the Fastify API.
 *
 * Report §6.5: sessions are secure, HTTP-only, SameSite=Lax cookies, and no
 * bearer token is ever kept in local storage — so every call is
 * `credentials: 'include'` and the browser carries the cookie.
 *
 * Report §7.2: mutating commands take an `Idempotency-Key` and draft updates
 * take `If-Match`. Those are first-class arguments here rather than something a
 * caller has to remember.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Public Next variables are compiled into the browser bundle. If a dev server
 * was started on localhost and then opened from a phone over the LAN, that
 * stale value points the phone back at itself. In local/LAN development only,
 * replace a compiled loopback host with the host serving the current page.
 */
export function browserApiUrl(): string {
  if (typeof window === 'undefined') return API_URL;

  return resolveBrowserApiUrl(API_URL, window.location);
}

export function resolveBrowserApiUrl(
  configuredUrl: string,
  location: { protocol: string; hostname: string },
): string {
  const fallback = configuredUrl.replace(/\/$/, '');

  try {
    const configured = new URL(configuredUrl);
    const loopback = new Set(['localhost', '127.0.0.1', '::1']);
    if (loopback.has(configured.hostname) && !loopback.has(location.hostname)) {
      configured.protocol = location.protocol;
      configured.hostname = location.hostname;
      configured.port = '4000';
      return configured.toString().replace(/\/$/, '');
    }
  } catch {
    // Configuration validation normally prevents this. Fall back to the
    // declared value so the ordinary fetch error remains understandable.
  }
  return fallback;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly requestId: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, envelope: ErrorEnvelope['error']) {
    super(envelope.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = envelope.code;
    this.requestId = envelope.requestId;
    this.details = envelope.details;
  }

  /** True when retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: string;
  signal?: AbortSignal;
  /** Forwarded from a server component so SSR calls carry the session cookie. */
  cookie?: string;
  /**
   * Overrides the CSRF token. The public approval flow passes its own, because
   * it holds a `ew_public_csrf` pair rather than the business session's. Leave
   * unset for authenticated calls — the business token is read from its cookie.
   */
  csrfToken?: string;
}

/** Business session CSRF cookie. Deliberately not HTTP-only so we can echo it. */
const CSRF_COOKIE = 'ew_csrf';

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Reads the CSRF cookie the API set at sign-in.
 *
 * The double-submit pair is what proves a mutation came from our own page
 * rather than a cross-site form: the API compares this header against the
 * session's stored token. The cookie is readable by script on purpose — an
 * attacker's page can cause the cookie to be *sent*, but cannot read it to
 * build the matching header.
 *
 * Returns null during SSR, where there is no `document` and the caller passes
 * the whole cookie header through instead.
 */
function csrfFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export interface ApiResponse<T> {
  data: T;
  etag: string | null;
  requestId: string | null;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  if (options.ifMatch) headers['if-match'] = options.ifMatch;
  if (options.cookie) headers.cookie = options.cookie;

  // Every cookie-authenticated mutation needs the CSRF header, so it is attached
  // here rather than being something each call site has to remember — forgetting
  // it fails the request at the API with CSRF_FAILED, which reads like a session
  // problem and sends you looking in the wrong place.
  const method = options.method ?? 'GET';
  const csrfToken = options.csrfToken ?? (MUTATION_METHODS.has(method) ? csrfFromCookie() : null);
  if (csrfToken) headers['x-csrf-token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(`${browserApiUrl()}${path}`, {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    // A network failure must never be presented as a recorded outcome
    // (report §13.1: the decision page says clearly that nothing was recorded).
    throw new ApiError(0, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Could not reach ExtraWork. Check your connection and try again.',
      requestId: 'offline',
    });
  }

  const requestId = response.headers.get('x-request-id');
  const etag = response.headers.get('etag');

  if (response.status === 204) {
    return { data: undefined as T, etag, requestId };
  }

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;

  if (!response.ok) {
    const envelope = (parsed as ErrorEnvelope | null)?.error;
    throw new ApiError(
      response.status,
      envelope ?? {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
        requestId: requestId ?? 'unknown',
      },
    );
  }

  return { data: parsed as T, etag, requestId };
}

/** Convenience for the common case where only the body matters. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await apiRequest<T>(path, options)).data;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Idempotency keys are generated once per user intent, not per retry. */
export function newIdempotencyKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `key_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
}

export { AppError };

import { headers } from 'next/headers';
import { API_URL } from './api';

/**
 * Server-component fetch that forwards the caller's session cookie.
 *
 * Report §6.1 prefers server-rendered initial pages. Because the session lives
 * in an HTTP-only cookie (report §6.5), a server component has to pass it
 * through explicitly — the browser is not making this request.
 */
export type ServerResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

export async function serverGet<T>(path: string): Promise<ServerResult<T>> {
  const incoming = await headers();
  const cookie = incoming.get('cookie');

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: cookie ? { cookie } : {},
      cache: 'no-store',
    });
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'ExtraWork is temporarily unreachable.',
    };
  }

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = (body as { error?: { code: string; message: string } } | null)?.error;
    return {
      ok: false,
      status: response.status,
      code: error?.code ?? 'INTERNAL_ERROR',
      message: error?.message ?? 'Something went wrong.',
    };
  }
  return { ok: true, data: body as T };
}

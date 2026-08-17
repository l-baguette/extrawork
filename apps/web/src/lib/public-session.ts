import type { PublicRequestDto } from '@extrawork/contracts';
import { apiRequest } from './api';

/**
 * Establishing the customer's public session in the browser.
 *
 * The page is server-rendered so it is readable immediately on a slow
 * connection (report §6.1). But the API issues the public session as cookies on
 * the `GET /public/v1/requests/{token}` response, and a Next.js Server
 * Component cannot forward a `Set-Cookie` to the browser — the SSR fetch is
 * made by the Next server, so those cookies would land there and be discarded.
 *
 * So the browser repeats that GET once on mount. It is cheap, and it is
 * idempotent on the server: the first-view evidence event fires only once
 * (report §4.5) and an existing session is reused rather than replaced.
 *
 * The CSRF value comes from the response **body**, not from `document.cookie`.
 * The cookies are scoped to `/public` on the API host, so a page served from
 * `/r/...` — and in production from a different host entirely — cannot read
 * them. Reading it from the body is equally safe: CORS prevents an attacker's
 * origin from reading this response at all, which is the property the
 * double-submit check actually depends on.
 */

export interface PublicSessionState {
  ready: boolean;
  csrfToken: string | null;
  error: string | null;
}

export async function establishPublicSession(token: string): Promise<PublicSessionState> {
  try {
    const { data } = await apiRequest<PublicRequestDto & { csrfToken: string | null }>(
      `/public/v1/requests/${encodeURIComponent(token)}`,
    );

    if (!data.csrfToken) {
      return {
        ready: false,
        csrfToken: null,
        error:
          'Your browser is blocking the cookies ExtraWork needs to record a decision securely. ' +
          'Try opening this link in your normal browser rather than an in-app preview.',
      };
    }
    return { ready: true, csrfToken: data.csrfToken, error: null };
  } catch {
    return {
      ready: false,
      csrfToken: null,
      // Deliberately explicit: nothing has been recorded at this point.
      error:
        'Could not reach ExtraWork to prepare this page. No decision has been recorded. ' +
        'Check your connection and reload.',
    };
  }
}

import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '@extrawork/contracts';
import { normalizeEmail } from '@extrawork/domain';

/**
 * "Continue with Google" — OAuth 2.0 authorization code flow with PKCE.
 *
 * Implemented directly rather than through a managed provider, because the rest
 * of the sign-in surface is first-party and routing one button through Supabase
 * Auth would mean two session systems to reason about.
 *
 * Three defences, none optional:
 *
 *   - **state**, checked on return, so a third party cannot start a flow and
 *     have the victim's browser finish it (CSRF on the callback);
 *   - **PKCE**, so an intercepted authorization code is useless without the
 *     verifier that never left this server;
 *   - **`email_verified`**, refused when false. Google will happily issue a
 *     token for an unverified address, and accepting one would let anyone who
 *     can create a Google account claim someone else's email here.
 *
 * The ID token is verified through Google's tokeninfo endpoint rather than by
 * validating the JWT locally. That is one network call on a path a person is
 * already waiting on, and it removes a whole class of signature-validation
 * mistakes from code that would otherwise be exercised rarely.
 */

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Must match a redirect URI registered in the Google Cloud console exactly. */
  redirectUri: string;
  fetchImpl?: typeof fetch;
}

export interface GoogleAuthStart {
  authorizeUrl: string;
  /** Round-tripped through a short-lived cookie and checked on return. */
  state: string;
  /** Kept server-side for the token exchange; never sent to the browser. */
  codeVerifier: string;
}

export interface GoogleProfile {
  subject: string;
  email: string;
  displayName: string;
}

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

export class GoogleOAuthProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GoogleOAuthOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Builds the URL to send the browser to, plus the secrets to remember. */
  start(): GoogleAuthStart {
    const state = base64url(randomBytes(24));
    const codeVerifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(codeVerifier).digest());

    const url = new URL(AUTHORIZE);
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', this.options.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // Without this Google silently reuses a prior consent and may omit the
    // account chooser, which is confusing when someone holds two accounts.
    url.searchParams.set('prompt', 'select_account');

    return { authorizeUrl: url.toString(), state, codeVerifier };
  }

  /** Exchanges the code for a verified profile. */
  async complete(code: string, codeVerifier: string): Promise<GoogleProfile> {
    const response = await this.fetchImpl(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: this.options.redirectUri,
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new AppError('UNAUTHENTICATED', {
        message: 'Google did not accept that sign-in. Please try again.',
      });
    }

    const token = (await response.json()) as { id_token?: string };
    if (!token.id_token) {
      throw new AppError('UNAUTHENTICATED', { message: 'Google returned no identity token.' });
    }

    const info = await this.fetchImpl(
      `${TOKENINFO}?id_token=${encodeURIComponent(token.id_token)}`,
      {
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!info.ok) {
      throw new AppError('UNAUTHENTICATED', { message: 'Could not verify the Google identity.' });
    }

    const claims = (await info.json()) as {
      aud?: string;
      sub?: string;
      email?: string;
      email_verified?: string | boolean;
      name?: string;
    };

    // The audience check is what stops a token minted for some other
    // application being replayed here.
    if (claims.aud !== this.options.clientId) {
      throw new AppError('UNAUTHENTICATED', { message: 'That Google token was not issued to us.' });
    }
    if (!claims.sub || !claims.email) {
      throw new AppError('UNAUTHENTICATED', { message: 'Google returned an incomplete profile.' });
    }

    const verified = claims.email_verified === true || claims.email_verified === 'true';
    if (!verified) {
      throw new AppError('UNAUTHENTICATED', {
        message: 'That Google account has an unverified email address.',
      });
    }

    const email = normalizeEmail(claims.email);
    return {
      subject: claims.sub,
      email,
      displayName: claims.name?.trim() || (email.split('@')[0] as string),
    };
  }
}

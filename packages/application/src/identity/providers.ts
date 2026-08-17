import { createHash, type webcrypto } from 'node:crypto';
import { AppError } from '@extrawork/contracts';
import type { UnitOfWork, Repositories } from '@extrawork/db';
import { normalizeEmail } from '@extrawork/domain';
import type { AuthenticatedIdentity, AuthProvider } from './auth-service.js';

/**
 * Auth drivers behind the managed-auth-compatible abstraction (report §6.5).
 */

export interface LocalMagicLinkOptions {
  uow: UnitOfWork;
  repos: Repositories;
  ttlMinutes: number;
}

/**
 * The `auth_provider_subject` the local driver derives for an address.
 *
 * Exported because anything that creates a local user — the seed, a fixture, an
 * import — must produce the *same* subject the magic-link flow will. `users` has
 * unique indexes on both `auth_provider_subject` and `email_normalized`, while
 * `upsertUser` reconciles only the first; a row written with a different subject
 * for the same address is therefore a user who can never sign in, and the
 * failure surfaces as a confusing LOCK_CONFLICT rather than anything about auth.
 * One function keeps the two paths from drifting.
 */
export function localAuthSubject(email: string): string {
  const normalized = normalizeEmail(email);
  return `local:${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`;
}

/**
 * First-party email magic link. Single-use, hashed at rest, time-limited. This
 * is a real authentication mechanism for development and self-hosting, not a
 * stub — but production configuration rejects it in favour of managed auth,
 * because the report is explicit that ExtraWork should not build password, MFA
 * and recovery flows itself.
 */
export class LocalMagicLinkProvider implements AuthProvider {
  readonly name = 'local';

  constructor(private readonly options: LocalMagicLinkOptions) {}

  async beginSignIn(email: string): Promise<{ deliverToken: string; expiresAt: Date }> {
    return this.options.uow.transaction(async (tx) => {
      const challenge = await this.options.repos.identity.createAuthChallenge(tx, {
        email: normalizeEmail(email),
        purpose: 'SIGN_IN',
        organizationId: null,
        ttlMinutes: this.options.ttlMinutes,
      });
      return { deliverToken: challenge.token, expiresAt: challenge.expiresAt };
    });
  }

  async completeSignIn(credential: string): Promise<AuthenticatedIdentity> {
    const consumed = await this.options.uow.transaction((tx) =>
      this.options.repos.identity.consumeAuthChallenge(tx, credential),
    );
    if (!consumed) {
      throw new AppError('UNAUTHENTICATED', {
        message: 'That sign-in link is no longer valid. Request a new one.',
      });
    }
    return {
      provider: this.name,
      // Stable subject derived from the address, so repeated sign-ins map to
      // the same user without storing anything the provider would own.
      subject: localAuthSubject(consumed.email),
      email: consumed.email,
      displayName: displayNameFromEmail(consumed.email),
    };
  }
}

export interface ManagedJwtOptions {
  jwksUrl: string;
  issuer: string;
  audience?: string;
  providerName: 'supabase' | 'clerk';
  fetchImpl?: typeof fetch;
}

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

/**
 * Verifies a managed provider's JWT against its published JWKS. ExtraWork never
 * sees a password: the provider owns credentials, MFA and recovery, and this
 * driver only maps a verified subject onto a local profile (report §6.5).
 */
export class ManagedJwtProvider implements AuthProvider {
  readonly name: string;
  private jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ManagedJwtOptions) {
    this.name = options.providerName;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The provider owns the challenge step; nothing for us to send. */
  async beginSignIn(): Promise<null> {
    return null;
  }

  async completeSignIn(credential: string): Promise<AuthenticatedIdentity> {
    const [headerPart, payloadPart, signaturePart] = credential.split('.');
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new AppError('UNAUTHENTICATED', { message: 'Malformed authentication token' });
    }

    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
      alg: string;
      kid?: string;
    };
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      sub?: string;
      email?: string;
      name?: string;
      iss?: string;
      aud?: string | string[];
      exp?: number;
      user_metadata?: { full_name?: string };
    };

    const key = await this.resolveKey(header.kid);
    const verified = await this.verifySignature(
      header.alg,
      key,
      `${headerPart}.${payloadPart}`,
      Buffer.from(signaturePart, 'base64url'),
    );
    if (!verified) {
      throw new AppError('UNAUTHENTICATED', {
        message: 'Authentication token signature is invalid',
      });
    }

    if (payload.iss !== this.options.issuer) {
      throw new AppError('UNAUTHENTICATED', { message: 'Authentication token issuer mismatch' });
    }
    if (this.options.audience) {
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audiences.includes(this.options.audience)) {
        throw new AppError('UNAUTHENTICATED', {
          message: 'Authentication token audience mismatch',
        });
      }
    }
    if (!payload.exp || payload.exp * 1000 <= Date.now()) {
      throw new AppError('SESSION_EXPIRED');
    }
    if (!payload.sub || !payload.email) {
      throw new AppError('UNAUTHENTICATED', {
        message: 'Authentication token is missing a subject',
      });
    }

    const email = normalizeEmail(payload.email);
    return {
      provider: this.name,
      subject: payload.sub,
      email,
      displayName: payload.name ?? payload.user_metadata?.full_name ?? displayNameFromEmail(email),
    };
  }

  private async resolveKey(kid: string | undefined): Promise<Jwk> {
    const fresh = this.jwksCache && Date.now() - this.jwksCache.fetchedAt < 10 * 60_000;
    if (!fresh) {
      const response = await this.fetchImpl(this.options.jwksUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new AppError('PROVIDER_UNAVAILABLE', {
          message: 'Could not reach the authentication provider.',
        });
      }
      const body = (await response.json()) as { keys: Jwk[] };
      this.jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
    }

    const keys = this.jwksCache?.keys ?? [];
    const key = kid ? keys.find((k) => k.kid === kid) : keys[0];
    if (!key) {
      throw new AppError('UNAUTHENTICATED', { message: 'Unknown authentication signing key' });
    }
    return key;
  }

  private async verifySignature(
    alg: string,
    jwk: Jwk,
    signingInput: string,
    signature: Buffer,
  ): Promise<boolean> {
    const { webcrypto } = await import('node:crypto');
    const subtle = webcrypto.subtle;

    const algorithms: Record<
      string,
      {
        importAlg: webcrypto.RsaHashedImportParams | webcrypto.EcKeyImportParams;
        verifyAlg: webcrypto.AlgorithmIdentifier | webcrypto.EcdsaParams;
      }
    > = {
      RS256: {
        importAlg: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        verifyAlg: { name: 'RSASSA-PKCS1-v1_5' },
      },
      ES256: {
        importAlg: { name: 'ECDSA', namedCurve: 'P-256' },
        verifyAlg: { name: 'ECDSA', hash: 'SHA-256' },
      },
    };

    const spec = algorithms[alg];
    if (!spec) {
      // `none` and HMAC algorithms are refused outright: accepting them is the
      // classic JWT confusion vulnerability.
      throw new AppError('UNAUTHENTICATED', { message: `Unsupported token algorithm ${alg}` });
    }

    const key = await subtle.importKey(
      'jwk',
      jwk as unknown as webcrypto.JsonWebKey,
      spec.importAlg,
      false,
      ['verify'],
    );
    return subtle.verify(spec.verifyAlg, key, signature, Buffer.from(signingInput, 'utf8'));
  }
}

export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

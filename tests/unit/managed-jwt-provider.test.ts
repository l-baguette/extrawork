import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ManagedJwtProvider } from '@extrawork/application';

const ISSUER = 'https://auth.example.test';
const AUDIENCE = 'extrawork';

function signingKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}

function token(
  key: ReturnType<typeof signingKey>,
  overrides: Record<string, unknown> = {},
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: 'provider-user-1',
      email: 'owner@example.test',
      exp: Math.floor(Date.now() / 1000) + 300,
      ...overrides,
    }),
  ).toString('base64url');
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    key.privateKey,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function provider(fetchImpl: typeof fetch) {
  return new ManagedJwtProvider({
    jwksUrl: `${ISSUER}/.well-known/jwks.json`,
    issuer: ISSUER,
    audience: AUDIENCE,
    providerName: 'supabase',
    fetchImpl,
  });
}

function jwksResponse(keys: unknown[]): Response {
  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('managed JWT verification', () => {
  it('accepts a correctly signed, issuer- and audience-bound token', async () => {
    const key = signingKey('current');
    const auth = provider(async () => jwksResponse([key.jwk]));
    await expect(auth.completeSignIn(token(key))).resolves.toMatchObject({
      provider: 'supabase',
      subject: 'provider-user-1',
      email: 'owner@example.test',
    });
  });

  it('turns malformed JSON into a stable authentication error', async () => {
    const auth = provider(async () => jwksResponse([]));
    const malformed = `${Buffer.from('{').toString('base64url')}.e30.signature`;
    await expect(auth.completeSignIn(malformed)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects another audience and a token that is not active yet', async () => {
    const key = signingKey('current');
    const auth = provider(async () => jwksResponse([key.jwk]));
    await expect(auth.completeSignIn(token(key, { aud: 'another-app' }))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(
      auth.completeSignIn(token(key, { nbf: Math.floor(Date.now() / 1000) + 600 })),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refreshes a still-fresh JWKS once when the provider rotates keys', async () => {
    const oldKey = signingKey('old');
    const newKey = signingKey('new');
    let calls = 0;
    const auth = provider(async () => {
      calls += 1;
      return jwksResponse(calls === 1 ? [oldKey.jwk] : [oldKey.jwk, newKey.jwk]);
    });

    await auth.completeSignIn(token(oldKey));
    await expect(auth.completeSignIn(token(newKey))).resolves.toMatchObject({
      subject: 'provider-user-1',
    });
    expect(calls).toBe(2);
  });

  it('rejects a header algorithm that disagrees with the selected JWK', async () => {
    const key = signingKey('current');
    const auth = provider(async () => jwksResponse([{ ...key.jwk, alg: 'ES256' }]));
    await expect(auth.completeSignIn(token(key))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

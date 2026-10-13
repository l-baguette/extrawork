import { describe, expect, it } from 'vitest';
import { DisabledBotProtection, TurnstileBotProtection } from '@extrawork/integrations';

/**
 * The verification call sits in front of sign-in, so its failure modes matter
 * more than its happy path: a provider that is slow, down, or answering with
 * something unexpected must produce a decision, never an exception that becomes
 * a 500 on the sign-in page.
 */

function stubFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return ((url: string, init: RequestInit) => Promise.resolve(handler(url, init))) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('DisabledBotProtection', () => {
  it('accepts everything and reports that it is not enforcing', async () => {
    const gateway = new DisabledBotProtection();
    expect(gateway.enforced).toBe(false);
    expect(await gateway.verify()).toEqual({ ok: true, errorCodes: [] });
  });
});

describe('TurnstileBotProtection', () => {
  it('accepts a token the provider says is good', async () => {
    const gateway = new TurnstileBotProtection(
      'secret',
      stubFetch(() => json({ success: true })),
    );
    expect(await gateway.verify('token', '203.0.113.7')).toEqual({ ok: true, errorCodes: [] });
  });

  it('rejects a missing token without calling the provider', async () => {
    let called = false;
    const gateway = new TurnstileBotProtection(
      'secret',
      stubFetch(() => {
        called = true;
        return json({ success: true });
      }),
    );

    const verdict = await gateway.verify(undefined, null);
    expect(verdict.ok).toBe(false);
    expect(verdict.errorCodes).toEqual(['missing-input-response']);
    expect(called).toBe(false);
  });

  it('surfaces the provider error codes on a rejection', async () => {
    const gateway = new TurnstileBotProtection(
      'secret',
      stubFetch(() => json({ success: false, 'error-codes': ['timeout-or-duplicate'] })),
    );

    const verdict = await gateway.verify('replayed', null);
    expect(verdict.ok).toBe(false);
    expect(verdict.errorCodes).toEqual(['timeout-or-duplicate']);
  });

  it('sends the secret and token, and omits remoteip when it is unknown', async () => {
    let seen: URLSearchParams | null = null;
    const gateway = new TurnstileBotProtection(
      'the-secret',
      stubFetch((_url, init) => {
        seen = init.body as URLSearchParams;
        return json({ success: true });
      }),
    );

    await gateway.verify('the-token', null);
    expect(seen).not.toBeNull();
    const body = seen as unknown as URLSearchParams;
    expect(body.get('secret')).toBe('the-secret');
    expect(body.get('response')).toBe('the-token');
    // A malformed remoteip is rejected by the provider, so an unknown address
    // is left out rather than sent as an empty string.
    expect(body.has('remoteip')).toBe(false);
  });

  it('fails closed when the provider returns a non-2xx', async () => {
    const gateway = new TurnstileBotProtection(
      'secret',
      stubFetch(() => new Response('nope', { status: 503 })),
    );

    const verdict = await gateway.verify('token', null);
    expect(verdict.ok).toBe(false);
    expect(verdict.errorCodes).toEqual(['http-503']);
  });

  it('fails closed rather than throwing when the provider is unreachable', async () => {
    const gateway = new TurnstileBotProtection('secret', (() =>
      Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch);

    const verdict = await gateway.verify('token', null);
    expect(verdict.ok).toBe(false);
    expect(verdict.errorCodes).toEqual(['unreachable']);
  });

  it('gives up on a slow provider instead of holding the sign-in open', async () => {
    const gateway = new TurnstileBotProtection(
      'secret',
      ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })) as unknown as typeof fetch,
      10,
    );

    const verdict = await gateway.verify('token', null);
    expect(verdict.ok).toBe(false);
    expect(verdict.errorCodes).toEqual(['timeout']);
  });
});

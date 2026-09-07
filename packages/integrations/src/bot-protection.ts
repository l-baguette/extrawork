/**
 * Human-verification for the endpoints an automated attacker gets value from:
 * account creation, and the two sign-in paths.
 *
 * Rate limiting already caps how fast one source can try. It does not stop a
 * distributed attempt that stays under the per-IP limit on every node — a
 * credential-stuffing run across a residential proxy pool looks exactly like a
 * thousand people signing in once. A proof-of-work/behaviour challenge raises
 * the per-attempt cost instead of the per-source rate, which is the axis rate
 * limiting cannot cover.
 *
 * Written as a driver so it can be off in development and in tests, where a
 * real challenge would make every test a browser test.
 */

export interface BotProtectionVerdict {
  ok: boolean;
  /** Provider error codes, for logs. Never shown to the person. */
  errorCodes: string[];
}

export interface BotProtectionGateway {
  readonly name: string;
  /** True when this driver actually challenges; the API skips the token check when false. */
  readonly enforced: boolean;
  verify(token: string | undefined, remoteIp: string | null): Promise<BotProtectionVerdict>;
}

/** The default. Accepts everything, and says so rather than pretending to check. */
export class DisabledBotProtection implements BotProtectionGateway {
  readonly name = 'none';
  readonly enforced = false;

  async verify(): Promise<BotProtectionVerdict> {
    return { ok: true, errorCodes: [] };
  }
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export class TurnstileBotProtection implements BotProtectionGateway {
  readonly name = 'turnstile';
  readonly enforced = true;

  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5_000,
  ) {}

  async verify(token: string | undefined, remoteIp: string | null): Promise<BotProtectionVerdict> {
    if (!token) return { ok: false, errorCodes: ['missing-input-response'] };

    const body = new URLSearchParams({ secret: this.secretKey, response: token });
    // Cloudflare treats remoteip as optional and rejects a malformed one, so it
    // is only sent when the proxy actually gave us an address.
    if (remoteIp) body.set('remoteip', remoteIp);

    // A challenge provider that is slow or down must not take sign-in down with
    // it. The call is bounded, and a timeout is reported as a failure the route
    // can decide about rather than an exception that becomes a 500.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, errorCodes: [`http-${response.status}`] };

      const result = (await response.json()) as {
        success?: boolean;
        'error-codes'?: string[];
      };
      return {
        ok: result.success === true,
        errorCodes: result['error-codes'] ?? [],
      };
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      return { ok: false, errorCodes: [aborted ? 'timeout' : 'unreachable'] };
    } finally {
      clearTimeout(timer);
    }
  }
}

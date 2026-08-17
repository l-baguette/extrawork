import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@extrawork/contracts';
import type { RateLimiter, RateLimitName } from '@extrawork/db';
import { metrics, METRIC } from '@extrawork/observability';

/**
 * Rate limiting — report §7.7. Limits are defined in `packages/db/rate-limit`
 * so the numbers live next to the counter implementation and can move to an
 * edge/WAF driver without touching routes.
 */

export interface RateLimitOptions {
  name: RateLimitName;
  /** Derives the bucket subject; report §7.7 keys each surface differently. */
  subject: (request: FastifyRequest) => string;
}

export function rateLimit(limiter: RateLimiter, options: RateLimitOptions) {
  return async function rateLimitHook(request: FastifyRequest, reply: FastifyReply) {
    // The subject for authenticated limits must be the user + organization,
    // not the fallback IP. `requireAuth` caches its result on the request, so
    // route handlers can call it again without another database query.
    if (isAuthenticatedLimit(options.name)) {
      await request.server.requireAuth(request, reply);
    }

    const result = await limiter.consume(options.name, options.subject(request));

    void reply.header('x-ratelimit-limit', String(result.limit));
    void reply.header('x-ratelimit-remaining', String(result.remaining));
    void reply.header('x-ratelimit-reset', String(Math.floor(result.resetAt.getTime() / 1000)));

    if (!result.allowed) {
      metrics.counter(METRIC.RATE_LIMIT_HITS, 'Rate limit rejections', { limit: options.name });
      throw new AppError('RATE_LIMITED', {
        details: { retryAfterSeconds: result.retryAfterSeconds },
      });
    }
  };
}

function isAuthenticatedLimit(name: RateLimitName): boolean {
  return name === 'AUTHENTICATED_READ' || name === 'AUTHENTICATED_MUTATION';
}

/** user + organization (report §7.7 authenticated surfaces). */
export function authenticatedSubject(request: FastifyRequest): string {
  const auth = request.auth;
  // A userless actor would interpolate as the literal "null" and bucket every
  // such caller into one shared limit, so it falls back to the organization.
  if (auth?.actor.userId) return `${auth.actor.userId}:${auth.actor.organizationId}`;
  if (auth) return `org:${auth.actor.organizationId}`;
  return `anon:${request.publicCtx.ipForRateLimit}`;
}

/**
 * token + IP (report §7.7 public surfaces). The token is hashed into the bucket
 * key so a plaintext approval token never reaches the counters table or a log
 * line (report §3.4).
 */
export function publicTokenSubject(request: FastifyRequest): string {
  const params = request.params as { token?: string } | undefined;
  const token = params?.token ?? 'none';
  return `${hashForBucket(token)}:${request.publicCtx.ipForRateLimit}`;
}

export function ipSubject(request: FastifyRequest): string {
  return request.publicCtx.ipForRateLimit;
}

function hashForBucket(value: string): string {
  // Short, non-reversible; enough to separate buckets without storing a token.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

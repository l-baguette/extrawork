import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter, RATE_LIMITS } from '@extrawork/db';

describe('authentication rate-limit buckets', () => {
  it('does not charge token verification against the email-send allowance', async () => {
    const limiter = new InMemoryRateLimiter();
    const subject = '203.0.113.8';

    for (let attempt = 0; attempt < RATE_LIMITS.AUTH_MAGIC_LINK.limit; attempt += 1) {
      await expect(limiter.consume('AUTH_MAGIC_LINK', subject)).resolves.toMatchObject({
        allowed: true,
      });
    }
    await expect(limiter.consume('AUTH_MAGIC_LINK', subject)).resolves.toMatchObject({
      allowed: false,
    });

    await expect(limiter.consume('AUTH_FLOW', subject)).resolves.toMatchObject({
      allowed: true,
      remaining: RATE_LIMITS.AUTH_FLOW.limit - 1,
    });
  });

  it('still bounds repeated non-sending auth interactions', async () => {
    const limiter = new InMemoryRateLimiter();
    const subject = '203.0.113.9';

    let result = await limiter.peek('AUTH_FLOW', subject);
    for (let attempt = 0; attempt <= RATE_LIMITS.AUTH_FLOW.limit; attempt += 1) {
      result = await limiter.consume('AUTH_FLOW', subject);
    }

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});

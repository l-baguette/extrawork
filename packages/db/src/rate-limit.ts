import { sql } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * Fixed-window rate limiting in PostgreSQL — report §7.7.
 *
 * "Implement MVP counters in PostgreSQL or edge middleware. Move high-volume
 * public limits to managed edge/WAF or Redis when database write amplification
 * becomes material." The interface below is deliberately storage-agnostic so
 * that migration is a driver swap, not a rewrite.
 */

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowSeconds: number;
}

/** Report §7.7 table, verbatim. */
export const RATE_LIMITS = {
  AUTHENTICATED_READ: { limit: 300, windowSeconds: 60 },
  AUTHENTICATED_MUTATION: { limit: 60, windowSeconds: 60 },
  PUBLIC_REQUEST_GET: { limit: 60, windowSeconds: 3_600 },
  PUBLIC_DECISION_POST: { limit: 10, windowSeconds: 3_600 },
  OTP_SEND_WINDOW: { limit: 3, windowSeconds: 900 },
  OTP_SEND_DAILY: { limit: 10, windowSeconds: 86_400 },
  UPLOAD_CREATE: { limit: 30, windowSeconds: 3_600 },
  AUTH_MAGIC_LINK: { limit: 5, windowSeconds: 900 },
  WEBHOOK: { limit: 600, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(name: RateLimitName, subject: string, cost?: number): Promise<RateLimitResult>;
  peek(name: RateLimitName, subject: string): Promise<RateLimitResult>;
}

/**
 * Process-local counters for high-volume, low-risk authenticated reads. These
 * avoid turning every page view into a remote Postgres write during local
 * development. Mutations and every public/auth surface still use the durable
 * limiter below.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: Date }>();

  constructor(private readonly enabled = true) {}

  async consume(name: RateLimitName, subject: string, cost = 1): Promise<RateLimitResult> {
    const state = this.state(name, subject);
    const count = this.enabled ? state.count + cost : 0;
    if (this.enabled) this.buckets.set(state.key, { count, resetAt: state.resetAt });
    return resultFor(name, count, state.resetAt, new Date());
  }

  async peek(name: RateLimitName, subject: string): Promise<RateLimitResult> {
    const state = this.state(name, subject);
    const count = this.enabled ? state.count : 0;
    return resultFor(
      name,
      count,
      state.resetAt,
      new Date(),
      !this.enabled || count < RATE_LIMITS[name].limit,
    );
  }

  private state(
    name: RateLimitName,
    subject: string,
  ): {
    key: string;
    count: number;
    resetAt: Date;
  } {
    const rule = RATE_LIMITS[name];
    const now = new Date();
    const start = windowStart(rule.windowSeconds, now);
    const resetAt = new Date(start.getTime() + rule.windowSeconds * 1000);
    const key = `${name}:${subject}:${start.getTime()}`;
    const existing = this.buckets.get(key);

    // Fixed windows make every older entry disposable. Opportunistic cleanup
    // bounds memory without a timer that could keep short-lived tools alive.
    if (this.buckets.size > 1_000) {
      for (const [bucketKey, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }
    return { key, count: existing?.count ?? 0, resetAt };
  }
}

/** Routes authenticated reads locally while preserving distributed limits elsewhere. */
export class LocalReadRateLimiter implements RateLimiter {
  constructor(
    private readonly distributed: RateLimiter,
    private readonly local: RateLimiter,
  ) {}

  consume(name: RateLimitName, subject: string, cost?: number): Promise<RateLimitResult> {
    return this.for(name).consume(name, subject, cost);
  }

  peek(name: RateLimitName, subject: string): Promise<RateLimitResult> {
    return this.for(name).peek(name, subject);
  }

  private for(name: RateLimitName): RateLimiter {
    return name === 'AUTHENTICATED_READ' ? this.local : this.distributed;
  }
}

function windowStart(windowSeconds: number, now: Date): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Database,
    private readonly enabled = true,
  ) {}

  async consume(name: RateLimitName, subject: string, cost = 1): Promise<RateLimitResult> {
    const rule = RATE_LIMITS[name];
    const now = new Date();
    const start = windowStart(rule.windowSeconds, now);
    const resetAt = new Date(start.getTime() + rule.windowSeconds * 1000);

    if (!this.enabled) {
      return {
        allowed: true,
        limit: rule.limit,
        remaining: rule.limit,
        resetAt,
        retryAfterSeconds: 0,
      };
    }

    const bucketKey = `${name}:${subject}`;
    // Single-statement increment: the UPSERT is atomic, so concurrent requests
    // cannot both read a stale count.
    const result = await this.db.execute<{ count: number }>(sql`
      INSERT INTO rate_limit_counters (bucket_key, window_start, count, expires_at)
      VALUES (${bucketKey}, ${start.toISOString()}::timestamptz, ${cost},
              ${resetAt.toISOString()}::timestamptz)
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET count = rate_limit_counters.count + ${cost}
      RETURNING count
    `);

    const count = result.rows[0]?.count ?? cost;
    const allowed = count <= rule.limit;

    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt,
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    };
  }

  async peek(name: RateLimitName, subject: string): Promise<RateLimitResult> {
    const rule = RATE_LIMITS[name];
    const now = new Date();
    const start = windowStart(rule.windowSeconds, now);
    const resetAt = new Date(start.getTime() + rule.windowSeconds * 1000);

    if (!this.enabled) {
      return {
        allowed: true,
        limit: rule.limit,
        remaining: rule.limit,
        resetAt,
        retryAfterSeconds: 0,
      };
    }

    const result = await this.db.execute<{ count: number }>(sql`
      SELECT count FROM rate_limit_counters
      WHERE bucket_key = ${`${name}:${subject}`}
        AND window_start = ${start.toISOString()}::timestamptz
    `);
    const count = result.rows[0]?.count ?? 0;
    return {
      allowed: count < rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt,
      retryAfterSeconds:
        count < rule.limit ? 0 : Math.ceil((resetAt.getTime() - now.getTime()) / 1000),
    };
  }
}

export async function purgeExpiredRateLimits(db: Database): Promise<number> {
  const result = await db.execute(sql`DELETE FROM rate_limit_counters WHERE expires_at < now()`);
  return result.rowCount ?? 0;
}

function resultFor(
  name: RateLimitName,
  count: number,
  resetAt: Date,
  now: Date,
  allowedOverride?: boolean,
): RateLimitResult {
  const rule = RATE_LIMITS[name];
  const allowed = allowedOverride ?? count <= rule.limit;
  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
  };
}

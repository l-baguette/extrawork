import type { Env } from '@extrawork/config';
import type { Repositories, UnitOfWork } from '@extrawork/db';
import type { Actor, TenantContext } from '@extrawork/domain';
import type { Integrations } from '@extrawork/integrations';
import type { MalwareScanner, ObjectStore } from '@extrawork/files';
import type { Logger } from '@extrawork/observability';

/**
 * The dependency bundle every use case receives. Constructing it in one place
 * keeps the dependency direction from report §14.2 honest: application depends
 * on domain and on repository/gateway *interfaces*, never on their concrete
 * implementations.
 */
export interface AppContext {
  env: Env;
  uow: UnitOfWork;
  repos: Repositories;
  integrations: Integrations;
  objectStore: ObjectStore;
  scanner: MalwareScanner;
  logger: Logger;
  /** Injectable so tests can pin time without touching production code. */
  clock: Clock;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A fixed clock for tests and deterministic golden fixtures. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}

/**
 * The authenticated caller plus everything needed for authorization and audit.
 * Built once by the API middleware and threaded through the use case, never
 * re-derived from a request body.
 */
export interface RequestContext {
  actor: Actor;
  tenant: TenantContext;
  requestId: string;
  /** Present for cookie-authenticated business requests. */
  sessionId: string | null;
  ipHash: Buffer | null;
  userAgent: string | null;
  /** Resolved once per request from the subscription (report §8.7). */
  readOnly: boolean;
  /** Loaded with authentication so dashboard reads do not re-fetch the organization. */
  organizationTimezone?: string | null;
}

/** Context for the unauthenticated public approval surface. */
export interface PublicRequestContext {
  requestId: string;
  ipHash: Buffer | null;
  userAgent: string | null;
  /** Raw client IP, used only for rate-limit keying, never persisted. */
  ipForRateLimit: string;
}

export function tenantOf(ctx: RequestContext): TenantContext {
  return ctx.tenant;
}

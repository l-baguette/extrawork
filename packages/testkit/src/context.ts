import type { RequestContext } from '@extrawork/application';
import type { MembershipRole } from '@extrawork/contracts';
import type { Actor } from '@extrawork/domain';

/**
 * Builds a `RequestContext` outside of an HTTP request, for the seeder and for
 * integration tests.
 *
 * Deliberately not exported from the application package: production code must
 * only ever obtain a context from authenticated middleware, so the ability to
 * fabricate one lives in dev/test tooling.
 */
export interface ActorSpec {
  userId: string;
  organizationId: string;
  role: MembershipRole;
  projectGrants?: readonly string[];
  requestId?: string;
  readOnly?: boolean;
}

export function actorContext(spec: ActorSpec): RequestContext {
  const actor: Actor = {
    userId: spec.userId,
    organizationId: spec.organizationId,
    role: spec.role,
    projectGrants: new Set(spec.projectGrants ?? []),
    authenticatedAt: Date.now(),
  };
  const requestId = spec.requestId ?? `req_seed_${Math.random().toString(36).slice(2, 12)}`;
  return {
    actor,
    tenant: {
      organizationId: spec.organizationId,
      userId: spec.userId,
      role: spec.role,
      requestId,
    },
    requestId,
    sessionId: null,
    ipHash: null,
    userAgent: 'extrawork-testkit',
    readOnly: spec.readOnly ?? false,
  };
}

export function publicContext(overrides: Partial<{ requestId: string; ip: string }> = {}) {
  return {
    requestId: overrides.requestId ?? `req_public_${Math.random().toString(36).slice(2, 12)}`,
    ipHash: null,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; moto g84) AppleWebKit/537.36 Chrome/120 Mobile',
    ipForRateLimit: overrides.ip ?? '203.0.113.7',
  };
}

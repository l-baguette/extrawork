import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type MembershipRole } from '@extrawork/contracts';
import type { RequestContext, PublicRequestContext, Services } from '@extrawork/application';
import type { Repositories, UnitOfWork } from '@extrawork/db';
import type { Env } from '@extrawork/config';
import { assertWritableSubscription, privacyHash, type Action } from './authz-bridge.js';
import { metrics, METRIC, newRequestId, sanitizeIncomingRequestId } from '@extrawork/observability';

/**
 * Request lifecycle — report §7.5, in the order the report specifies:
 *
 *   1. assign request id and structured log context
 *   2. enforce body size and content type   (Fastify config, see app.ts)
 *   3. resolve and validate the session
 *   4. resolve the active organization
 *   5. apply user/IP rate limits
 *   6. parse the shared schema              (per route)
 *   7. load the resource with tenant scope  (repositories)
 *   8. authorize the action                 (use case)
 *   9. execute the application transaction  (use case)
 *  10. write audit/outbox in that transaction
 *  11. commit, then return the projection
 *  12. emit metrics without PII
 */

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    /** Present only after `requireAuth`. */
    auth?: RequestContext;
    publicCtx: PublicRequestContext;
    startedAt: number;
  }
  interface FastifyInstance {
    env: Env;
    uow: UnitOfWork;
    repos: Repositories;
    services: Services;
    requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<RequestContext>;
    requireWrite(request: FastifyRequest, action: Action): RequestContext;
  }
}

export interface ContextPluginOptions {
  env: Env;
  uow: UnitOfWork;
  repos: Repositories;
  services: Services;
}

async function contextPlugin(app: FastifyInstance, options: ContextPluginOptions): Promise<void> {
  app.decorate('env', options.env);
  app.decorate('uow', options.uow);
  app.decorate('repos', options.repos);
  app.decorate('services', options.services);

  app.decorateRequest('requestId', '');
  app.decorateRequest('auth', undefined);
  // Fastify 5 rejects an `undefined` default here; null is the empty marker
  // and the onRequest hook always replaces it before any handler runs.
  app.decorateRequest('publicCtx', null as unknown as PublicRequestContext);
  app.decorateRequest('startedAt', 0);

  // 1. Request id and log context.
  app.addHook('onRequest', async (request) => {
    request.startedAt = Date.now();
    request.requestId =
      sanitizeIncomingRequestId(request.headers['x-request-id']) ?? newRequestId();

    const ip = clientIp(request, options.env.TRUST_PROXY);
    request.publicCtx = {
      requestId: request.requestId,
      ipHash: ip ? privacyHash(ip, options.env.PRIVACY_HASH_SECRET) : null,
      userAgent:
        typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent'].slice(0, 500)
          : null,
      ipForRateLimit: ip ?? 'unknown',
    };
  });

  app.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-request-id', request.requestId);
    return payload;
  });

  // 12. Metrics, with no PII in the labels: the route *template*, never the URL.
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url ?? 'unmatched';
    metrics.counter(METRIC.HTTP_REQUESTS, 'HTTP requests', {
      method: request.method,
      route,
      status: reply.statusCode,
    });
    metrics.observe(METRIC.HTTP_DURATION, 'HTTP request duration', Date.now() - request.startedAt, {
      route,
    });
  });

  /**
   * Steps 3 and 4: resolve the session cookie to an actor with an organization,
   * a role and project grants. Nothing downstream may derive the organization
   * from a request body (report §3.2).
   */
  app.decorate(
    'requireAuth',
    async function requireAuth(request: FastifyRequest): Promise<RequestContext> {
      if (request.auth) return request.auth;

      const sessionToken = request.cookies?.[SESSION_COOKIE];
      if (!sessionToken) throw new AppError('UNAUTHENTICATED');

      const resolved = await options.repos.identity.resolveAuthenticatedSession(
        sessionToken,
        headerOrganizationId(request),
      );
      if (!resolved) throw new AppError('SESSION_EXPIRED');
      const { session } = resolved;

      // CSRF for cookie-authenticated mutations (report §12.1).
      if (isMutation(request.method)) {
        const csrfToken = request.headers['x-csrf-token'];
        if (
          typeof csrfToken !== 'string' ||
          !options.repos.identity.verifyCsrf(session, csrfToken)
        ) {
          throw new AppError('CSRF_FAILED');
        }
      }

      const organizationId = resolved.organizationId;
      if (!organizationId) throw new AppError('ORGANIZATION_REQUIRED');

      if (!resolved.membershipRole || resolved.membershipStatus !== 'ACTIVE') {
        throw new AppError('NOT_A_MEMBER');
      }
      if (!resolved.organizationStatus) throw new AppError('NOT_A_MEMBER');
      if (resolved.organizationStatus === 'SUSPENDED') {
        throw new AppError('ORGANIZATION_SUSPENDED');
      }
      if (resolved.readOnly === null) {
        throw new AppError('INTERNAL_ERROR', {
          message: 'The organization has no subscription state.',
        });
      }

      const context: RequestContext = {
        actor: {
          userId: session.userId,
          organizationId,
          role: resolved.membershipRole as MembershipRole,
          projectGrants: new Set(resolved.projectGrants),
          authenticatedAt: session.authenticatedAt.getTime(),
        },
        tenant: {
          organizationId,
          userId: session.userId,
          role: resolved.membershipRole,
          requestId: request.requestId,
        },
        requestId: request.requestId,
        sessionId: session.id,
        ipHash: request.publicCtx.ipHash,
        userAgent: request.publicCtx.userAgent,
        readOnly: resolved.readOnly,
        organizationTimezone: resolved.organizationTimezone,
      };

      request.auth = context;
      return context;
    },
  );

  /** Report §8.7: a lapsed subscription blocks writes but never reads/exports. */
  app.decorate('requireWrite', function requireWrite(request: FastifyRequest, action: Action) {
    if (!request.auth) throw new AppError('UNAUTHENTICATED');
    assertWritableSubscription(action, request.auth.readOnly);
    return request.auth;
  });
}

export const SESSION_COOKIE = 'ew_session';
export const CSRF_COOKIE = 'ew_csrf';
export const PUBLIC_SESSION_COOKIE = 'ew_public';
export const PUBLIC_CSRF_COOKIE = 'ew_public_csrf';

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function headerOrganizationId(request: FastifyRequest): string | null {
  const header = request.headers['x-organization-id'];
  return typeof header === 'string' && header.length > 0 ? header : null;
}

/**
 * `X-Forwarded-For` is only honoured when TRUST_PROXY is on, because a
 * spoofable client header must not be able to shift a rate-limit bucket or an
 * evidence IP hash (report §11.3).
 */
export function clientIp(request: FastifyRequest, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
  }
  return request.ip ?? null;
}

export default fp(contextPlugin, { name: 'extrawork-context' });

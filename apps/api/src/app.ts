import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { Env } from '@extrawork/config';
import type { Repositories, UnitOfWork } from '@extrawork/db';
import type { AppContext, Services } from '@extrawork/application';
import { createLogger, type Logger } from '@extrawork/observability';
import contextPlugin from './plugins/context.js';
import { registerErrorHandler } from './plugins/errors.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerOrganizationRoutes } from './routes/organizations.js';
import { registerCustomerRoutes } from './routes/customers.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerChangeOrderRoutes } from './routes/change-orders.js';
import { registerFileRoutes } from './routes/files.js';
import { registerPublicRoutes } from './routes/public-approval.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerEmployeeRoutes } from './routes/employees.js';
import { registerSimulatorRoutes } from './routes/simulator.js';
import { registerOpenApiRoute } from './openapi/route.js';

export interface BuildAppOptions {
  env: Env;
  uow: UnitOfWork;
  repos: Repositories;
  services: Services;
  appContext: AppContext;
  logger?: Logger;
}

/**
 * Assembles the HTTP surface. Report §7.2 base paths:
 *   /v1          authenticated
 *   /public/v1   approval
 *   /webhooks/v1 providers
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const logger =
    options.logger ??
    createLogger({
      service: `${options.env.SERVICE_NAME}-api`,
      environment: options.env.APP_ENV,
      level: options.env.LOG_LEVEL,
      pretty: options.env.LOG_PRETTY,
    });

  const app = Fastify({
    // Cast keeps the instance at Fastify's default generic parameters, so
    // route modules can accept a plain FastifyInstance.
    loggerInstance: logger as FastifyBaseLogger,
    // Step 2 of report §7.5: bound the body before anything parses it.
    bodyLimit: 1024 * 1024,
    trustProxy: options.env.TRUST_PROXY,
    disableRequestLogging: false,
    genReqId: () => '',
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
  });

  // Raw body retained for webhook signature verification over the exact bytes
  // the provider signed (report §12.1, §13.2).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const buffer = body as Buffer;
    if (request.url.startsWith('/webhooks/')) {
      (request as { rawBody?: Buffer }).rawBody = buffer;
    }
    if (buffer.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(buffer.toString('utf8')) as unknown);
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  await app.register(helmet, {
    // Report §11.3: CSP, HSTS, nosniff, frame restrictions, permissions policy.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    hsts:
      options.env.APP_ENV === 'production'
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  await app.register(cors, {
    origin: options.env.CORS_ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'x-csrf-token',
      'x-organization-id',
      'idempotency-key',
      'if-match',
      'x-request-id',
    ],
    exposedHeaders: ['x-request-id', 'etag', 'x-ratelimit-remaining', 'x-ratelimit-reset'],
    maxAge: 600,
  });

  await app.register(cookie, {
    secret: options.env.SESSION_SECRET,
    parseOptions: {},
  });

  await app.register(contextPlugin, {
    env: options.env,
    uow: options.uow,
    repos: options.repos,
    services: options.services,
  });

  registerErrorHandler(app);

  // Every response is uncacheable by default; the approval surface additionally
  // forbids indexing and referrers (report §3.4).
  app.addHook('onSend', async (request, reply, payload) => {
    if (!reply.hasHeader('cache-control')) {
      void reply.header('cache-control', 'no-store, max-age=0');
    }
    void reply.header('referrer-policy', 'no-referrer');
    if (request.url.startsWith('/public/')) {
      void reply.header('x-robots-tag', 'noindex, nofollow, noarchive');
    }
    return payload;
  });

  await registerHealthRoutes(app, options.appContext);
  await registerOpenApiRoute(app);
  await registerAuthRoutes(app, options.appContext);
  await registerOrganizationRoutes(app);
  await registerCustomerRoutes(app, options.appContext);
  await registerProjectRoutes(app, options.appContext);
  await registerChangeOrderRoutes(app, options.appContext);
  await registerFileRoutes(app, options.appContext);
  await registerReportRoutes(app, options.appContext);
  await registerEmployeeRoutes(app, options.appContext);
  await registerPublicRoutes(app, options.appContext);
  await registerWebhookRoutes(app, options.appContext);
  await registerSimulatorRoutes(app, options.appContext);

  return app;
}

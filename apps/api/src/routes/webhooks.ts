import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, JOB_KINDS } from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { enqueueJob } from '@extrawork/db';
import { resolveMetaChallenge } from '@extrawork/integrations';
import { ipSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * `/webhooks/v1` — the provider trust boundary (report §5.3, §13.2).
 *
 * Order is non-negotiable:
 *   1. read the RAW bytes the provider signed;
 *   2. verify the signature with a constant-time compare;
 *   3. insert into `webhook_inbox` with the provider's unique event key;
 *   4. return 200 quickly — including for duplicates;
 *   5. normalise asynchronously in the worker.
 *
 * An unverifiable payload is rejected before any parsing, and is never stored.
 */
export async function registerWebhookRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const webhookLimit = rateLimit(limiter, { name: 'WEBHOOK', subject: ipSubject });

  function rawBodyOf(request: FastifyRequest): Buffer {
    const raw = (request as { rawBody?: Buffer }).rawBody;
    if (!raw) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', {
        message: 'The raw request body was not available for signature verification.',
      });
    }
    return raw;
  }

  function headerMap(request: FastifyRequest): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') out[key.toLowerCase()] = value;
    }
    return out;
  }

  /** Meta's GET challenge for webhook setup (report §10.3). */
  app.get('/webhooks/v1/meta/whatsapp', { preHandler: webhookLimit }, async (request, reply) => {
    const verifyToken = app.env.WHATSAPP_VERIFY_TOKEN;
    if (!verifyToken) throw new AppError('NOT_IMPLEMENTED');

    const query = z
      .object({
        'hub.mode': z.string().optional(),
        'hub.verify_token': z.string().optional(),
        'hub.challenge': z.string().optional(),
      })
      .parse(request.query);

    const challenge = resolveMetaChallenge(query, verifyToken);
    if (!challenge) throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    return reply.type('text/plain').send(challenge);
  });

  app.post('/webhooks/v1/meta/whatsapp', { preHandler: webhookLimit }, async (request, reply) => {
    const raw = rawBodyOf(request);
    // Throws WEBHOOK_SIGNATURE_INVALID before the payload is trusted.
    const events = appContext.integrations.whatsapp.verifyAndParse(raw, headerMap(request));

    for (const event of events) {
      const inboxId = await app.repos.webhooks.insert(appContext.uow.db, {
        provider: event.provider,
        providerAccountId: event.providerAccountId,
        providerEventId: event.providerEventId,
        signatureVerified: true,
        rawPayload: event.raw,
        headers: redactedHeaders(headerMap(request)),
        providerEventAt: event.occurredAt,
      });
      // A null id means the event was already recorded: acknowledge with 200
      // rather than inviting a retry storm (report §13.2).
      if (inboxId) {
        await appContext.uow.transaction((tx) =>
          enqueueJob(tx, {
            kind: JOB_KINDS.NORMALIZE_WEBHOOK,
            organizationId: null,
            dedupeKey: `webhook:${inboxId}`,
            payload: { webhookInboxId: inboxId },
          }),
        );
      }
    }

    return reply.status(200).send({ received: events.length });
  });

  app.post('/webhooks/v1/razorpay', { preHandler: webhookLimit }, async (request, reply) => {
    const raw = rawBodyOf(request);
    const events = appContext.integrations.payments.verifyAndParse(raw, headerMap(request));

    for (const event of events) {
      const inboxId = await app.repos.webhooks.insert(appContext.uow.db, {
        provider: event.provider,
        providerAccountId: event.providerAccountId,
        providerEventId: event.providerEventId,
        signatureVerified: true,
        rawPayload: event.raw,
        headers: redactedHeaders(headerMap(request)),
        providerEventAt: event.occurredAt,
      });
      if (inboxId) {
        await appContext.uow.transaction((tx) =>
          enqueueJob(tx, {
            kind: JOB_KINDS.NORMALIZE_WEBHOOK,
            organizationId: null,
            dedupeKey: `webhook:${inboxId}`,
            payload: { webhookInboxId: inboxId },
          }),
        );
      }
    }

    return reply.status(200).send({ received: events.length });
  });

  /** Managed-auth provider events (user deleted, email changed, and so on). */
  app.post('/webhooks/v1/auth', { preHandler: webhookLimit }, async (request, reply) => {
    if (!app.env.AUTH_WEBHOOK_SECRET) throw new AppError('NOT_IMPLEMENTED');
    const raw = rawBodyOf(request);
    const { verifyMetaSignature } = await import('@extrawork/integrations');
    if (
      !verifyMetaSignature(
        raw,
        headerMap(request)['x-webhook-signature'],
        app.env.AUTH_WEBHOOK_SECRET,
      )
    ) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }

    const inboxId = await app.repos.webhooks.insert(appContext.uow.db, {
      provider: `auth:${app.env.AUTH_DRIVER}`,
      providerAccountId: null,
      providerEventId: headerMap(request)['x-webhook-id'] ?? `auth:${Date.now()}:${raw.byteLength}`,
      signatureVerified: true,
      rawPayload: JSON.parse(raw.toString('utf8')) as unknown,
      headers: redactedHeaders(headerMap(request)),
      providerEventAt: null,
    });

    if (inboxId) {
      await appContext.uow.transaction((tx) =>
        enqueueJob(tx, {
          kind: JOB_KINDS.NORMALIZE_WEBHOOK,
          organizationId: null,
          dedupeKey: `webhook:${inboxId}`,
          payload: { webhookInboxId: inboxId },
        }),
      );
    }
    return reply.status(200).send({ received: 1 });
  });

  /** A2 e-sign is deferred (report §15.2); the endpoint exists and says so. */
  app.post('/webhooks/v1/esign/:provider', { preHandler: webhookLimit }, async () => {
    throw new AppError('NOT_IMPLEMENTED', {
      message: 'Electronic-signature webhooks are not enabled in this release.',
    });
  });
}

/** Signatures and auth headers are stripped before the raw event is stored. */
function redactedHeaders(headers: Record<string, string>): Record<string, string> {
  const keep = ['content-type', 'user-agent', 'x-webhook-id', 'x-razorpay-event-id'];
  const out: Record<string, string> = {};
  for (const key of keep) {
    const value = headers[key];
    if (value) out[key] = value;
  }
  return out;
}

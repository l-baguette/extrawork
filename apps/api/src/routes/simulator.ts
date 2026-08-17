import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { normalizePhone } from '@extrawork/domain';
import { SimulatorWhatsAppGateway } from '@extrawork/integrations';
import { sql } from 'drizzle-orm';
import { ipSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * The WhatsApp simulator surface — **development only**.
 *
 * This route accepts an inbound message with no signature and no credential of
 * any kind, and runs the real intake path with it. That is the entire point: it
 * lets the whole flow be exercised before a Meta Business Account exists. It is
 * also, stated plainly, an endpoint that will raise a change request on behalf
 * of any employee whose phone number you can guess.
 *
 * Three independent things therefore have to be true for it to exist:
 *
 *   1. `WHATSAPP_DRIVER=simulator` — the gateway is the simulator, not a real one;
 *   2. `APP_ENV !== 'production'`;
 *   3. `packages/config` rejects the simulator driver in production outright,
 *      so a misconfigured deployment fails to boot rather than exposing this.
 *
 * The registration below is skipped unless (1) and (2) hold, so in every other
 * configuration these paths simply do not exist.
 */

const InboundSchema = z.object({
  /** As the employee's phone would appear. Accepts local form; normalised here. */
  from: z.string().trim().min(4).max(32),
  body: z.string().trim().min(1).max(4_000),
  mediaCount: z.number().int().min(0).max(20).optional(),
  /** Supplied to replay a redelivery; otherwise generated. */
  providerMessageId: z.string().trim().min(1).max(200).optional(),
});

export async function registerSimulatorRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  if (appContext.env.WHATSAPP_DRIVER !== 'simulator') return;
  if (appContext.env.APP_ENV === 'production') return;

  const limiter = app.repos.rateLimiter;
  const limit = rateLimit(limiter, { name: 'WEBHOOK', subject: ipSubject });

  /**
   * Injects an inbound WhatsApp message and runs the real intake path.
   *
   * Returns the reply the employee would receive on WhatsApp, plus the approval
   * link when one was created — the simulator UI shows both, which is what
   * makes the flow inspectable without a phone.
   */
  app.post('/webhooks/v1/simulator/whatsapp', { preHandler: limit }, async (request, reply) => {
    const input = InboundSchema.parse(request.body);

    let fromPhoneE164: string;
    try {
      fromPhoneE164 = normalizePhone(input.from);
    } catch {
      throw new AppError('VALIDATION_FAILED', {
        message: 'That does not look like a phone number. Try 98765 43210.',
      });
    }

    const outcome = await app.services.intake.handleInbound({
      providerMessageId:
        input.providerMessageId ?? `sim.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`,
      fromPhoneE164,
      body: input.body,
      ...(input.mediaCount === undefined ? {} : { mediaCount: input.mediaCount }),
    });

    return reply.send({
      status: outcome.status,
      reply: outcome.reply,
      inboundMessageId: outcome.inboundMessageId,
      changeOrderId: outcome.changeOrderId,
      approvalUrl: outcome.approvalUrl,
      duplicate: outcome.duplicate,
    });
  });

  /**
   * Everything the system has "sent" over WhatsApp. This is what the customer
   * and the employee would have received on their phones.
   */
  app.get('/webhooks/v1/simulator/outbox', { preHandler: limit }, async (request, reply) => {
    const gateway = appContext.integrations.whatsapp;
    if (!(gateway instanceof SimulatorWhatsAppGateway)) {
      throw new AppError('NOT_IMPLEMENTED', {
        message: 'The simulator outbox is only available with WHATSAPP_DRIVER=simulator.',
      });
    }
    const limitParam = z.coerce.number().int().min(1).max(200).default(50);
    const { limit: max } = z.object({ limit: limitParam }).parse(request.query);
    return reply.send({ items: await gateway.readOutbox(max) });
  });

  /**
   * The roster, so the simulator UI can offer real numbers to send from.
   * Unauthenticated like the rest of this surface, and equally dev-only — it
   * exposes employee phone numbers, which is exactly why it cannot ship.
   */
  app.get('/webhooks/v1/simulator/employees', { preHandler: limit }, async (_request, reply) => {
    // Queried inline rather than through `EmployeeRepository`. Every method
    // there takes a TenantContext by rule (report §3.2), and adding an
    // un-scoped variant would leave a cross-tenant read sitting in the shared
    // repository surface where production code could reach it. Confining it to
    // this file — which is not registered outside the simulator — keeps that
    // door shut.
    const result = await appContext.uow.db.execute<{
      id: string;
      name: string;
      phone_e164: string;
      organization_name: string;
      all_projects: boolean;
      max_request_minor: string | null;
    }>(sql`
      SELECT e.id, e.name, e.phone_e164, o.display_name AS organization_name,
             e.all_projects, e.max_request_minor
      FROM employees e
      JOIN organizations o ON o.id = e.organization_id
      WHERE e.status = 'ACTIVE'
      ORDER BY o.display_name, e.name
      LIMIT 100
    `);

    return reply.send({
      items: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        phoneE164: r.phone_e164,
        organizationName: r.organization_name,
        allProjects: r.all_projects,
        maxRequestMinor: r.max_request_minor === null ? null : Number(r.max_request_minor),
      })),
    });
  });
}

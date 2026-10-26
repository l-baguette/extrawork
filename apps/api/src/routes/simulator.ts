import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { normalizePhone } from '@extrawork/domain';
import type { StoredMediaRef } from '@extrawork/db';
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

/** 2 MB of attachments per simulated message: enough for a phone photo or a PDF. */
const MAX_SIMULATED_MEDIA_BYTES = 2 * 1024 * 1024;

const SimulatedMediaSchema = z.object({
  base64: z
    .string()
    .max(Math.ceil((MAX_SIMULATED_MEDIA_BYTES * 4) / 3) + 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Expected base64'),
  mimeType: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[\w.+-]+\/[\w.+-]+$/),
  filename: z.string().trim().min(1).max(200).optional(),
});

const InboundSchema = z
  .object({
    /** As the sender's phone would appear. Accepts local form; normalised here. */
    from: z.string().trim().min(4).max(32),
    body: z.string().trim().max(4_000).default(''),
    mediaCount: z.number().int().min(0).max(20).optional(),
    /**
     * Attachments, staged through the simulator gateway so intake fetches them
     * by media id exactly as it would from Meta (spec 2026-10-12, D6).
     */
    media: z.array(SimulatedMediaSchema).max(4).optional(),
    /** Supplied to replay a redelivery; otherwise generated. */
    providerMessageId: z.string().trim().min(1).max(200).optional(),
  })
  .refine((input) => input.body.length > 0 || (input.media?.length ?? 0) > 0, {
    message: 'Send some text, an attachment, or both.',
    path: ['body'],
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
  app.post(
    '/webhooks/v1/simulator/whatsapp',
    // Room for 2 MB of attachments once base64 has inflated them by a third.
    { preHandler: limit, bodyLimit: 3 * 1024 * 1024 },
    async (request, reply) => {
      const input = InboundSchema.parse(request.body);

      let fromPhoneE164: string;
      try {
        fromPhoneE164 = normalizePhone(input.from);
      } catch {
        throw new AppError('VALIDATION_FAILED', {
          message: 'That does not look like a phone number. Try 98765 43210.',
        });
      }

      const gateway = appContext.integrations.whatsapp;
      const media: StoredMediaRef[] = [];
      if (input.media && input.media.length > 0) {
        if (!(gateway instanceof SimulatorWhatsAppGateway)) {
          throw new AppError('NOT_IMPLEMENTED', {
            message: 'Simulated attachments need WHATSAPP_DRIVER=simulator.',
          });
        }
        const decoded = input.media.map((item) => ({
          ...item,
          bytes: Buffer.from(item.base64, 'base64'),
        }));
        const total = decoded.reduce((sum, item) => sum + item.bytes.length, 0);
        if (total > MAX_SIMULATED_MEDIA_BYTES) {
          throw new AppError('VALIDATION_FAILED', {
            message: 'Keep simulated attachments under 2 MB in total.',
          });
        }
        for (const item of decoded) {
          media.push({
            mediaId: await gateway.stageMedia(item.bytes, item.mimeType),
            mimeType: item.mimeType,
            filename: item.filename ?? null,
            // WhatsApp puts the text on the attachment as its caption.
            caption: input.body || null,
          });
        }
      }

      const outcome = await app.services.intake.handleInbound({
        providerMessageId:
          input.providerMessageId ?? `sim.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`,
        fromPhoneE164,
        body: input.body,
        ...(input.mediaCount === undefined ? {} : { mediaCount: input.mediaCount }),
        ...(media.length > 0 ? { media } : {}),
      });

      // The worker fetches media after replying; here there is no worker in the
      // loop, so the same intake step runs inline. It fetches only for a message
      // that was filed (or the held messages this answer released), never for a
      // stranger.
      const stored = await app.services.intake.storeMedia(outcome.inboundMessageId);

      return reply.send({
        status: outcome.status,
        reply: outcome.reply,
        inboundMessageId: outcome.inboundMessageId,
        changeOrderId: outcome.changeOrderId,
        approvalUrl: outcome.approvalUrl,
        duplicate: outcome.duplicate,
        mediaStored: stored.stored,
      });
    },
  );

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

  /**
   * Everyone who can message the channel: site team and customer contacts with
   * a phone number, across workspaces (spec 2026-10-12, D6). Inline SQL and
   * dev-only for the same reasons as the roster above — it lists phone numbers
   * across tenants, which is exactly why it cannot ship.
   */
  app.get('/webhooks/v1/simulator/senders', { preHandler: limit }, async (_request, reply) => {
    const result = await appContext.uow.db.execute<{
      id: string;
      kind: 'EMPLOYEE' | 'CONTACT';
      name: string;
      phone_e164: string;
      organization_name: string;
      detail: string | null;
    }>(sql`
      SELECT * FROM (
        SELECT e.id, 'EMPLOYEE' AS kind, e.name, e.phone_e164,
               o.display_name AS organization_name,
               CASE WHEN e.all_projects THEN 'Site team · all projects'
                    ELSE 'Site team · assigned projects' END AS detail
        FROM employees e
        JOIN organizations o ON o.id = e.organization_id
        WHERE e.status = 'ACTIVE'
        UNION ALL
        SELECT c.id, 'CONTACT' AS kind, c.name, c.phone_e164,
               o.display_name AS organization_name,
               'Homeowner · ' || cu.display_name AS detail
        FROM contacts c
        JOIN customers cu ON cu.id = c.customer_id AND cu.organization_id = c.organization_id
        JOIN organizations o ON o.id = c.organization_id
        WHERE c.phone_e164 IS NOT NULL AND c.erased_at IS NULL
      ) senders
      ORDER BY organization_name, kind DESC, name
      LIMIT 200
    `);

    return reply.send({
      items: result.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        phoneE164: r.phone_e164,
        organizationName: r.organization_name,
        detail: r.detail,
      })),
    });
  });
}

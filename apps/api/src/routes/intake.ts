import type { FastifyInstance } from 'fastify';
import { ParseIntakeRequestSchema } from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * Paste-to-draft — Tier 1 C (spec 2026-09-14 section C), adapted to the review
 * flow of spec 2026-10-12: the designer pastes a WhatsApp message a contractor
 * sent them and sees what was read before anything is written.
 *
 * Read-only by design. The parse runs here rather than in the browser because
 * `apps/web` may not import `@extrawork/domain`; the UI then raises a proposal
 * through `POST /v1/projects/:id/proposals` with `pasted: true`.
 */
export async function registerIntakeRoutes(
  app: FastifyInstance,
  _appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  // A mutation-class limit although nothing is written: each call runs the
  // parser and a project match, and a paste box is easy to hammer.
  const parseLimit = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });

  app.post('/v1/intake/parse', { preHandler: parseLimit }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { text, projectId } = ParseIntakeRequestSchema.parse(request.body);
    const result = await app.services.changeOrders.parsePastedMessage(auth, text, projectId);
    return reply.send(result);
  });
}

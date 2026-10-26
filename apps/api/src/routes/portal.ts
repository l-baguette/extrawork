import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreatePortalLinkSchema,
  PortalChangeRequestSchema,
  type PortalLinkDto,
} from '@extrawork/contracts';
import type { AppContext, CreatedPortalLink } from '@extrawork/application';
import type { PortalLinkRow } from '@extrawork/db';
import {
  authenticatedSubject,
  publicTokenOnlySubject,
  publicTokenSubject,
  rateLimit,
} from '../plugins/rate-limit.js';

/**
 * Homeowner portal links and the public portal — spec 2026-10-12, D5.
 *
 * Two surfaces:
 *  - `/v1/...` for the designer, behind `requireAuth` and `portal:share`:
 *    share a link with a contact of the project's customer, list, revoke;
 *  - `/public/v1/portal/:token...` for the homeowner, with the approval
 *    page's rules: the token only in the path (never logged — the log holds
 *    the route template), `no-store`, and the app-wide `no-referrer` and
 *    `noindex` headers that every `/public/` response gets in `app.ts`.
 *    Reads are rate-limited like `/public/v1/requests/:token`; asking for a
 *    change has its own per-link budget.
 */

const ProjectParams = z.object({ id: z.string().uuid() });
const LinkParams = z.object({ id: z.string().uuid() });
// The shape a minted token has (32 random bytes, base64url). Anything else is
// refused here, before it reaches a rate-limit bucket or the database.
const TokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const DocumentParams = TokenParams.extend({ id: z.string().uuid() });

const NO_STORE = 'no-store, max-age=0, must-revalidate';

export async function registerPortalRoutes(
  app: FastifyInstance,
  _appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });
  const write = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });
  const publicRead = rateLimit(limiter, {
    name: 'PUBLIC_REQUEST_GET',
    subject: publicTokenSubject,
  });
  const publicAsk = rateLimit(limiter, {
    name: 'PORTAL_CHANGE_REQUEST',
    subject: publicTokenOnlySubject,
  });

  // --- Designer side ---------------------------------------------------------

  app.get('/v1/projects/:id/portal-links', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = ProjectParams.parse(request.params);
    const links = await app.services.portal.listLinks(auth, id);
    return reply.send({ items: links.map(toPortalLinkDto) });
  });

  app.post('/v1/projects/:id/portal-links', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'portal:share');
    const { id } = ProjectParams.parse(request.params);
    const input = CreatePortalLinkSchema.parse(request.body ?? {});
    const created = await app.services.portal.createLink(auth, id, input);
    return reply.status(201).header('cache-control', NO_STORE).send(toCreatedDto(created));
  });

  app.delete('/v1/portal-links/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'portal:share');
    const { id } = LinkParams.parse(request.params);
    await app.services.portal.revokeLink(auth, id);
    return reply.status(204).send();
  });

  // --- Homeowner side ----------------------------------------------------------

  app.get('/public/v1/portal/:token', { preHandler: publicRead }, async (request, reply) => {
    const { token } = TokenParams.parse(request.params);
    const view = await app.services.portal.view(token, request.publicCtx);
    return reply.header('cache-control', NO_STORE).send(view);
  });

  app.get(
    '/public/v1/portal/:token/documents/:id',
    { preHandler: publicRead },
    async (request, reply) => {
      const { token, id } = DocumentParams.parse(request.params);
      const download = await app.services.portal.download(token, id, request.publicCtx);
      return reply.header('cache-control', NO_STORE).send(download);
    },
  );

  // No CSRF pair here, unlike the decision POST: the link itself is the only
  // credential and it is in the path, so a cross-site page cannot forge this
  // without already holding the secret, and the JSON-only body parser refuses
  // a plain HTML form. Nothing it does is a decision; it lands a proposal on
  // the designer's review queue.
  app.post(
    '/public/v1/portal/:token/requests',
    { preHandler: publicAsk },
    async (request, reply) => {
      const { token } = TokenParams.parse(request.params);
      const input = PortalChangeRequestSchema.parse(request.body);
      const result = await app.services.portal.requestChange(token, input, request.publicCtx);
      return reply.status(201).header('cache-control', NO_STORE).send(result);
    },
  );
}

export function toPortalLinkDto(row: PortalLinkRow): PortalLinkDto {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: row.contactName,
    createdVia: row.createdVia,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    viewCount: row.viewCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function toCreatedDto(created: CreatedPortalLink) {
  return {
    link: toPortalLinkDto(created.link),
    portalUrl: created.portalUrl,
    whatsappShareUrl: created.whatsappShareUrl,
    messageText: created.messageText,
  };
}

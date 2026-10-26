import type { FastifyInstance } from 'fastify';
import {
  ListNotificationsQuerySchema,
  MarkNotificationsReadSchema,
  NotificationPreferencesSchema,
  type NotificationDto,
} from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import type { NotificationRow } from '@extrawork/db';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * The signed-in user's inbox — spec 2026-10-12, D14.
 *
 * Personal by construction: every query keys on the session's user id, never
 * on an id from the request, so one member cannot read another's inbox.
 */
export async function registerNotificationRoutes(
  app: FastifyInstance,
  _appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });
  const write = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });

  app.get('/v1/notifications', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const query = ListNotificationsQuerySchema.parse(request.query);
    const page = await app.services.notifications.list(auth, {
      ...(query.unreadOnly ? { unreadOnly: true } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
    });
    return reply.send({
      items: page.items.map(toNotificationDto),
      nextCursor: page.nextCursor,
      unreadCount: page.unreadCount,
    });
  });

  // Marking read is not gated by the subscription: it changes nothing anyone
  // else can see, and a lapsed workspace should still be able to clear a badge.
  app.post('/v1/notifications/read', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const target = MarkNotificationsReadSchema.parse(request.body);
    const updated = await app.services.notifications.markRead(auth, target);
    return reply.send({ updated });
  });

  app.get('/v1/notifications/summary', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const workspaces = await app.services.notifications.summary(auth);
    return reply.send({ workspaces });
  });

  app.get('/v1/notifications/preferences', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    return reply.send(await app.services.notifications.getPreferences(auth));
  });

  app.put('/v1/notifications/preferences', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const prefs = NotificationPreferencesSchema.parse(request.body);
    return reply.send(await app.services.notifications.updatePreferences(auth, prefs));
  });
}

export function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    projectId: row.projectId,
    actorLabel: row.actorLabel,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AppError,
  CalendarQuerySchema,
  CreateMilestoneSchema,
  UpdateMilestoneSchema,
  type CalendarDto,
  type CalendarFeedDto,
  type MilestoneDto,
} from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import type { MilestoneRow } from '@extrawork/db';
import { authenticatedSubject, publicTokenSubject, rateLimit } from '../plugins/rate-limit.js';

const IdParams = z.object({ id: z.string().uuid() });
const FeedParams = z.object({ token: z.string().min(1).max(100) });

/**
 * Milestones, the collated calendar and the private ICS feed — spec
 * 2026-10-12, D14.
 */
export async function registerTimelineRoutes(
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

  // --- Milestones -----------------------------------------------------------------

  app.get('/v1/projects/:id/milestones', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const items = await app.services.timeline.listMilestones(auth, id);
    return reply.send({ items: items.map(toMilestoneDto) });
  });

  app.post('/v1/projects/:id/milestones', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'milestone:manage');
    const { id } = IdParams.parse(request.params);
    const input = CreateMilestoneSchema.parse(request.body);
    const milestone = await app.services.timeline.createMilestone(auth, id, input);
    return reply.status(201).send(toMilestoneDto(milestone));
  });

  app.patch('/v1/milestones/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'milestone:manage');
    const { id } = IdParams.parse(request.params);
    const patch = UpdateMilestoneSchema.parse(request.body);
    const milestone = await app.services.timeline.updateMilestone(auth, id, patch);
    return reply.send(toMilestoneDto(milestone));
  });

  app.delete('/v1/milestones/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'milestone:manage');
    const { id } = IdParams.parse(request.params);
    await app.services.timeline.deleteMilestone(auth, id);
    return reply.status(204).send();
  });

  // --- Calendar -------------------------------------------------------------------

  app.get('/v1/calendar', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const query = CalendarQuerySchema.parse(request.query);
    const events = await app.services.timeline.calendar(auth, query);
    const body: CalendarDto = { from: query.from, to: query.to, events };
    return reply.send(body);
  });

  app.get('/v1/calendar/feed', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const feed = await app.services.timeline.getFeed(auth);
    const body: CalendarFeedDto = {
      feedUrl: null,
      active: feed.active,
      createdAt: feed.createdAt ? feed.createdAt.toISOString() : null,
    };
    return reply.send(body);
  });

  // Creating the feed changes nothing anyone else can see, so a lapsed
  // workspace may still subscribe to its own dates.
  app.post('/v1/calendar/feed', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'calendar:read');
    const feed = await app.services.timeline.createFeed(auth);
    const body: CalendarFeedDto = {
      feedUrl: feed.feedUrl,
      active: true,
      createdAt: feed.createdAt.toISOString(),
    };
    return reply.status(201).send(body);
  });

  app.delete('/v1/calendar/feed', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'calendar:read');
    await app.services.timeline.revokeFeed(auth);
    return reply.status(204).send();
  });

  /**
   * The private feed a calendar app subscribes to. The token is the whole
   * credential, so a miss of any kind — malformed, revoked, the owner removed —
   * is the same 404.
   */
  app.get('/public/v1/calendar/:token', { preHandler: publicRead }, async (request, reply) => {
    const { token } = FeedParams.parse(request.params);
    const ics = await app.services.timeline.feedIcs(token.replace(/\.ics$/i, ''));
    if (ics === null) throw new AppError('NOT_FOUND');
    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .header('content-disposition', 'inline; filename="extrawork.ics"')
      .header('cache-control', 'private, max-age=300')
      .send(ics);
  });
}

export function toMilestoneDto(row: MilestoneRow): MilestoneDto {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    kind: row.kind,
    dueDate: row.dueDate,
    notes: row.notes,
    clientVisible: row.clientVisible,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

import {
  CalendarFeedSchema,
  CalendarSchema,
  CreateMilestoneSchema,
  MilestoneListSchema,
  MilestoneSchema,
  UpdateMilestoneSchema,
} from '@extrawork/contracts';
import type { OpenApiModule } from '../module.js';

/** Milestones, the collated calendar and the private ICS feed — spec 2026-10-12, D14. */
export const timelineOpenApi: OpenApiModule = {
  schemas: {
    Milestone: MilestoneSchema,
    MilestoneList: MilestoneListSchema,
    CreateMilestone: CreateMilestoneSchema,
    UpdateMilestone: UpdateMilestoneSchema,
    Calendar: CalendarSchema,
    CalendarFeed: CalendarFeedSchema,
  },
  paths: (h) => ({
    '/v1/projects/{id}/milestones': {
      get: {
        tags: ['timeline'],
        summary: "A project's milestones, by due date",
        parameters: [h.pathParam('id', 'Project id')],
        responses: { '200': h.jsonResponse('Milestones', 'MilestoneList'), ...h.commonErrors },
      },
      post: {
        tags: ['timeline'],
        summary: 'Add a milestone (designer roles)',
        parameters: [h.pathParam('id', 'Project id')],
        requestBody: h.jsonBody('CreateMilestone'),
        responses: { '201': h.jsonResponse('Created', 'Milestone'), ...h.commonErrors },
      },
    },
    '/v1/milestones/{id}': {
      patch: {
        tags: ['timeline'],
        summary: 'Edit, complete or reopen a milestone (designer roles)',
        parameters: [h.pathParam('id', 'Milestone id')],
        requestBody: h.jsonBody('UpdateMilestone'),
        responses: { '200': h.jsonResponse('Updated', 'Milestone'), ...h.commonErrors },
      },
      delete: {
        tags: ['timeline'],
        summary: 'Delete a milestone (designer roles)',
        parameters: [h.pathParam('id', 'Milestone id')],
        responses: { '204': { description: 'Deleted' }, ...h.commonErrors },
      },
    },
    '/v1/calendar': {
      get: {
        tags: ['timeline'],
        summary: 'Dated events across every project the caller can see',
        description:
          'Project start, expected and revised completion, milestones, approval-link expiries of requests waiting on the client, and decisions. Ids are stable. At most 400 days per request.',
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          {
            name: 'projectId',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: { '200': h.jsonResponse('Events by date', 'Calendar'), ...h.commonErrors },
      },
    },
    '/v1/calendar/feed': {
      get: {
        tags: ['timeline'],
        summary: "Whether the caller's private calendar feed is on (never returns the URL)",
        responses: { '200': h.jsonResponse('Feed state', 'CalendarFeed'), ...h.commonErrors },
      },
      post: {
        tags: ['timeline'],
        summary: 'Create or rotate the private calendar feed',
        description:
          'Returns the subscription URL exactly once; only its hash is stored. Any previous URL stops working.',
        responses: {
          '201': h.jsonResponse('Feed with its URL', 'CalendarFeed'),
          ...h.commonErrors,
        },
      },
      delete: {
        tags: ['timeline'],
        summary: 'Turn the private calendar feed off',
        responses: { '204': { description: 'Revoked' }, ...h.commonErrors },
      },
    },
    '/public/v1/calendar/{token}': {
      get: {
        tags: ['timeline'],
        summary: 'The private ICS feed a calendar app subscribes to',
        description:
          "The token (with or without `.ics`) is the whole credential. Revoked tokens and owners whose membership is no longer active get 404. Covers 60 days back to 18 months ahead, for the owner's current project grants.",
        security: [],
        parameters: [
          {
            name: 'token',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Feed token, optionally suffixed with .ics',
          },
        ],
        responses: {
          '200': {
            description: 'RFC 5545 calendar',
            content: { 'text/calendar': { schema: { type: 'string' } } },
          },
          '404': h.errorResponse('Unknown, revoked or orphaned feed'),
          '429': h.errorResponse('Rate limited'),
        },
      },
    },
  }),
};

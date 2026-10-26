import {
  NotificationListSchema,
  NotificationPreferencesSchema,
  NotificationSummarySchema,
} from '@extrawork/contracts';
import type { OpenApiModule } from '../module.js';

export const notificationsOpenApi: OpenApiModule = {
  schemas: {
    NotificationList: NotificationListSchema,
    NotificationSummary: NotificationSummarySchema,
    NotificationPreferences: NotificationPreferencesSchema,
  },
  paths: (h) => ({
    '/v1/notifications': {
      get: {
        tags: ['notifications'],
        summary: "The signed-in user's notifications in the active workspace",
        responses: {
          '200': h.jsonResponse('Notifications, newest first', 'NotificationList'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/notifications/read': {
      post: {
        tags: ['notifications'],
        summary: 'Mark notifications read, by id or all at once',
        responses: { '200': { description: 'Number updated' }, ...h.commonErrors },
      },
    },
    '/v1/notifications/summary': {
      get: {
        tags: ['notifications'],
        summary: 'Unread counts for every workspace the user belongs to',
        responses: {
          '200': h.jsonResponse('Counts per workspace', 'NotificationSummary'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/notifications/preferences': {
      get: {
        tags: ['notifications'],
        summary: 'Email and reminder preferences',
        responses: {
          '200': h.jsonResponse('Preferences', 'NotificationPreferences'),
          ...h.commonErrors,
        },
      },
      put: {
        tags: ['notifications'],
        summary: 'Replace email and reminder preferences',
        requestBody: h.jsonBody('NotificationPreferences'),
        responses: {
          '200': h.jsonResponse('Preferences', 'NotificationPreferences'),
          ...h.commonErrors,
        },
      },
    },
  }),
};

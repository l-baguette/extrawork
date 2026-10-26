import {
  CreatePortalLinkSchema,
  PortalChangeRequestResultSchema,
  PortalChangeRequestSchema,
  PortalDownloadSchema,
  PortalLinkCreatedSchema,
  PortalLinkListSchema,
  PortalViewSchema,
} from '@extrawork/contracts';
import type { OpenApiModule } from '../module.js';

/** The homeowner portal — spec 2026-10-12, D5. Slice D. */
export const portalOpenApi: OpenApiModule = {
  schemas: {
    CreatePortalLink: CreatePortalLinkSchema,
    PortalLinkCreated: PortalLinkCreatedSchema,
    PortalLinkList: PortalLinkListSchema,
    PortalView: PortalViewSchema,
    PortalDownload: PortalDownloadSchema,
    PortalChangeRequest: PortalChangeRequestSchema,
    PortalChangeRequestResult: PortalChangeRequestResultSchema,
  },
  paths: (h) => ({
    '/v1/projects/{id}/portal-links': {
      parameters: [h.pathParam('id', 'Project id')],
      get: {
        tags: ['portal'],
        summary: "The project's homeowner portal links",
        description: 'Designers only (`portal:share`). Includes revoked and expired links.',
        responses: {
          '200': h.jsonResponse('Portal links, newest first', 'PortalLinkList'),
          ...h.commonErrors,
        },
      },
      post: {
        tags: ['portal'],
        summary: 'Share the project with a homeowner',
        description:
          "Issues a private, no-account link to a contact of the project's customer (the " +
          'default approver when none is given), valid 1–365 days (default 90). The URL is ' +
          'returned once with a wa.me share link and the message text; only its SHA-256 is ' +
          'stored.',
        requestBody: h.jsonBody('CreatePortalLink', false),
        responses: {
          '201': h.jsonResponse('The link and its one-time URL', 'PortalLinkCreated'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/portal-links/{id}': {
      parameters: [h.pathParam('id', 'Portal link id')],
      delete: {
        tags: ['portal'],
        summary: 'Revoke a homeowner portal link',
        description: 'Idempotent. The link stops working at once.',
        responses: { '204': { description: 'Revoked' }, ...h.commonErrors },
      },
    },
    '/public/v1/portal/{token}': {
      parameters: [h.pathParam('token', 'Portal link token')],
      get: {
        tags: ['portal'],
        summary: 'The homeowner portal: one project, as the homeowner may see it',
        description:
          'Public. The project summary, its contract value and history, every request that ' +
          'was ever sent (latest sent version; never drafts or proposals still with the ' +
          'designer), documents in CLIENT folders only, and client-visible milestones. ' +
          'Rate-limited by hashed token and IP; no-store, noindex, no-referrer. A revoked or ' +
          'expired link is PORTAL_LINK_INVALID with `details.reason`.',
        security: [],
        responses: {
          '200': h.jsonResponse('The portal projection', 'PortalView'),
          '404': h.errorResponse('PORTAL_LINK_INVALID'),
          ...h.commonErrors,
        },
      },
    },
    '/public/v1/portal/{token}/documents/{id}': {
      parameters: [
        h.pathParam('token', 'Portal link token'),
        h.pathParam('id', 'A client-visible document id, or a request’s evidenceDocumentId'),
      ],
      get: {
        tags: ['portal'],
        summary: 'Download a shared file or an evidence pack',
        description:
          'Public. A short-lived signed URL, always with attachment disposition, for a CLEAN ' +
          'file in a CLIENT folder or a READY evidence PDF of one of the project’s sent ' +
          'requests.',
        security: [],
        responses: {
          '200': h.jsonResponse('A signed download URL', 'PortalDownload'),
          '404': h.errorResponse('DOCUMENT_NOT_FOUND or PORTAL_LINK_INVALID'),
          ...h.commonErrors,
        },
      },
    },
    '/public/v1/portal/{token}/requests': {
      parameters: [h.pathParam('token', 'Portal link token')],
      post: {
        tags: ['portal'],
        summary: 'The homeowner asks for a change',
        description:
          'Public. Becomes a proposal (origin PORTAL) on the designer’s review queue, ' +
          'attributed to the link’s contact; nothing is priced or sent. Rate-limited per link ' +
          '(10 a day).',
        security: [],
        requestBody: h.jsonBody('PortalChangeRequest'),
        responses: {
          '201': h.jsonResponse('The new request number', 'PortalChangeRequestResult'),
          '404': h.errorResponse('PORTAL_LINK_INVALID'),
          '409': h.errorResponse('PROJECT_CLOSED'),
          ...h.commonErrors,
        },
      },
    },
  }),
};

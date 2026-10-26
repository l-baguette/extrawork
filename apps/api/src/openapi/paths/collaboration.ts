import {
  AcceptInvitationSchema,
  AcceptPendingInvitationSchema,
  AcceptedInvitationSchema,
  InvitationCreatedSchema,
  InvitationPreviewSchema,
  InviteCollaboratorSchema,
  PendingInvitationListSchema,
  ProjectCollaboratorsSchema,
} from '@extrawork/contracts';
import type { OpenApiModule } from '../module.js';

/** Collaborators and invitations — spec 2026-10-12, D1 and D2. Slice A. */
export const collaborationOpenApi: OpenApiModule = {
  schemas: {
    InviteCollaborator: InviteCollaboratorSchema,
    InvitationCreated: InvitationCreatedSchema,
    ProjectCollaborators: ProjectCollaboratorsSchema,
    InvitationPreview: InvitationPreviewSchema,
    AcceptInvitation: AcceptInvitationSchema,
    AcceptPendingInvitation: AcceptPendingInvitationSchema,
    AcceptedInvitation: AcceptedInvitationSchema,
    PendingInvitationList: PendingInvitationListSchema,
  },
  paths: (h) => ({
    '/v1/projects/{id}/collaborators': {
      parameters: [h.pathParam('id', 'Project id')],
      get: {
        tags: ['collaboration'],
        summary: 'People with access to the project, and its invitations',
        description:
          'Organization-wide staff and everyone with a grant on the project. Invitations are ' +
          'listed only for callers who may invite; everyone else gets an empty list.',
        responses: {
          '200': h.jsonResponse('People and invitations', 'ProjectCollaborators'),
          ...h.commonErrors,
        },
      },
      post: {
        tags: ['collaboration'],
        summary: 'Invite someone from another firm (or the homeowner) by email',
        description:
          'Designers only. Re-inviting a pending address refreshes the invitation (new link, ' +
          'new 14-day expiry). The invite URL is returned once and emailed; only its SHA-256 ' +
          'is stored. A WhatsApp number (not for HOMEOWNER) also adds the person to the ' +
          "project's site team.",
        requestBody: h.jsonBody('InviteCollaborator'),
        responses: {
          '201': h.jsonResponse('Invitation and its one-time link', 'InvitationCreated'),
          '409': h.errorResponse('ALREADY_COLLABORATING'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/projects/{id}/collaborators/{userId}': {
      parameters: [h.pathParam('id', 'Project id'), h.pathParam('userId', 'Member user id')],
      delete: {
        tags: ['collaboration'],
        summary: "Remove a person's access to the project",
        description:
          'Refused for organization-wide staff, who see every project by role. A collaborator ' +
          'who loses their last project loses the workspace membership and its sessions.',
        responses: { '204': { description: 'Removed' }, ...h.commonErrors },
      },
    },
    '/v1/invitations/{id}': {
      parameters: [h.pathParam('id', 'Invitation id')],
      delete: {
        tags: ['collaboration'],
        summary: 'Revoke a pending invitation',
        responses: { '204': { description: 'Revoked' }, ...h.commonErrors },
      },
    },
    '/v1/invitations/pending': {
      get: {
        tags: ['collaboration'],
        summary: "Live invitations addressed to the signed-in user's email",
        description:
          'Needs a session but not an organization, so a person with no workspace can see ' +
          'what they were invited to.',
        responses: {
          '200': h.jsonResponse('Pending invitations', 'PendingInvitationList'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/invitations/accept': {
      post: {
        tags: ['collaboration'],
        summary: 'Accept an invitation with its link token',
        description:
          "Needs a session (and CSRF) but not an organization. The session's email must equal " +
          "the invited address. Moves the session's active workspace to the host.",
        requestBody: h.jsonBody('AcceptInvitation'),
        responses: {
          '200': h.jsonResponse('Workspace and project joined', 'AcceptedInvitation'),
          '403': h.errorResponse('INVITATION_EMAIL_MISMATCH or CSRF_FAILED'),
          '404': h.errorResponse('INVITATION_NOT_FOUND (unknown, revoked or used)'),
          '410': h.errorResponse('INVITATION_EXPIRED'),
          ...h.commonErrors,
        },
      },
    },
    '/v1/invitations/accept-pending': {
      post: {
        tags: ['collaboration'],
        summary: 'Accept one of the signed-in user’s pending invitations by id',
        requestBody: h.jsonBody('AcceptPendingInvitation'),
        responses: {
          '200': h.jsonResponse('Workspace and project joined', 'AcceptedInvitation'),
          '404': h.errorResponse('INVITATION_NOT_FOUND'),
          '410': h.errorResponse('INVITATION_EXPIRED'),
          ...h.commonErrors,
        },
      },
    },
    '/public/v1/invitations/{token}': {
      parameters: [h.pathParam('token', 'Invitation link token')],
      get: {
        tags: ['collaboration'],
        summary: 'Preview an invitation before signing in',
        description:
          'Public. Who invited which (masked) address to which project. Rate-limited by ' +
          'hashed token and IP; noindex.',
        security: [],
        responses: {
          '200': h.jsonResponse('Invitation preview', 'InvitationPreview'),
          '404': h.errorResponse('INVITATION_NOT_FOUND'),
          ...h.commonErrors,
        },
      },
    },
  }),
};

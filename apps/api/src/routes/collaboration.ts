import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AcceptInvitationSchema,
  AcceptPendingInvitationSchema,
  AppError,
  InviteCollaboratorSchema,
  type InvitationDto,
  type InvitationPreviewDto,
  type PendingInvitationDto,
  type ProjectPersonDto,
} from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import type { InvitationLookup, InvitationRow, ProjectPersonRow, SessionRow } from '@extrawork/db';
import { SESSION_COOKIE } from '../plugins/context.js';
import {
  authenticatedSubject,
  ipSubject,
  publicTokenSubject,
  rateLimit,
} from '../plugins/rate-limit.js';

/**
 * Collaborators, invitations and the people on a project. Slice A.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md (D1, D2).
 *
 * Three kinds of caller:
 *  - designers managing a project's people, through the ordinary
 *    organization-scoped `requireAuth`;
 *  - an invitee who may belong to no workspace at all yet (a contractor with
 *    no firm on ExtraWork). The pending list and both accept routes resolve
 *    the session directly, as onboarding does, because `requireAuth` would
 *    refuse them with ORGANIZATION_REQUIRED before they could join one;
 *  - anyone holding a link, for the public preview.
 */

const ProjectParams = z.object({ id: z.string().uuid() });
const CollaboratorParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const InvitationParams = z.object({ id: z.string().uuid() });
// The shape a minted token has (32 random bytes, base64url). Anything else is
// refused here, before it reaches the rate-limit bucket or a database query.
const TokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export async function registerCollaborationRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });
  const write = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });
  // Keyed like the public approval page: hashed token + IP (report §7.7).
  const previewLimit = rateLimit(limiter, {
    name: 'PUBLIC_REQUEST_GET',
    subject: publicTokenSubject,
  });
  // The accept routes take a session but not a membership, so the
  // user+organization bucket does not apply; they sit with the other
  // session-establishing flows.
  const acceptLimit = rateLimit(limiter, { name: 'AUTH_FLOW', subject: ipSubject });

  /**
   * The signed-in session without an organization, exactly as
   * `POST /v1/organizations` resolves it: cookie, then CSRF on mutations.
   * Nothing tenant-scoped is read with it; the service derives the host
   * workspace from the invitation, never from the request.
   */
  async function requireSessionOnly(
    request: FastifyRequest,
    options: { mutation: boolean },
  ): Promise<SessionRow> {
    const sessionToken = request.cookies?.[SESSION_COOKIE];
    if (!sessionToken) throw new AppError('UNAUTHENTICATED');
    const session = await app.repos.identity.resolveSession(sessionToken);
    if (!session) throw new AppError('SESSION_EXPIRED');
    if (options.mutation) {
      const csrfToken = request.headers['x-csrf-token'];
      if (typeof csrfToken !== 'string' || !app.repos.identity.verifyCsrf(session, csrfToken)) {
        throw new AppError('CSRF_FAILED');
      }
    }
    return session;
  }

  /**
   * Moves the session into the workspace just joined, so the redirect to the
   * project lands inside it. Only when the membership is really active: a
   * repeat click by someone since removed must not point their session at a
   * workspace they would then be refused from.
   */
  async function enterWorkspace(session: SessionRow, organizationId: string): Promise<void> {
    const membership = await app.repos.identity.getMembership(organizationId, session.userId);
    if (!membership || membership.status !== 'ACTIVE') throw new AppError('NOT_A_MEMBER');
    await appContext.uow.transaction((tx) =>
      app.repos.identity.setActiveOrganization(tx, session.id, organizationId),
    );
  }

  // --- A project's people ---------------------------------------------------

  app.get('/v1/projects/:id/collaborators', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = ProjectParams.parse(request.params);
    const result = await app.services.collaboration.listForProject(auth, id);
    return reply.send({
      people: result.people.map(toProjectPersonDto),
      invitations: result.invitations.map(toInvitationDto),
    });
  });

  app.post('/v1/projects/:id/collaborators', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'collaborator:invite');
    const { id } = ProjectParams.parse(request.params);
    const input = InviteCollaboratorSchema.parse(request.body);
    const result = await app.services.collaboration.invite(auth, id, input);
    return reply.status(201).send({
      invitation: toInvitationDto(result.invitation),
      inviteUrl: result.inviteUrl,
      whatsappShareUrl: result.whatsappShareUrl,
      addedToSiteTeam: result.addedToSiteTeam,
    });
  });

  app.delete(
    '/v1/projects/:id/collaborators/:userId',
    { preHandler: write },
    async (request, reply) => {
      const auth = await app.requireAuth(request, reply);
      app.requireWrite(request, 'collaborator:remove');
      const { id, userId } = CollaboratorParams.parse(request.params);
      await app.services.collaboration.removeCollaborator(auth, id, userId);
      return reply.status(204).send();
    },
  );

  app.delete('/v1/invitations/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'collaborator:invite');
    const { id } = InvitationParams.parse(request.params);
    await app.services.collaboration.revokeInvitation(auth, id);
    return reply.status(204).send();
  });

  // --- The invitee's side ---------------------------------------------------

  // Session-gated and keyed on the session's own address, like /v1/auth/me,
  // which it sits beside on every page load of the shell and onboarding.
  app.get('/v1/invitations/pending', async (request, reply) => {
    const session = await requireSessionOnly(request, { mutation: false });
    const items = await app.services.collaboration.listPending(session.userId);
    return reply.send({ items: items.map(toPendingInvitationDto) });
  });

  app.post('/v1/invitations/accept', { preHandler: acceptLimit }, async (request, reply) => {
    const session = await requireSessionOnly(request, { mutation: true });
    const { token } = AcceptInvitationSchema.parse(request.body);
    const accepted = await app.services.collaboration.accept(
      session.userId,
      token,
      request.requestId,
    );
    await enterWorkspace(session, accepted.organizationId);
    return reply.send(accepted);
  });

  app.post(
    '/v1/invitations/accept-pending',
    { preHandler: acceptLimit },
    async (request, reply) => {
      const session = await requireSessionOnly(request, { mutation: true });
      const { invitationId } = AcceptPendingInvitationSchema.parse(request.body);
      const accepted = await app.services.collaboration.acceptPending(
        session.userId,
        invitationId,
        request.requestId,
      );
      await enterWorkspace(session, accepted.organizationId);
      return reply.send(accepted);
    },
  );

  /**
   * Public preview. Says who invited which masked address to what, and
   * nothing else about the project: a forwarded link shows a stranger only
   * that an invitation exists and that it is not theirs to accept.
   */
  app.get('/public/v1/invitations/:token', { preHandler: previewLimit }, async (request, reply) => {
    const parsed = TokenParams.safeParse(request.params);
    if (!parsed.success) throw new AppError('INVITATION_NOT_FOUND');
    const preview = await app.services.collaboration.preview(parsed.data.token);
    const body: InvitationPreviewDto = {
      organizationName: preview.organizationName,
      projectTitle: preview.projectTitle,
      projectNumber: preview.projectNumber,
      invitedByName: preview.invitedByName,
      party: preview.party,
      emailMasked: preview.emailMasked,
      status: preview.status,
      expiresAt: preview.expiresAt.toISOString(),
    };
    return reply.send(body);
  });
}

function toInvitationDto(row: InvitationRow): InvitationDto {
  return {
    id: row.id,
    projectId: row.projectId,
    email: row.email,
    displayName: row.displayName,
    party: row.party,
    companyName: row.companyName,
    status: row.status,
    invitedByName: row.invitedByName,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toProjectPersonDto(row: ProjectPersonRow): ProjectPersonDto {
  return {
    userId: row.userId,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    party: row.party,
    companyName: row.companyName,
    orgWide: row.orgWide,
    joinedAt: row.joinedAt.toISOString(),
  };
}

function toPendingInvitationDto(row: InvitationLookup): PendingInvitationDto {
  return {
    id: row.id,
    organizationName: row.organizationName,
    projectTitle: row.projectTitle,
    party: row.party,
    invitedByName: row.invitedByName,
    expiresAt: row.expiresAt.toISOString(),
  };
}

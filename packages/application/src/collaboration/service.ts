import {
  AppError,
  COLLABORATOR_PARTY_LABELS,
  DOMAIN_EVENTS,
  JOB_KINDS,
  type CollaboratorParty,
  type InviteCollaboratorInput,
  type TeamParty,
  type TeamRole,
} from '@extrawork/contracts';
import {
  enqueueJob,
  hashOpaqueToken,
  runInScope,
  tenantScope,
  type InvitationLookup,
  type InvitationRow,
  type ProjectPersonRow,
  type TransactionContext,
} from '@extrawork/db';
import {
  ORG_WIDE_ROLES,
  authorize,
  encryptApprovalUrl,
  isAllowed,
  maskEmail,
  normalizeEmail,
  normalizePhone,
  type TenantContext,
} from '@extrawork/domain';
import type { AppContext, RequestContext } from '../context.js';
import { NotificationService } from '../notifications/service.js';

/**
 * Invitations, collaborators and the people on a project. Slice A.
 * Spec: docs/superpowers/specs/2026-10-12-three-party-workspace-design.md
 *
 * A collaborator joins the designer's workspace with the COLLABORATOR role and
 * a grant on each shared project (D1). An invitation is the only way in: the
 * designer names an email, the link goes to that address, and acceptance
 * requires a session for the same address — so a forwarded link does not hand
 * a stranger the project.
 */

/** Spec 2026-10-12: an invitation stays open for two weeks. */
export const INVITATION_TTL_DAYS = 14;

/** A minted token is 32 random bytes in base64url: 43 characters. */
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && INVITATION_TOKEN_PATTERN.test(value);
}

/**
 * Binds the sealed invite link to one tenant and one invitation. The prefix
 * keeps the cipher's authenticated data disjoint from an approval link's, so a
 * sealed invitation can never be opened as a request link or the reverse,
 * although both use the same key (spec: reuse the approval-link helper).
 */
export function invitationCipherContext(organizationId: string, invitationId: string) {
  return { organizationId, versionId: `invitation:${invitationId}` };
}

export interface InviteResult {
  invitation: InvitationRow;
  inviteUrl: string;
  whatsappShareUrl: string;
  addedToSiteTeam: boolean;
}

export interface ProjectCollaborators {
  people: ProjectPersonRow[];
  /** Empty for anyone who cannot invite: addresses of people not yet on the project stay with the designers. */
  invitations: InvitationRow[];
}

export interface AcceptedInvitation {
  organizationId: string;
  projectId: string;
}

export class CollaborationService {
  constructor(readonly app: AppContext) {}

  // --- The people on a project ----------------------------------------------

  async listForProject(ctx: RequestContext, projectId: string): Promise<ProjectCollaborators> {
    authorize(ctx.actor, 'collaborator:read', {
      organizationId: ctx.tenant.organizationId,
      projectId,
    });
    await this.app.repos.projects.requireById(ctx.tenant, projectId);

    const canInvite = isAllowed(ctx.actor, 'collaborator:invite', {
      organizationId: ctx.tenant.organizationId,
      projectId,
    });
    const [people, invitations] = await Promise.all([
      this.app.repos.collaboration.projectPeople(ctx.tenant, projectId),
      canInvite
        ? this.app.repos.collaboration.listForProject(ctx.tenant, projectId)
        : Promise.resolve([]),
    ]);
    return { people, invitations };
  }

  // --- Inviting -------------------------------------------------------------

  async invite(
    ctx: RequestContext,
    projectId: string,
    input: InviteCollaboratorInput,
  ): Promise<InviteResult> {
    authorize(ctx.actor, 'collaborator:invite', {
      organizationId: ctx.tenant.organizationId,
      projectId,
    });
    if (ctx.readOnly) throw new AppError('SUBSCRIPTION_READ_ONLY');

    const email = normalizeEmail(input.email);
    // Normalised exactly as the site-team roster does (report §9.5), before
    // anything is written, so a mistyped number fails the whole invitation
    // rather than leaving half of it behind.
    const phoneE164 = input.phone ? normalizePhone(input.phone) : null;
    const project = await this.app.repos.projects.requireById(ctx.tenant, projectId);
    const inviter = ctx.actor.userId
      ? await this.app.repos.identity.findUserById(ctx.actor.userId)
      : null;
    const inviterName = inviter?.displayName ?? 'Your designer';
    const base = this.app.env.WEB_PUBLIC_URL.replace(/\/+$/, '');
    const now = this.app.clock.now();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000);

    const created = await this.app.uow.transaction(async (tx) => {
      // Inviting someone who already sees the project would grant nothing and
      // leave a link lying around that does nothing; say so instead.
      if (
        await this.app.repos.collaboration.emailHasProjectAccess(
          tx.db,
          ctx.tenant,
          projectId,
          email,
        )
      ) {
        throw new AppError('ALREADY_COLLABORATING');
      }

      const { invitation, token, refreshed } = await this.app.repos.collaboration.createOrRefresh(
        tx,
        ctx.tenant,
        {
          projectId,
          email,
          displayName: input.displayName ?? null,
          party: input.party,
          companyName: input.companyName ?? null,
          phoneE164,
          message: input.message ? input.message : null,
          invitedByUserId: ctx.actor.userId,
          expiresAt,
        },
      );
      const inviteUrl = `${base}/invite/${token}`;

      // Spec D2: a WhatsApp number makes them part of the site team as well,
      // so they can send requests and files by message without logging in.
      // The homeowner is reached as the project's customer, never as site team.
      const addedToSiteTeam =
        phoneE164 !== null && input.party !== 'HOMEOWNER'
          ? await this.addToSiteTeam(tx, ctx.tenant, projectId, {
              name: input.displayName ?? email,
              phoneE164,
              party: input.party,
              companyName: input.companyName ?? null,
            })
          : false;

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'project',
          aggregateId: projectId,
          projectId,
          eventType: DOMAIN_EVENTS.COLLABORATOR_INVITED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: now,
          // The address is not in the payload: audit events are exported and
          // read widely, and the invitation id already identifies the person.
          payload: {
            invitationId: invitation.id,
            party: input.party,
            refreshed,
            addedToSiteTeam,
            expiresAt: expiresAt.toISOString(),
          },
        },
      ]);

      // The worker needs the link after commit, but job_queue is durable
      // storage: seal it with the approval-link helper, bound to this tenant
      // and invitation, exactly as request links are delivered. The ciphertext
      // is erased when the job completes. A refreshed invitation queues a new
      // job; the old one finds its token superseded and sends nothing.
      await enqueueJob(tx, {
        kind: JOB_KINDS.SEND_INVITATION,
        organizationId: ctx.tenant.organizationId,
        dedupeKey: `send-invitation:${invitation.id}:${expiresAt.getTime()}`,
        payload: {
          organizationId: ctx.tenant.organizationId,
          invitationId: invitation.id,
          inviteUrlCiphertext: encryptApprovalUrl(
            inviteUrl,
            this.app.env.APPROVAL_LINK_ENCRYPTION_SECRET,
            invitationCipherContext(ctx.tenant.organizationId, invitation.id),
          ),
        },
      });

      return { invitation, inviteUrl, addedToSiteTeam };
    });

    const message = `${inviterName} invited you to collaborate on ${project.title} on ExtraWork: ${created.inviteUrl}`;
    return {
      invitation: created.invitation,
      inviteUrl: created.inviteUrl,
      whatsappShareUrl: `https://wa.me/?text=${encodeURIComponent(message)}`,
      addedToSiteTeam: created.addedToSiteTeam,
    };
  }

  async revokeInvitation(ctx: RequestContext, invitationId: string): Promise<void> {
    const invitation = await this.app.repos.collaboration.findById(ctx.tenant, invitationId);
    if (!invitation) throw new AppError('INVITATION_NOT_FOUND');
    authorize(ctx.actor, 'collaborator:invite', {
      organizationId: ctx.tenant.organizationId,
      projectId: invitation.projectId,
    });
    if (ctx.readOnly) throw new AppError('SUBSCRIPTION_READ_ONLY');

    await this.app.uow.transaction(async (tx) => {
      const revoked = await this.app.repos.collaboration.revoke(tx, ctx.tenant, invitationId);
      // Already accepted, revoked or expired: nothing is live to withdraw.
      if (!revoked) throw new AppError('INVITATION_NOT_FOUND');
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'project',
          aggregateId: invitation.projectId,
          projectId: invitation.projectId,
          eventType: DOMAIN_EVENTS.COLLABORATOR_INVITATION_REVOKED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { invitationId },
        },
      ]);
    });
  }

  // --- Removing -------------------------------------------------------------

  async removeCollaborator(ctx: RequestContext, projectId: string, userId: string): Promise<void> {
    authorize(ctx.actor, 'collaborator:remove', {
      organizationId: ctx.tenant.organizationId,
      projectId,
    });
    if (ctx.readOnly) throw new AppError('SUBSCRIPTION_READ_ONLY');
    await this.app.repos.projects.requireById(ctx.tenant, projectId);

    await this.app.uow.transaction(async (tx) => {
      const membership = await this.app.repos.collaboration.lockMembership(tx, ctx.tenant, userId);
      if (!membership || membership.status !== 'ACTIVE') throw new AppError('NOT_FOUND');
      if (ORG_WIDE_ROLES.has(membership.role)) {
        // Their role, not a grant, is what lets them see the project; deleting
        // a grant they do not have would look like it worked and change nothing.
        throw new AppError('VALIDATION_FAILED', {
          message:
            'This person sees every project because of their role. Change their role in Settings to limit what they can see.',
        });
      }

      const removed = await this.app.repos.collaboration.revokeProject(
        tx,
        ctx.tenant,
        projectId,
        userId,
      );
      if (!removed) throw new AppError('NOT_FOUND');

      // A collaborator is in the workspace only for their projects. With the
      // last one gone, the membership goes too, and their sessions in this
      // workspace end now rather than at expiry (report §12.1).
      let membershipRevoked = false;
      if (membership.role === 'COLLABORATOR') {
        const remaining = await this.app.repos.collaboration.countGrants(tx, ctx.tenant, userId);
        if (remaining === 0) {
          await this.app.repos.organizations.revokeMember(tx, ctx.tenant, userId);
          await this.app.repos.identity.revokeSessionsForMembership(
            tx,
            ctx.tenant.organizationId,
            userId,
          );
          membershipRevoked = true;
        }
      }

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'project',
          aggregateId: projectId,
          projectId,
          eventType: DOMAIN_EVENTS.COLLABORATOR_REMOVED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { userId, role: membership.role, membershipRevoked },
        },
      ]);
    });
  }

  // --- The invitee's side -----------------------------------------------------

  /** Public: what an invitation link is for, before anyone signs in. */
  async preview(token: string): Promise<InvitationLookup & { emailMasked: string }> {
    if (!isWellFormedInvitationToken(token)) throw new AppError('INVITATION_NOT_FOUND');
    const lookup = await this.app.repos.collaboration.findByTokenHash(hashOpaqueToken(token));
    if (!lookup) throw new AppError('INVITATION_NOT_FOUND');
    return { ...lookup, emailMasked: maskEmail(lookup.email) ?? '***' };
  }

  /** Accepts with the link's token. Requires a session, not a membership. */
  async accept(userId: string, token: string, requestId: string): Promise<AcceptedInvitation> {
    if (!isWellFormedInvitationToken(token)) throw new AppError('INVITATION_NOT_FOUND');
    const lookup = await this.app.repos.collaboration.findByTokenHash(hashOpaqueToken(token));
    if (!lookup) throw new AppError('INVITATION_NOT_FOUND');
    return this.acceptLookup(userId, lookup, requestId);
  }

  /** Live invitations addressed to the signed-in person, in any workspace. */
  async listPending(userId: string): Promise<InvitationLookup[]> {
    const user = await this.app.repos.identity.findUserById(userId);
    if (!user) throw new AppError('UNAUTHENTICATED');
    return this.app.repos.collaboration.findPendingForEmail(user.emailNormalized);
  }

  /** Accepts from the in-app list, where the session's address is the proof. */
  async acceptPending(
    userId: string,
    invitationId: string,
    requestId: string,
  ): Promise<AcceptedInvitation> {
    const user = await this.app.repos.identity.findUserById(userId);
    if (!user) throw new AppError('UNAUTHENTICATED');
    const lookup = await this.app.repos.collaboration.findByIdForEmail(
      invitationId,
      user.emailNormalized,
    );
    if (!lookup) throw new AppError('INVITATION_NOT_FOUND');
    return this.acceptLookup(userId, lookup, requestId);
  }

  private async acceptLookup(
    userId: string,
    lookup: InvitationLookup,
    requestId: string,
  ): Promise<AcceptedInvitation> {
    const user = await this.app.repos.identity.findUserById(userId);
    if (!user || user.status !== 'ACTIVE') throw new AppError('UNAUTHENTICATED');
    const target = { organizationId: lookup.organizationId, projectId: lookup.projectId };

    if (lookup.status === 'ACCEPTED') {
      // A second click on the same link by the person who accepted it is a
      // no-op that still takes them to the project; anyone else learns only
      // that the link is spent.
      if (lookup.acceptedByUserId === userId) return target;
      throw new AppError('INVITATION_NOT_FOUND', {
        message: 'This invitation has already been used. Ask for a new one.',
      });
    }
    if (lookup.status === 'REVOKED') {
      throw new AppError('INVITATION_NOT_FOUND', {
        message: 'This invitation was withdrawn. Ask for a new one if you still need access.',
      });
    }
    if (lookup.status === 'EXPIRED') throw new AppError('INVITATION_EXPIRED');

    // The session is the proof of the address: every way of getting one —
    // password sign-in (refused until the address is confirmed), the emailed
    // sign-in link, Google with a verified claim — proves control of it.
    if (user.emailNormalized !== lookup.email) {
      throw new AppError('INVITATION_EMAIL_MISMATCH');
    }

    // Everything from here writes into the host workspace, which the person
    // is not a member of until this transaction commits. The tenant comes from
    // the invitation the token resolved to, never from the request.
    return runInScope(tenantScope(lookup.organizationId), () =>
      this.app.uow.transaction(async (tx) => {
        const accepted = await this.app.repos.collaboration.markAccepted(
          tx,
          { organizationId: lookup.organizationId, userId, role: 'SYSTEM', requestId },
          lookup.id,
          userId,
        );
        // Lost a race with a revocation, an expiry or another tab.
        if (!accepted) throw new AppError('INVITATION_NOT_FOUND');

        const membership = await this.app.repos.organizations.ensureCollaboratorMembership(tx, {
          organizationId: lookup.organizationId,
          userId,
          invitedByUserId: lookup.invitedByUserId,
          collaboratorParty: lookup.party,
          companyName: lookup.companyName,
        });
        const tenant: TenantContext = {
          organizationId: lookup.organizationId,
          userId,
          role: membership.role,
          requestId,
        };
        await this.app.repos.collaboration.grantProject(tx, tenant, lookup.projectId, userId);

        await this.app.repos.audit.append(tx, tenant, [
          {
            aggregateType: 'project',
            aggregateId: lookup.projectId,
            projectId: lookup.projectId,
            eventType: DOMAIN_EVENTS.COLLABORATOR_JOINED,
            actorType: 'USER',
            actorId: userId,
            occurredAt: this.app.clock.now(),
            payload: {
              invitationId: lookup.id,
              party: lookup.party,
              role: membership.role,
              newMembership: membership.created,
            },
          },
        ]);

        await new NotificationService(this.app).notifyProject(tx, tenant, {
          kind: 'COLLABORATOR_JOINED',
          title: `${user.displayName} joined ${lookup.projectTitle}`,
          body: joinedBody(lookup.party, lookup.companyName),
          linkPath: `/app/projects/${lookup.projectId}/team`,
          projectId: lookup.projectId,
          audience: 'DESIGNERS',
          actorLabel: user.displayName,
          excludeUserIds: [userId],
          dedupeKey: `collaborator-joined:${lookup.id}`,
        });

        return target;
      }),
    );
  }

  // --- Site team ------------------------------------------------------------

  /**
   * Adds the number to this workspace's site team for the project, or reuses
   * the row the roster already has for it (the roster is unique per number).
   * Returns whether they can now message in about this project.
   *
   * Done here with the repositories rather than through `EmployeeService`,
   * whose writes are OWNER/ADMIN only: a designer who may invite someone may
   * also let that person reach this one project by WhatsApp, and nothing more.
   */
  private async addToSiteTeam(
    tx: TransactionContext,
    tenant: TenantContext,
    projectId: string,
    person: {
      name: string;
      phoneE164: string;
      party: Exclude<CollaboratorParty, 'HOMEOWNER'>;
      companyName: string | null;
    },
  ): Promise<boolean> {
    const existing = await this.app.repos.collaboration.findSiteTeamMemberByPhone(
      tx,
      tenant,
      person.phoneE164,
      projectId,
    );
    const party: TeamParty = person.party;
    const teamRole = TEAM_ROLE_FOR_PARTY[person.party];

    if (!existing) {
      await this.app.repos.employees.create(tx, tenant, {
        name: person.name,
        phoneE164: person.phoneE164,
        roleNote: null,
        allProjects: false,
        maxRequestMinor: null,
        projectIds: [projectId],
        party,
        companyName: person.companyName,
        teamRole,
      });
      return true;
    }
    if (existing.status === 'SUSPENDED') {
      // Someone suspended them on purpose; an invitation does not undo that.
      return false;
    }
    if (existing.status === 'REMOVED') {
      await this.app.repos.employees.update(tx, tenant, existing.id, {
        status: 'ACTIVE',
        allProjects: false,
        projectIds: [projectId],
        party,
        companyName: person.companyName,
        teamRole,
      });
      return true;
    }
    if (!existing.allProjects && !existing.assignedToProject) {
      await this.app.repos.collaboration.assignSiteTeamProject(tx, tenant, existing.id, projectId);
    }
    return true;
  }
}

const TEAM_ROLE_FOR_PARTY: Record<Exclude<CollaboratorParty, 'HOMEOWNER'>, TeamRole> = {
  CONSTRUCTION: 'CONTRACTOR',
  ARCHITECT: 'DESIGNER',
  CONSULTANT: 'OTHER',
  OTHER: 'OTHER',
};

function joinedBody(party: CollaboratorParty, companyName: string | null): string {
  const label = COLLABORATOR_PARTY_LABELS[party];
  return companyName ? `${label} · ${companyName}` : label;
}

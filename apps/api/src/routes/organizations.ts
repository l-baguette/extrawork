import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AppError,
  InviteMembershipSchema,
  UpdateMembershipSchema,
  UpdateOrganizationSchema,
} from '@extrawork/contracts';
import { PLANS, assertFreshAuthentication, authorize, isReadOnly } from '@extrawork/domain';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

/** Organizations, memberships and the entitlement projection (report §7.3). */
export async function registerOrganizationRoutes(app: FastifyInstance): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });
  const write = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });

  app.get('/v1/organizations/current', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'organization:read', { organizationId: auth.actor.organizationId });

    const [organization, entitlements] = await Promise.all([
      app.repos.organizations.findById(auth.tenant),
      app.repos.organizations.resolveEntitlements(auth.tenant),
    ]);
    if (!organization) throw new AppError('NOT_FOUND');

    return reply.send({
      id: organization.id,
      displayName: organization.displayName,
      legalName: organization.legalName,
      gstin: organization.gstin,
      timezone: organization.timezone,
      defaultCurrency: organization.defaultCurrency,
      retentionMonths: organization.retentionMonths,
      status: organization.status,
      brandPrimaryColor: organization.brandPrimaryColor,
      contactPhone: organization.contactPhone,
      contactEmail: organization.contactEmail,
      reminderPolicyHours: organization.reminderPolicyHours,
      createdAt: organization.createdAt.toISOString(),
      subscription: {
        planCode: entitlements.subscription.planCode,
        planName: PLANS[entitlements.subscription.planCode].name,
        status: entitlements.subscription.status,
        currentPeriodStart: entitlements.subscription.currentPeriodStart.toISOString(),
        currentPeriodEnd: entitlements.subscription.currentPeriodEnd.toISOString(),
        graceEndsAt: entitlements.subscription.graceEndsAt?.toISOString() ?? null,
        // Report §8.7: read-only means writes stop, evidence stays reachable.
        readOnly: isReadOnly(entitlements.subscription),
        entitlements: entitlements.entitlements,
        usage: entitlements.usage,
      },
    });
  });

  app.patch('/v1/organizations/current', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const patch = UpdateOrganizationSchema.parse(request.body);

    // Retention is a privileged change and needs fresh authentication (§12.1).
    const action =
      patch.retentionMonths !== undefined ? 'organization:manage_retention' : 'organization:update';
    authorize(auth.actor, action, { organizationId: auth.actor.organizationId });
    assertFreshAuthentication(auth.actor, action);
    app.requireWrite(request, action);

    const updated = await app.uow.transaction((tx) =>
      app.repos.organizations.update(tx, auth.tenant, patch),
    );
    return reply.send({ id: updated.id, updatedAt: new Date().toISOString() });
  });

  app.get('/v1/memberships', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'member:read', { organizationId: auth.actor.organizationId });
    const members = await app.repos.organizations.listMembers(auth.tenant);
    return reply.send({
      items: members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    });
  });

  app.post('/v1/memberships/invitations', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'member:invite', { organizationId: auth.actor.organizationId });
    app.requireWrite(request, 'member:invite');

    const input = InviteMembershipSchema.parse(request.body);
    const entitlements = await app.repos.organizations.resolveEntitlements(auth.tenant);
    const memberCount = await app.repos.organizations.countActiveMembers(auth.tenant);
    if (memberCount >= entitlements.entitlements.teamMembers) {
      throw new AppError('ENTITLEMENT_EXCEEDED', {
        message: `Your plan allows ${entitlements.entitlements.teamMembers} team members.`,
      });
    }

    const result = await app.uow.transaction(async (tx) => {
      const user = await app.repos.identity.upsertUser(tx, {
        provider: app.env.AUTH_DRIVER,
        subject: `invite:${input.email}`,
        email: input.email,
        displayName: input.displayName,
      });
      await app.repos.organizations.addMembership(tx, {
        organizationId: auth.actor.organizationId,
        userId: user.id,
        role: input.role,
        status: 'INVITED',
        invitedByUserId: auth.actor.userId,
      });
      return user;
    });

    return reply.status(201).send({ userId: result.id, email: input.email, role: input.role });
  });

  app.patch('/v1/memberships/:userId', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'member:update_role', { organizationId: auth.actor.organizationId });
    app.requireWrite(request, 'member:update_role');

    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const { role } = UpdateMembershipSchema.parse(request.body);

    await app.uow.transaction((tx) =>
      app.repos.organizations.updateMemberRole(tx, auth.tenant, userId, role),
    );
    return reply.status(204).send();
  });

  app.delete('/v1/memberships/:userId', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'member:remove', { organizationId: auth.actor.organizationId });
    assertFreshAuthentication(auth.actor, 'member:remove');
    app.requireWrite(request, 'member:remove');

    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);

    await app.uow.transaction(async (tx) => {
      await app.repos.organizations.revokeMember(tx, auth.tenant, userId);
      // Report §12.1: revoke sessions when membership is removed.
      await app.repos.identity.revokeSessionsForMembership(tx, auth.actor.organizationId, userId);
    });
    return reply.status(204).send();
  });

  app.get('/v1/plans', { preHandler: read }, async (_request, reply) =>
    reply.send({
      plans: Object.entries(PLANS).map(([code, plan]) => ({
        code,
        name: plan.name,
        priceMinor: plan.priceMinor,
        currency: 'INR',
        entitlements: plan.entitlements,
      })),
    }),
  );
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ContactInputSchema,
  CreateCustomerSchema,
  ListCustomersQuerySchema,
  MergeCustomerSchema,
  UpdateContactSchema,
  UpdateCustomerSchema,
} from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { authorize, normalizeEmail, normalizePhone } from '@extrawork/domain';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

const IdParams = z.object({ id: z.string().uuid() });

export async function registerCustomerRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });
  const write = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });

  app.get('/v1/customers', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'customer:read', { organizationId: auth.actor.organizationId });

    const query = ListCustomersQuerySchema.parse(request.query);
    const result = await app.repos.customers.list(auth.tenant, {
      ...(query.query ? { query: query.query } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
      includeMerged: query.includeMerged,
    });

    return reply.send({
      items: result.items.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        legalName: c.legalName,
        mergedIntoCustomerId: c.mergedIntoCustomerId,
        projectCount: c.projectCount,
        // The directory shows who may approve extra cost. This is a summary of
        // one contact, not the customer's full contact list.
        approver: c.approver,
        updatedAt: c.updatedAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    });
  });

  app.post('/v1/customers', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'customer:create');
    const input = CreateCustomerSchema.parse(request.body);
    const customer = await app.services.projects.createCustomer(auth, input);
    return reply.status(201).send({
      id: customer.id,
      displayName: customer.displayName,
      defaultApproverContactId: customer.defaultApproverContactId,
    });
  });

  app.get('/v1/customers/:id', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'customer:read', { organizationId: auth.actor.organizationId });

    const { id } = IdParams.parse(request.params);
    const [customer, contacts, duplicates] = await Promise.all([
      app.repos.customers.requireById(auth.tenant, id),
      app.repos.customers.listContacts(auth.tenant, id),
      app.repos.customers.findDuplicateCandidates(auth.tenant, id),
    ]);
    const projects = await app.repos.projects.list(auth.tenant, { customerId: id, limit: 50 });

    return reply.send({
      id: customer.id,
      displayName: customer.displayName,
      legalName: customer.legalName,
      notes: customer.notes,
      mergedIntoCustomerId: customer.mergedIntoCustomerId,
      lockVersion: customer.lockVersion,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      contacts: contacts.map((c) => ({
        id: c.id,
        customerId: c.customerId,
        name: c.name,
        phoneE164: c.phoneE164,
        email: c.emailNormalized,
        isDefaultApprover: c.isDefaultApprover,
        authorityNote: c.authorityNote,
        whatsappOptInStatus: c.whatsappOptInStatus,
        whatsappOptInAt: c.whatsappOptInAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
      projects: projects.items.map((p) => ({
        id: p.id,
        projectNumber: p.projectNumber,
        title: p.title,
        status: p.status,
        revisedTotalMinor: Number(p.revisedTotalMinor),
        currency: p.currency,
      })),
      // Suggestions only; merging is always an explicit action (report §9.5).
      duplicateCandidates: duplicates,
    });
  });

  app.patch('/v1/customers/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'customer:update', { organizationId: auth.actor.organizationId });
    app.requireWrite(request, 'customer:update');

    const { id } = IdParams.parse(request.params);
    const patch = UpdateCustomerSchema.parse(request.body);
    const expectedLock = parseLockVersion(request.headers['if-match']);

    const updated = await appContext.uow.transaction((tx) =>
      app.repos.customers.update(tx, auth.tenant, id, patch, expectedLock),
    );
    return reply.header('etag', `"${updated.id}:${updated.lockVersion}"`).send({
      id: updated.id,
      lockVersion: updated.lockVersion,
    });
  });

  app.post('/v1/customers/:id/contacts', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'customer:update', { organizationId: auth.actor.organizationId });
    app.requireWrite(request, 'customer:update');

    const { id } = IdParams.parse(request.params);
    const input = ContactInputSchema.parse(request.body);
    await app.repos.customers.requireById(auth.tenant, id);

    const contact = await appContext.uow.transaction((tx) =>
      app.repos.customers.addContact(tx, auth.tenant, id, {
        name: input.name,
        phoneE164: input.phoneE164 ? normalizePhone(input.phoneE164) : null,
        email: input.email ? normalizeEmail(input.email) : null,
        isDefaultApprover: input.isDefaultApprover,
        authorityNote: input.authorityNote ?? null,
      }),
    );
    return reply.status(201).send({ id: contact.id, name: contact.name });
  });

  app.patch('/v1/contacts/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'customer:update', { organizationId: auth.actor.organizationId });
    app.requireWrite(request, 'customer:update');

    const { id } = IdParams.parse(request.params);
    const patch = UpdateContactSchema.parse(request.body);

    const contact = await appContext.uow.transaction((tx) =>
      app.repos.customers.updateContact(tx, auth.tenant, id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.phoneE164 !== undefined
          ? { phoneE164: patch.phoneE164 ? normalizePhone(patch.phoneE164) : null }
          : {}),
        ...(patch.email !== undefined
          ? { email: patch.email ? normalizeEmail(patch.email) : null }
          : {}),
        ...(patch.isDefaultApprover !== undefined
          ? { isDefaultApprover: patch.isDefaultApprover }
          : {}),
        ...(patch.authorityNote !== undefined ? { authorityNote: patch.authorityNote } : {}),
      }),
    );
    return reply.send({ id: contact.id });
  });

  app.post('/v1/customers/:id/merge', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'customer:merge');

    const { id } = IdParams.parse(request.params);
    const input = MergeCustomerSchema.parse(request.body);
    await app.services.projects.mergeCustomers(
      auth,
      id,
      input.sourceCustomerId,
      input.confirmDisplayName,
    );
    return reply.status(200).send({ targetCustomerId: id, merged: input.sourceCustomerId });
  });
}

/** `If-Match: "<id>:<lockVersion>"` — report §7.2 draft-update concurrency. */
export function parseLockVersion(header: unknown): number | undefined {
  if (typeof header !== 'string') return undefined;
  const cleaned = header.replace(/^W\//, '').replace(/"/g, '');
  const parts = cleaned.split(':');
  const raw = parts[parts.length - 1];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

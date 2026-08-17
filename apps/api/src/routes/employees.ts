import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateEmployeeSchema,
  ListEmployeesQuerySchema,
  ListInboundQuerySchema,
  UpdateEmployeeSchema,
  UpdateRequestTemplateSchema,
  type EmployeeDto,
  type InboundMessageDto,
  type RequestTemplateDto,
} from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import type { EmployeeWithAssignments, InboundMessageRow, RequestTemplateRow } from '@extrawork/db';
import { maskPhone } from '@extrawork/domain';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';

/**
 * Owner-facing routes for the WhatsApp intake channel: the employee roster, the
 * customer-facing copy, and the log of every message received.
 */

const IdParams = z.object({ id: z.string().uuid() });

export async function registerEmployeeRoutes(
  app: FastifyInstance,
  _appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });
  const write = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });

  // --- Employees ------------------------------------------------------------

  app.get('/v1/employees', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const query = ListEmployeesQuerySchema.parse(request.query);
    const items = await app.services.employees.list(auth, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.query ? { query: query.query } : {}),
    });
    return reply.send({ items: items.map(toEmployeeDto) });
  });

  app.post('/v1/employees', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'employee:create');
    const input = CreateEmployeeSchema.parse(request.body);
    const employee = await app.services.employees.create(auth, input);
    return reply.status(201).send(toEmployeeDto(employee));
  });

  app.get('/v1/employees/:id', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const employee = await app.services.employees.get(auth, id);
    return reply.send(toEmployeeDto(employee));
  });

  app.patch('/v1/employees/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'employee:update');
    const { id } = IdParams.parse(request.params);
    const patch = UpdateEmployeeSchema.parse(request.body);
    const employee = await app.services.employees.update(auth, id, patch);
    return reply.send(toEmployeeDto(employee));
  });

  app.delete('/v1/employees/:id', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'employee:remove');
    const { id } = IdParams.parse(request.params);
    await app.services.employees.remove(auth, id);
    return reply.status(204).send();
  });

  // --- Request template -----------------------------------------------------

  app.get('/v1/settings/request-template', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const template = await app.services.employees.getTemplate(auth);
    return reply.send(toTemplateDto(template));
  });

  app.patch('/v1/settings/request-template', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'request_template:update');
    const input = UpdateRequestTemplateSchema.parse(request.body);
    const template = await app.services.employees.updateTemplate(auth, input);
    return reply.send(toTemplateDto(template));
  });

  // --- Inbound message log --------------------------------------------------

  app.get('/v1/requests', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const query = ListInboundQuerySchema.parse(request.query);

    const page = await app.services.employees.listInbound(auth, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.unresolvedOnly ? { unresolvedOnly: true } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
    });

    const decorated = decorate(page.items);
    return reply.send({ items: decorated, nextCursor: page.nextCursor });
  });

  app.get('/v1/requests/:id', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const message = await app.services.employees.getInbound(auth, id);
    const [decorated] = decorate([message]);
    return reply.send(decorated);
  });
}

/**
 * Resolves employee and project names for display. Both lookups are
 * tenant-scoped, so a message that somehow referenced a foreign id would render
 * a null name rather than leaking one.
 */
function decorate(rows: InboundMessageRow[]): InboundMessageDto[] {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    fromPhoneMasked: maskPhone(row.fromPhoneE164) ?? '',
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    projectId: row.projectId,
    projectTitle: row.projectTitle,
    changeOrderId: row.changeOrderId,
    body: row.body,
    mediaCount: row.mediaCount,
    rejectionReason: row.rejectionReason,
    replyText: row.replyText,
    receivedAt: row.receivedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  }));
}

function toEmployeeDto(row: EmployeeWithAssignments): EmployeeDto {
  return {
    id: row.id,
    name: row.name,
    phoneE164: row.phoneE164,
    phoneMasked: maskPhone(row.phoneE164) ?? '',
    roleNote: row.roleNote,
    status: row.status,
    allProjects: row.allProjects,
    projectIds: row.projectIds,
    // Ceilings are well under Number.MAX_SAFE_INTEGER; the wire format is JSON.
    maxRequestMinor: row.maxRequestMinor === null ? null : Number(row.maxRequestMinor),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTemplateDto(row: RequestTemplateRow): RequestTemplateDto {
  return {
    heading: row.heading,
    intro: row.intro,
    termsBody: row.termsBody,
    paymentNote: row.paymentNote,
    footerNote: row.footerNote,
    templateVersion: row.templateVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

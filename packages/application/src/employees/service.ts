import {
  AppError,
  DOMAIN_EVENTS,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
  type UpdateRequestTemplateInput,
} from '@extrawork/contracts';
import type {
  EmployeeWithAssignments,
  InboundMessageRow,
  InboundStatus,
  RequestTemplateRow,
} from '@extrawork/db';
import { authorize, normalizePhone, type TenantContext } from '@extrawork/domain';
import type { AppContext, RequestContext } from '../context.js';

/**
 * The owner-facing use cases for WhatsApp intake: who may raise a request, the
 * copy their customers see, and the log of everything that came in.
 *
 * Nothing here processes an inbound message — that is the intake service, built
 * on top of these same repositories. This class is only what the dashboard
 * drives.
 */
export class EmployeeService {
  constructor(private readonly app: AppContext) {}

  // --- Employees ------------------------------------------------------------

  async list(
    ctx: RequestContext,
    options: { status?: 'ACTIVE' | 'SUSPENDED' | 'REMOVED'; query?: string } = {},
  ): Promise<EmployeeWithAssignments[]> {
    authorize(ctx.actor, 'employee:read', { organizationId: ctx.tenant.organizationId });
    return this.app.repos.employees.list(ctx.tenant, options);
  }

  async get(ctx: RequestContext, employeeId: string): Promise<EmployeeWithAssignments> {
    authorize(ctx.actor, 'employee:read', { organizationId: ctx.tenant.organizationId });
    return this.app.repos.employees.requireById(ctx.tenant, employeeId);
  }

  async create(ctx: RequestContext, input: CreateEmployeeInput): Promise<EmployeeWithAssignments> {
    authorize(ctx.actor, 'employee:create', { organizationId: ctx.tenant.organizationId });
    if (ctx.readOnly) throw new AppError('SUBSCRIPTION_READ_ONLY');

    // Normalised before storage (report §9.5) and before the uniqueness check,
    // so `98765 43210` and `+91 98765 43210` cannot both be registered.
    const phoneE164 = normalizePhone(input.phone);
    const projectIds = await this.resolveProjectIds(
      ctx.tenant,
      input.allProjects,
      input.projectIds,
    );

    return this.app.uow.transaction(async (tx) => {
      const employee = await this.app.repos.employees.create(tx, ctx.tenant, {
        name: input.name,
        phoneE164,
        roleNote: input.roleNote ?? null,
        allProjects: input.allProjects,
        maxRequestMinor:
          input.maxRequestMinor === null || input.maxRequestMinor === undefined
            ? null
            : BigInt(input.maxRequestMinor),
        projectIds,
      });

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'employee',
          aggregateId: employee.id,
          projectId: null,
          eventType: DOMAIN_EVENTS.EMPLOYEE_CREATED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          // The number itself is not in the payload: audit events are exported
          // and read widely, and the employee id already identifies the person.
          payload: {
            name: employee.name,
            allProjects: employee.allProjects,
            projectCount: employee.projectIds.length,
            hasCeiling: employee.maxRequestMinor !== null,
          },
        },
      ]);

      return employee;
    });
  }

  async update(
    ctx: RequestContext,
    employeeId: string,
    input: UpdateEmployeeInput,
  ): Promise<EmployeeWithAssignments> {
    authorize(ctx.actor, 'employee:update', { organizationId: ctx.tenant.organizationId });
    if (ctx.readOnly) throw new AppError('SUBSCRIPTION_READ_ONLY');

    const existing = await this.app.repos.employees.requireById(ctx.tenant, employeeId);

    const allProjects = input.allProjects ?? existing.allProjects;
    const projectIds =
      input.projectIds === undefined
        ? undefined
        : await this.resolveProjectIds(ctx.tenant, allProjects, input.projectIds);

    return this.app.uow.transaction(async (tx) => {
      const employee = await this.app.repos.employees.update(tx, ctx.tenant, employeeId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.phone === undefined ? {} : { phoneE164: normalizePhone(input.phone) }),
        ...(input.roleNote === undefined ? {} : { roleNote: input.roleNote }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.allProjects === undefined ? {} : { allProjects: input.allProjects }),
        ...(input.maxRequestMinor === undefined
          ? {}
          : {
              maxRequestMinor:
                input.maxRequestMinor === null ? null : BigInt(input.maxRequestMinor),
            }),
        ...(projectIds === undefined ? {} : { projectIds }),
      });

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'employee',
          aggregateId: employee.id,
          projectId: null,
          eventType: DOMAIN_EVENTS.EMPLOYEE_UPDATED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            changed: Object.keys(input),
            status: employee.status,
            allProjects: employee.allProjects,
            projectCount: employee.projectIds.length,
          },
        },
      ]);

      return employee;
    });
  }

  /**
   * Soft-removes the employee. The row survives so the inbound log keeps
   * pointing at a real person, but the number is freed for reuse.
   */
  async remove(ctx: RequestContext, employeeId: string): Promise<void> {
    authorize(ctx.actor, 'employee:remove', { organizationId: ctx.tenant.organizationId });
    if (ctx.readOnly) throw new AppError('SUBSCRIPTION_READ_ONLY');

    const existing = await this.app.repos.employees.requireById(ctx.tenant, employeeId);

    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.employees.remove(tx, ctx.tenant, employeeId);
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'employee',
          aggregateId: employeeId,
          projectId: null,
          eventType: DOMAIN_EVENTS.EMPLOYEE_REMOVED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { name: existing.name },
        },
      ]);
    });
  }

  /**
   * Filters requested project ids down to ones this tenant actually owns, and
   * fails loudly on a foreign id rather than silently dropping it.
   *
   * The repository also filters (defence in depth), but doing it here lets the
   * owner see "that project does not exist" instead of quietly saving an
   * employee with fewer assignments than they selected.
   */
  private async resolveProjectIds(
    tenant: TenantContext,
    allProjects: boolean,
    requested: string[],
  ): Promise<string[]> {
    if (allProjects || requested.length === 0) return [];

    const unique = [...new Set(requested)];
    for (const projectId of unique) {
      // Throws PROJECT_NOT_FOUND for a cross-tenant id, never FORBIDDEN.
      await this.app.repos.projects.requireById(tenant, projectId);
    }
    return unique;
  }

  // --- Request template -----------------------------------------------------

  async getTemplate(ctx: RequestContext): Promise<RequestTemplateRow> {
    authorize(ctx.actor, 'request_template:read', { organizationId: ctx.tenant.organizationId });
    return this.app.uow.transaction((tx) => this.app.repos.requestTemplates.ensure(tx, ctx.tenant));
  }

  async updateTemplate(
    ctx: RequestContext,
    input: UpdateRequestTemplateInput,
  ): Promise<RequestTemplateRow> {
    authorize(ctx.actor, 'request_template:update', { organizationId: ctx.tenant.organizationId });
    if (ctx.readOnly) throw new AppError('SUBSCRIPTION_READ_ONLY');

    return this.app.uow.transaction(async (tx) => {
      const template = await this.app.repos.requestTemplates.update(tx, ctx.tenant, input);

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'organization',
          aggregateId: ctx.tenant.organizationId,
          projectId: null,
          eventType: DOMAIN_EVENTS.REQUEST_TEMPLATE_UPDATED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { changed: Object.keys(input), templateVersion: template.templateVersion },
        },
      ]);

      return template;
    });
  }

  // --- Inbound message log --------------------------------------------------

  async listInbound(
    ctx: RequestContext,
    options: {
      status?: InboundStatus;
      employeeId?: string;
      unresolvedOnly?: boolean;
      cursor?: string;
      limit: number;
    },
  ): Promise<{ items: InboundMessageRow[]; nextCursor: string | null }> {
    authorize(ctx.actor, 'inbound_message:read', { organizationId: ctx.tenant.organizationId });

    const page = await this.app.repos.inboundMessages.list(ctx.tenant, {
      ...(options.status ? { status: options.status } : {}),
      ...(options.employeeId ? { employeeId: options.employeeId } : {}),
      ...(options.unresolvedOnly ? { unresolvedOnly: true } : {}),
      ...(options.cursor ? { cursor: decodeInboundCursor(options.cursor) } : {}),
      limit: options.limit,
    });

    return {
      items: page.items,
      nextCursor: page.nextCursor ? encodeInboundCursor(page.nextCursor) : null,
    };
  }

  async getInbound(ctx: RequestContext, messageId: string): Promise<InboundMessageRow> {
    authorize(ctx.actor, 'inbound_message:read', { organizationId: ctx.tenant.organizationId });
    return this.app.repos.inboundMessages.requireById(ctx.tenant, messageId);
  }
}

/**
 * The keyset cursor is opaque to the client but not a secret — it holds only a
 * timestamp and an id the caller already has. Base64url keeps it URL-safe.
 */
function encodeInboundCursor(cursor: { receivedAt: string; id: string }): string {
  return Buffer.from(`${cursor.receivedAt}|${cursor.id}`, 'utf8').toString('base64url');
}

function decodeInboundCursor(raw: string): { receivedAt: string; id: string } {
  const [receivedAt, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (!receivedAt || !id) {
    throw new AppError('VALIDATION_FAILED', { message: 'That page cursor is not valid.' });
  }
  return { receivedAt, id };
}

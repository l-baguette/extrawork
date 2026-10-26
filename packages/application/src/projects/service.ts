import {
  AppError,
  DOMAIN_EVENTS,
  type BaselineAmendmentInput,
  type CreateCustomerInput,
  type ContractHistoryDto,
  type CreateProjectInput,
} from '@extrawork/contracts';
import {
  allocateNumber,
  type ContractHistorySource,
  type CustomerRow,
  type ProjectRow,
} from '@extrawork/db';
import {
  assertBaselineEditable,
  assertQuota,
  authorize,
  normalizeEmail,
  normalizePhone,
  type TenantContext,
} from '@extrawork/domain';
import type { AppContext, RequestContext } from '../context.js';

/**
 * Customer, project and baseline use cases — report §4.1 and §7.1.
 */
export class ProjectService {
  constructor(private readonly app: AppContext) {}

  async createCustomer(
    ctx: RequestContext,
    input: CreateCustomerInput,
  ): Promise<CustomerRow & { defaultApproverContactId: string | null }> {
    authorize(ctx.actor, 'customer:create', { organizationId: ctx.tenant.organizationId });

    return this.app.uow.transaction(async (tx) => {
      const customer = await this.app.repos.customers.create(tx, ctx.tenant, {
        displayName: input.displayName,
        legalName: input.legalName ?? null,
        notes: input.notes ?? null,
      });

      let defaultApproverContactId: string | null = null;
      for (const contact of input.contacts) {
        const createdContact = await this.app.repos.customers.addContact(
          tx,
          ctx.tenant,
          customer.id,
          {
            name: contact.name,
            // Normalised to E.164 / lowercase before storage (report §9.5).
            phoneE164: contact.phoneE164 ? normalizePhone(contact.phoneE164) : null,
            email: contact.email ? normalizeEmail(contact.email) : null,
            isDefaultApprover: contact.isDefaultApprover,
            authorityNote: contact.authorityNote ?? null,
          },
        );
        if (contact.isDefaultApprover && defaultApproverContactId === null) {
          defaultApproverContactId = createdContact.id;
        }
      }

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'customer',
          aggregateId: customer.id,
          projectId: null,
          eventType: DOMAIN_EVENTS.CUSTOMER_CREATED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { displayName: customer.displayName, contactCount: input.contacts.length },
        },
      ]);

      return { ...customer, defaultApproverContactId };
    });
  }

  async mergeCustomers(
    ctx: RequestContext,
    targetCustomerId: string,
    sourceCustomerId: string,
    confirmDisplayName: string,
  ): Promise<void> {
    authorize(ctx.actor, 'customer:merge', { organizationId: ctx.tenant.organizationId });

    const source = await this.app.repos.customers.requireById(ctx.tenant, sourceCustomerId);
    await this.app.repos.customers.requireById(ctx.tenant, targetCustomerId);

    // Typed confirmation guards an irreversible action (report §9.5).
    if (source.displayName.trim().toLowerCase() !== confirmDisplayName.trim().toLowerCase()) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'Type the source customer name exactly to confirm the merge.',
      });
    }

    await this.app.uow.transaction(async (tx) => {
      const result = await this.app.repos.customers.merge(
        tx,
        ctx.tenant,
        targetCustomerId,
        sourceCustomerId,
      );
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'customer',
          aggregateId: targetCustomerId,
          projectId: null,
          eventType: DOMAIN_EVENTS.CUSTOMER_MERGED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { sourceCustomerId, ...result },
        },
      ]);
    });
  }

  async createProject(ctx: RequestContext, input: CreateProjectInput): Promise<ProjectRow> {
    authorize(ctx.actor, 'project:create', { organizationId: ctx.tenant.organizationId });

    const entitlementState = await this.app.repos.organizations.resolveEntitlements(ctx.tenant);
    if (entitlementState.readOnly) throw new AppError('SUBSCRIPTION_READ_ONLY');
    assertQuota(entitlementState.entitlements, entitlementState.usage, 'activeProjects');

    const customer = await this.app.repos.customers.requireById(ctx.tenant, input.customerId);
    const approver = await this.app.repos.customers.requireContact(
      ctx.tenant,
      input.defaultApproverContactId,
    );
    if (approver.customerId !== customer.id) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'The authorised approver must be a contact of this customer.',
      });
    }
    if (input.baselineDocumentFileId) {
      const file = await this.app.repos.files.requireById(ctx.tenant, input.baselineDocumentFileId);
      this.app.repos.files.assertViewable(file);
    }

    return this.app.uow.transaction(async (tx) => {
      const number = await allocateNumber(tx, ctx.tenant, 'PROJECT', null);
      const project = await this.app.repos.projects.create(tx, ctx.tenant, {
        customerId: input.customerId,
        projectNumber: number.formatted,
        title: input.title,
        description: input.description?.trim() || null,
        siteAddress: input.siteAddress ?? null,
        currency: input.currency,
        timezone: input.timezone,
        baselineSubtotalMinor: BigInt(input.baseline.subtotalMinor),
        baselineTaxMinor: BigInt(input.baseline.taxMinor),
        baselineTotalMinor: BigInt(input.baseline.totalMinor),
        startDate: input.startDate ?? null,
        expectedCompletionDate: input.expectedCompletionDate ?? null,
        defaultApproverContactId: input.defaultApproverContactId,
        baselineDocumentFileId: input.baselineDocumentFileId ?? null,
      });

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'project',
          aggregateId: project.id,
          projectId: project.id,
          eventType: DOMAIN_EVENTS.PROJECT_CREATED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            projectNumber: project.projectNumber,
            customerId: customer.id,
            currency: project.currency,
            timezone: project.timezone,
          },
        },
        {
          aggregateType: 'project',
          aggregateId: project.id,
          projectId: project.id,
          eventType: DOMAIN_EVENTS.PROJECT_BASELINE_RECORDED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            baselineSubtotalMinor: String(input.baseline.subtotalMinor),
            baselineTaxMinor: String(input.baseline.taxMinor),
            baselineTotalMinor: String(input.baseline.totalMinor),
            hasSupportingDocument: Boolean(input.baselineDocumentFileId),
          },
        },
      ]);

      return project;
    });
  }

  /**
   * Report §4.1: "Changing the baseline after the first sent change requires an
   * explicit baseline amendment event, not a silent update."
   */
  async amendBaseline(
    ctx: RequestContext,
    projectId: string,
    input: BaselineAmendmentInput,
  ): Promise<ProjectRow> {
    const project = await this.app.repos.projects.requireById(ctx.tenant, projectId);
    authorize(ctx.actor, 'project:amend_baseline', {
      organizationId: project.organizationId,
      projectId,
    });

    return this.app.uow.transaction(async (tx) => {
      const locked = await this.app.repos.projects.lockById(tx, ctx.tenant, projectId);

      const versionNumber = await this.app.repos.projects.recordBaselineAmendment(
        tx,
        ctx.tenant,
        projectId,
        {
          subtotalMinor: BigInt(input.baseline.subtotalMinor),
          taxMinor: BigInt(input.baseline.taxMinor),
          totalMinor: BigInt(input.baseline.totalMinor),
          reason: input.reason,
          effectiveDate: input.effectiveDate ?? null,
          supportingFileId: input.supportingFileId ?? null,
        },
      );

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'project',
          aggregateId: projectId,
          projectId,
          eventType: DOMAIN_EVENTS.PROJECT_BASELINE_AMENDED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            baselineVersion: versionNumber,
            previousTotalMinor: locked.baselineTotalMinor.toString(),
            newTotalMinor: String(input.baseline.totalMinor),
            reason: input.reason,
          },
        },
      ]);

      return this.app.repos.projects.requireById(ctx.tenant, projectId);
    });
  }

  /**
   * Before the first send the baseline may simply be corrected in place; after
   * it, only an amendment is permitted (report §4.1, §4.6).
   */
  async updateBaselineBeforeFirstSend(
    ctx: RequestContext,
    projectId: string,
    baseline: { subtotalMinor: number; taxMinor: number; totalMinor: number },
  ): Promise<ProjectRow> {
    const project = await this.app.repos.projects.requireById(ctx.tenant, projectId);
    authorize(ctx.actor, 'project:update', { organizationId: project.organizationId, projectId });
    assertBaselineEditable(project.hasSentChange);

    return this.app.uow.transaction(async (tx) => {
      await this.app.repos.projects.recordBaselineAmendment(tx, ctx.tenant, projectId, {
        subtotalMinor: BigInt(baseline.subtotalMinor),
        taxMinor: BigInt(baseline.taxMinor),
        totalMinor: BigInt(baseline.totalMinor),
        reason: 'Baseline corrected before the first request was sent',
        effectiveDate: null,
        supportingFileId: null,
      });
      return this.app.repos.projects.requireById(ctx.tenant, projectId);
    });
  }

  async closeProject(ctx: RequestContext, projectId: string, reason: string | null): Promise<void> {
    const project = await this.app.repos.projects.requireById(ctx.tenant, projectId);
    authorize(ctx.actor, 'project:close', { organizationId: project.organizationId, projectId });

    const organization = await this.app.repos.organizations.findById(ctx.tenant);
    const pending = await this.app.repos.projects.pendingTotals(ctx.tenant, projectId);
    if (pending.pendingCount > 0) {
      throw new AppError('INVALID_STATE_TRANSITION', {
        message: `This project still has ${pending.pendingCount} request(s) awaiting a decision.`,
        details: { pendingCount: pending.pendingCount },
      });
    }

    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.projects.close(
        tx,
        ctx.tenant,
        projectId,
        organization?.retentionMonths ?? 36,
      );
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'project',
          aggregateId: projectId,
          projectId,
          eventType: DOMAIN_EVENTS.PROJECT_CLOSED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { reason, retentionMonths: organization?.retentionMonths ?? 36 },
        },
      ]);
    });
  }

  /**
   * Reopens a closed project — a snag list after handover, a phase two. The
   * same right that closes a project reopens it (`project:close`), so the
   * designer who closed it by mistake can undo it without asking the owner.
   */
  async reopenProject(
    ctx: RequestContext,
    projectId: string,
    reason: string | null,
  ): Promise<void> {
    const project = await this.app.repos.projects.requireById(ctx.tenant, projectId);
    authorize(ctx.actor, 'project:close', { organizationId: project.organizationId, projectId });
    if (project.status !== 'CLOSED') {
      throw new AppError('INVALID_STATE_TRANSITION', {
        message: 'Only a closed project can be reopened.',
        details: { currentStatus: project.status },
      });
    }

    await this.app.uow.transaction(async (tx) => {
      const reopened = await this.app.repos.projects.reopen(tx, ctx.tenant, projectId);
      if (!reopened) {
        throw new AppError('INVALID_STATE_TRANSITION', {
          message: 'This project is no longer closed.',
        });
      }
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'project',
          aggregateId: projectId,
          projectId,
          eventType: DOMAIN_EVENTS.PROJECT_REOPENED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { reason, closedAt: project.closedAt?.toISOString() ?? null },
        },
      ]);
    });
  }

  /**
   * The contract value over time: the original baseline, each audited
   * amendment, and each approved change in the order it was decided, with the
   * running total after each. A deduction carries its negative delta, so the
   * running total always ends at the project's revised total.
   */
  async contractHistory(ctx: RequestContext, projectId: string): Promise<ContractHistoryDto> {
    const project = await this.app.repos.projects.requireById(ctx.tenant, projectId);
    authorize(ctx.actor, 'project:read', { organizationId: project.organizationId, projectId });

    const sources = await this.app.repos.projects.contractHistorySources(ctx.tenant, projectId);
    return buildContractHistory(project, sources);
  }

  /** Read used by the project workspace, including the pending-delta preview. */
  async projectTotals(
    tenant: TenantContext,
    projectId: string,
  ): Promise<{
    project: ProjectRow;
    pendingDeltaMinor: bigint;
    pendingCount: number;
    approvedCount: number;
  }> {
    const project = await this.app.repos.projects.requireById(tenant, projectId);
    const pending = await this.app.repos.projects.pendingTotals(tenant, projectId);
    return { project, ...pending };
  }
}

/**
 * The contract value over time from its sources (see `contractHistory`).
 * Exported so the homeowner portal shows exactly the history the designer
 * sees, computed once rather than twice (spec 2026-10-12, D5).
 */
export function buildContractHistory(
  project: Pick<ProjectRow, 'currency' | 'revisedTotalMinor'>,
  sources: ContractHistorySource[],
): ContractHistoryDto {
  // Stable by time; on a tie the baseline row comes first, because an
  // amendment and a decision in the same instant cannot have been ordered
  // the other way by the person who recorded the amendment.
  const ordered = sources
    .map((source, index) => ({ source, index }))
    .sort(
      (a, b) =>
        a.source.occurredAt.getTime() - b.source.occurredAt.getTime() ||
        kindRank(a.source.kind) - kindRank(b.source.kind) ||
        a.index - b.index,
    )
    .map((entry) => entry.source);

  let baseline = 0n;
  let approved = 0n;
  const entries = ordered.map((source) => {
    let delta: bigint;
    if (source.kind === 'APPROVED_CHANGE') {
      delta = source.amountMinor;
      approved += delta;
    } else {
      delta = source.amountMinor - baseline;
      baseline = source.amountMinor;
    }
    return {
      kind: source.kind,
      occurredAt: source.occurredAt.toISOString(),
      label: source.label,
      deltaMinor: Number(delta),
      runningTotalMinor: Number(baseline + approved),
      scheduleDeltaDays: source.scheduleDeltaDays,
      changeOrderId: source.changeOrderId,
      number: source.number,
      reason: source.reason,
    };
  });

  return {
    currency: project.currency,
    entries,
    currentTotalMinor: Number(project.revisedTotalMinor),
  };
}

function kindRank(kind: 'BASELINE' | 'BASELINE_AMENDMENT' | 'APPROVED_CHANGE'): number {
  return kind === 'APPROVED_CHANGE' ? 1 : 0;
}

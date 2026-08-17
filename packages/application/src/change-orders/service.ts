import {
  AppError,
  DOMAIN_EVENTS,
  type CreateChangeOrderInput,
  type UpdateDraftInput,
} from '@extrawork/contracts';
import { allocateNumber, type VersionRow } from '@extrawork/db';
import {
  addDays,
  assertAssuranceSelectable,
  authorize,
  calculateVersionTotals,
  collectSendBlockers,
  deriveChangeType,
  maskedContactLabel,
  validateDraft,
  canCreateRevision,
  assertAttachmentRemovable,
  type Blocker,
} from '@extrawork/domain';
import type { AppContext, RequestContext } from '../context.js';
import { buildLineItemWrites, toCalcInputs, versionEtag } from './build-lines.js';

/**
 * Change-order composition — report §4.1–§4.4, §6.3, §8.1, §8.2.
 *
 * Domain rules and state transitions live in `packages/domain`; this service
 * orchestrates them across repositories inside a single transaction that also
 * writes the audit events (report §7.5, §14.4).
 */

export class ChangeOrderService {
  constructor(private readonly app: AppContext) {}

  async create(
    ctx: RequestContext,
    projectId: string,
    input: CreateChangeOrderInput,
  ): Promise<{ changeOrderId: string; number: string; version: VersionRow }> {
    const project = await this.app.repos.projects.requireById(ctx.tenant, projectId);
    authorize(ctx.actor, 'change_order:create', {
      organizationId: project.organizationId,
      projectId: project.id,
    });

    const { entitlements } = await this.app.repos.organizations.resolveEntitlements(ctx.tenant);
    assertAssuranceSelectable(input.assuranceRequired, entitlements);

    const approver = await this.app.repos.customers.requireContact(
      ctx.tenant,
      input.approverContactId,
    );
    if (approver.customerId !== project.customerId) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'The approver must be a contact of this project’s customer.',
      });
    }

    const lines = toCalcInputs(input.lineItems);
    const priorApproved = await this.app.repos.changeOrders.priorApprovedDelta(
      this.app.uow.db,
      ctx.tenant,
      projectId,
    );
    const type = input.type ?? deriveChangeType(lines, input.scheduleDeltaDays);

    // Throws on any hard rule breach before anything is written.
    const totals = validateDraft({
      projectCurrency: project.currency,
      currency: project.currency,
      projectStatus: project.status,
      baselineTotalMinor: project.baselineTotalMinor,
      priorApprovedDeltaMinor: priorApproved,
      lineItems: lines,
      scheduleDeltaDays: input.scheduleDeltaDays,
      type,
      assuranceRequired: input.assuranceRequired,
      attachmentScanStatuses: [],
    });

    return this.app.uow.transaction(async (tx) => {
      const number = await allocateNumber(tx, ctx.tenant, 'CHANGE_ORDER', projectId);

      const { changeOrder, version } = await this.app.repos.changeOrders.createWithDraft(
        tx,
        ctx.tenant,
        {
          projectId,
          number: number.formatted,
          type,
          title: input.title,
          scope: input.scope,
          reason: input.reason ?? null,
          scheduleDeltaDays: input.scheduleDeltaDays,
          revisedCompletionDate: this.projectedCompletion(project, input.scheduleDeltaDays),
          approverContactId: input.approverContactId,
          assuranceRequired: input.assuranceRequired,
          currency: project.currency,
          subtotalDeltaMinor: totals.subtotalDeltaMinor,
          taxDeltaMinor: totals.taxDeltaMinor,
          totalDeltaMinor: totals.totalDeltaMinor,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          lineItems: buildLineItemWrites(input.lineItems),
        },
      );

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrder.id,
          projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_CREATED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            number: changeOrder.number,
            type,
            title: input.title,
            totalDeltaMinor: totals.totalDeltaMinor.toString(),
            scheduleDeltaDays: input.scheduleDeltaDays,
            lineItemCount: input.lineItems.length,
          },
        },
      ]);

      return { changeOrderId: changeOrder.id, number: changeOrder.number, version };
    });
  }

  /**
   * Full-payload draft replacement under an optimistic lock. Report §6.3: "A
   * draft carries a server lockVersion; update conflicts show a comparison
   * instead of overwriting."
   */
  async updateDraft(
    ctx: RequestContext,
    changeOrderId: string,
    expectedLockVersion: number,
    input: UpdateDraftInput,
  ): Promise<VersionRow> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:update_draft', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const project = await this.app.repos.projects.requireById(ctx.tenant, changeOrder.projectId);
    const current = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!current) throw new AppError('CHANGE_ORDER_NOT_FOUND');

    const { entitlements } = await this.app.repos.organizations.resolveEntitlements(ctx.tenant);
    assertAssuranceSelectable(input.assuranceRequired, entitlements);

    const approver = await this.app.repos.customers.requireContact(
      ctx.tenant,
      input.approverContactId,
    );
    if (approver.customerId !== project.customerId) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'The approver must be a contact of this project’s customer.',
      });
    }

    const lines = toCalcInputs(input.lineItems);
    const priorApproved = await this.app.repos.changeOrders.priorApprovedDelta(
      this.app.uow.db,
      ctx.tenant,
      changeOrder.projectId,
      current.id,
    );
    const totals = validateDraft({
      projectCurrency: project.currency,
      currency: current.currency,
      projectStatus: project.status,
      baselineTotalMinor: project.baselineTotalMinor,
      priorApprovedDeltaMinor: priorApproved,
      lineItems: lines,
      scheduleDeltaDays: input.scheduleDeltaDays,
      type: input.type,
      assuranceRequired: input.assuranceRequired,
      attachmentScanStatuses: [],
    });

    return this.app.uow.transaction(async (tx) => {
      const updated = await this.app.repos.changeOrders.updateDraft(
        tx,
        ctx.tenant,
        current.id,
        expectedLockVersion,
        {
          type: input.type,
          title: input.title,
          scope: input.scope,
          reason: input.reason ?? null,
          scheduleDeltaDays: input.scheduleDeltaDays,
          revisedCompletionDate: this.projectedCompletion(project, input.scheduleDeltaDays),
          approverContactId: input.approverContactId,
          assuranceRequired: input.assuranceRequired,
          subtotalDeltaMinor: totals.subtotalDeltaMinor,
          taxDeltaMinor: totals.taxDeltaMinor,
          totalDeltaMinor: totals.totalDeltaMinor,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          lineItems: buildLineItemWrites(input.lineItems),
        },
      );

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrderId,
          projectId: changeOrder.projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_DRAFT_UPDATED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            versionNumber: updated.versionNumber,
            totalDeltaMinor: totals.totalDeltaMinor.toString(),
            lockVersion: updated.lockVersion,
          },
        },
      ]);

      return updated;
    });
  }

  /**
   * Server-calculated preview. Report §6.3: "The send button is unavailable
   * until the customer preview projection is successfully calculated by the
   * backend", and ADR-005 forbids the client supplying authoritative totals.
   */
  async preview(
    ctx: RequestContext,
    changeOrderId: string,
  ): Promise<{
    version: VersionRow;
    totals: {
      subtotalDeltaMinor: bigint;
      taxDeltaMinor: bigint;
      totalDeltaMinor: bigint;
      revisedContractTotalMinor: bigint;
      baselineTotalMinor: bigint;
      priorApprovedDeltaMinor: bigint;
      currency: string;
    };
    blockers: Blocker[];
    approverName: string;
    approverMaskedContact: string;
    organizationName: string;
    projectTitle: string;
    revisedCompletionDate: string | null;
    attachmentCount: number;
  }> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:read', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const [project, version, organization, subscription] = await Promise.all([
      this.app.repos.projects.requireById(ctx.tenant, changeOrder.projectId),
      this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId),
      this.app.repos.organizations.findById(ctx.tenant),
      this.app.repos.organizations.resolveEntitlements(ctx.tenant),
    ]);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    if (!organization) throw new AppError('ORGANIZATION_REQUIRED');

    const [lineItems, attachments, approver] = await Promise.all([
      this.app.repos.changeOrders.listLineItems(this.app.uow.db, version.id),
      this.app.repos.changeOrders.listAttachments(this.app.uow.db, version.id),
      this.app.repos.customers.requireContact(ctx.tenant, version.approverContactId),
    ]);

    const calcLines = lineItems.map((l) => ({
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      taxRateBps: l.taxRateBps,
      direction: l.direction,
    }));
    // Recomputed here rather than read back, so the preview cannot show a stale
    // or tampered stored total (report §8.1).
    const recomputed = calculateVersionTotals(calcLines);
    const priorApproved = await this.app.repos.changeOrders.priorApprovedDelta(
      this.app.uow.db,
      ctx.tenant,
      project.id,
      version.id,
    );

    const blockers = collectSendBlockers({
      lineItems: calcLines,
      scheduleDeltaDays: version.scheduleDeltaDays,
      attachmentScanStatuses: attachments.map((a) => a.scanStatus),
      approverHasContactChannel: Boolean(approver.phoneE164 || approver.emailNormalized),
      projectStatus: project.status,
      scopeLength: version.scopeDescription.length,
      readOnlySubscription: subscription.readOnly,
    });

    const revisedContractTotalMinor =
      project.baselineTotalMinor + priorApproved + recomputed.totalDeltaMinor;
    if (revisedContractTotalMinor < 0n) {
      blockers.push({
        code: 'NEGATIVE_REVISED_TOTAL',
        message: 'This change would make the revised contract total negative.',
      });
    }

    return {
      version,
      totals: {
        ...recomputed,
        revisedContractTotalMinor,
        baselineTotalMinor: project.baselineTotalMinor,
        priorApprovedDeltaMinor: priorApproved,
        currency: project.currency,
      },
      blockers,
      approverName: approver.name,
      approverMaskedContact: maskedContactLabel(approver.phoneE164, approver.emailNormalized),
      organizationName: organization.displayName,
      projectTitle: project.title,
      revisedCompletionDate: this.projectedCompletion(project, version.scheduleDeltaDays),
      attachmentCount: attachments.length,
    };
  }

  /** Report §4.3: REVISION_REQUESTED --create revision--> DRAFT (new version). */
  async createRevision(ctx: RequestContext, changeOrderId: string): Promise<VersionRow> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:create_revision', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const previous = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!previous) throw new AppError('CHANGE_ORDER_NOT_FOUND');

    if (previous.status === 'DRAFT') {
      // Already editable; a revision would create a pointless empty version.
      return previous;
    }
    if (!canCreateRevision(previous.status)) {
      throw new AppError('INVALID_STATE_TRANSITION', {
        message:
          previous.status === 'APPROVED'
            ? 'An approved change cannot be revised. Create a separate deduction or reversal instead.'
            : 'This version cannot be revised.',
        details: { currentStatus: previous.status },
      });
    }

    const lineItems = await this.app.repos.changeOrders.listLineItems(this.app.uow.db, previous.id);

    return this.app.uow.transaction(async (tx) => {
      const version = await this.app.repos.changeOrders.createRevision(tx, ctx.tenant, previous, {
        type: previous.type,
        title: previous.title,
        scope: previous.scopeDescription,
        reason: previous.reason,
        scheduleDeltaDays: previous.scheduleDeltaDays,
        revisedCompletionDate: previous.revisedCompletionDate,
        approverContactId: previous.approverContactId,
        assuranceRequired: previous.assuranceRequired,
        currency: previous.currency,
        subtotalDeltaMinor: previous.subtotalDeltaMinor,
        taxDeltaMinor: previous.taxDeltaMinor,
        totalDeltaMinor: previous.totalDeltaMinor,
        expiresAt: null,
        lineItems: lineItems.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          direction: l.direction,
          unitPriceMinor: l.unitPriceMinor,
          taxRateBps: l.taxRateBps,
          subtotalMinor: l.subtotalMinor,
          taxMinor: l.taxMinor,
          totalMinor: l.totalMinor,
        })),
        copyAttachmentsFromVersionId: previous.id,
      });

      await this.app.repos.reminders.cancelForVersion(tx, previous.id, 'SUPERSEDED');

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrderId,
          projectId: changeOrder.projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_SUPERSEDED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            supersededVersionNumber: previous.versionNumber,
            newVersionNumber: version.versionNumber,
          },
        },
      ]);

      return version;
    });
  }

  async cancel(ctx: RequestContext, changeOrderId: string, reason: string): Promise<void> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:cancel', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const version = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    if (version.status === 'APPROVED' || version.status === 'DECLINED') {
      throw new AppError('ALREADY_DECIDED', {
        message: 'A decided change cannot be cancelled. Create a reversal instead.',
      });
    }

    await this.app.uow.transaction(async (tx) => {
      const locked = await this.app.repos.changeOrders.lockVersion(tx, version.id);
      if (!locked) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      // Re-check under the lock: a decision may have landed in between.
      if (locked.status === 'APPROVED' || locked.status === 'DECLINED') {
        throw new AppError('ALREADY_DECIDED');
      }

      await this.app.repos.changeOrders.setStatus(
        tx,
        version.id,
        'CANCELLED',
        this.app.clock.now(),
      );
      await this.app.repos.approvals.revokeForVersion(tx, version.id, 'CANCELLED');
      await this.app.repos.reminders.cancelForVersion(tx, version.id, 'CANCELLED');

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrderId,
          projectId: changeOrder.projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_CANCELLED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { reason, versionNumber: version.versionNumber },
        },
      ]);
    });
  }

  async addAttachment(
    ctx: RequestContext,
    changeOrderId: string,
    fileObjectId: string,
    caption: string | null,
  ): Promise<void> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:update_draft', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const version = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    assertAttachmentRemovable(version.status);

    // Confirms the file belongs to this tenant before it is linked.
    await this.app.repos.files.requireById(ctx.tenant, fileObjectId);

    const existing = await this.app.repos.changeOrders.listAttachments(this.app.uow.db, version.id);
    if (existing.length >= this.app.env.MAX_ATTACHMENTS_PER_VERSION) {
      throw new AppError('VALIDATION_FAILED', {
        message: `A change request can carry at most ${this.app.env.MAX_ATTACHMENTS_PER_VERSION} attachments.`,
      });
    }

    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.changeOrders.addAttachment(
        tx,
        ctx.tenant,
        version.id,
        fileObjectId,
        caption,
      );
    });
  }

  async removeAttachment(
    ctx: RequestContext,
    changeOrderId: string,
    fileObjectId: string,
  ): Promise<void> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:update_draft', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const version = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    // Report §4.6: attachment removal after send is impossible.
    assertAttachmentRemovable(version.status);

    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.changeOrders.removeAttachment(tx, ctx.tenant, version.id, fileObjectId);
    });
  }

  /** Completion date implied by the schedule delta, if the project has one. */
  private projectedCompletion(
    project: { expectedCompletionDate: string | null },
    scheduleDeltaDays: number,
  ): string | null {
    if (!project.expectedCompletionDate) return null;
    return addDays(project.expectedCompletionDate, scheduleDeltaDays);
  }
}

export { versionEtag };

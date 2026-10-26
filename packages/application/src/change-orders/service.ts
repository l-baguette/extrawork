import {
  AppError,
  DOMAIN_EVENTS,
  type CreateChangeOrderInput,
  type LineItemInput,
  type ParseIntakeResponse,
  type ProposalInput,
  type RequestOrigin,
  type UpdateDraftInput,
} from '@extrawork/contracts';
import {
  allocateNumber,
  isAwaitingReview,
  type TransactionContext,
  type VersionRow,
} from '@extrawork/db';
import {
  addDays,
  assertAssuranceSelectable,
  authorize,
  calculateVersionTotals,
  collectSendBlockers,
  deriveChangeType,
  formatRequestNumber,
  isDesignerRole,
  matchProject,
  maskedContactLabel,
  parseIntakeMessage,
  projectAccessFilter,
  validateDraft,
  validateIntake,
  canCreateRevision,
  assertAttachmentRemovable,
  type Blocker,
} from '@extrawork/domain';
import type { AppContext, RequestContext } from '../context.js';
import { NotificationService } from '../notifications/service.js';
import { buildLineItemWrites, toCalcInputs, versionEtag } from './build-lines.js';

/**
 * Who raised a proposal and through which door (spec 2026-10-12, D4).
 * `submitted_by_user_id` is always the acting user (`ctx.actor.userId`), which
 * is null for the WhatsApp intake and homeowner-portal contexts — those name
 * the person through `raisedByEmployeeId` or `submittedByContactId` instead.
 */
export interface ProposalProvenance {
  origin: RequestOrigin;
  /** A site-team member (paste-to-draft, WhatsApp). Designer roles only. */
  raisedByEmployeeId?: string | null;
  /** A contact of the project's customer (the homeowner portal). */
  submittedByContactId?: string | null;
}

/** The part of a proposal's description that becomes its title. */
const PROPOSAL_TITLE_MAX = 80;

export interface CreateChangeOrderHooks {
  /** Runs in the same transaction as creation, for durable caller checkpoints. */
  afterCreate?(
    tx: TransactionContext,
    created: { changeOrderId: string; number: string; version: VersionRow },
  ): Promise<void>;
}

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
    hooks: CreateChangeOrderHooks = {},
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
      const number = await this.allocateRequestNumber(tx, ctx, project);

      const { changeOrder, version } = await this.app.repos.changeOrders.createWithDraft(
        tx,
        ctx.tenant,
        {
          projectId,
          number,
          type,
          title: input.title,
          scope: input.scope,
          reason: input.reason ?? null,
          room: input.room ?? null,
          workCategory: input.workCategory ?? null,
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
          actorType: ctx.actor.userId ? 'USER' : 'SYSTEM',
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

      const created = { changeOrderId: changeOrder.id, number: changeOrder.number, version };
      await hooks.afterCreate?.(tx, created);
      return created;
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
    const totals = validateDraft(
      {
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
      },
      // The designer completes a proposal over several autosaves; until it is
      // sent it may stay as incomplete as it arrived (spec D4). Send re-checks.
      { allowEmpty: isAwaitingReview(current) },
    );

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
          // Absent keeps what is there, so a client that predates these fields
          // cannot wipe the room a site engineer named; null clears it.
          room: input.room === undefined ? current.room : input.room,
          workCategory:
            input.workCategory === undefined ? current.workCategory : input.workCategory,
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
      this.app.repos.changeOrders.listLineItems(this.app.uow.db, ctx.tenant, version.id),
      this.app.repos.changeOrders.listAttachments(this.app.uow.db, ctx.tenant, version.id),
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

    return this.app.uow.transaction(async (tx) => {
      // Serialize revision creation with send, cancel, attachment changes and
      // public decisions. Every value copied into v(n+1) is loaded only after
      // the lock, so a terminal decision cannot be overwritten using the
      // optimistic `previous` object read above.
      const locked = await this.app.repos.changeOrders.lockVersionForTenant(
        tx,
        ctx.tenant,
        previous.id,
      );
      if (!locked) throw new AppError('CHANGE_ORDER_NOT_FOUND');

      if (locked.status === 'DRAFT') return locked;
      if (!canCreateRevision(locked.status)) {
        throw new AppError('INVALID_STATE_TRANSITION', {
          message:
            locked.status === 'APPROVED'
              ? 'An approved change cannot be revised. Create a separate deduction or reversal instead.'
              : 'This version cannot be revised.',
          details: { currentStatus: locked.status },
        });
      }

      const lineItems = await this.app.repos.changeOrders.listLineItems(
        tx.db,
        ctx.tenant,
        locked.id,
      );
      const version = await this.app.repos.changeOrders.createRevision(tx, ctx.tenant, locked, {
        type: locked.type,
        title: locked.title,
        scope: locked.scopeDescription,
        reason: locked.reason,
        room: locked.room,
        workCategory: locked.workCategory,
        scheduleDeltaDays: locked.scheduleDeltaDays,
        revisedCompletionDate: locked.revisedCompletionDate,
        approverContactId: locked.approverContactId,
        assuranceRequired: locked.assuranceRequired,
        currency: locked.currency,
        subtotalDeltaMinor: locked.subtotalDeltaMinor,
        taxDeltaMinor: locked.taxDeltaMinor,
        totalDeltaMinor: locked.totalDeltaMinor,
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
        copyAttachmentsFromVersionId: locked.id,
      });

      await this.app.repos.reminders.cancelForVersion(
        tx,
        ctx.tenant.organizationId,
        locked.id,
        'SUPERSEDED',
      );

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
            supersededVersionNumber: locked.versionNumber,
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
      const locked = await this.app.repos.changeOrders.lockVersion(tx, ctx.tenant, version.id);
      if (!locked) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      // Re-check under the lock: a decision may have landed in between.
      if (locked.status === 'APPROVED' || locked.status === 'DECLINED') {
        throw new AppError('ALREADY_DECIDED');
      }
      await this.cancelLocked(tx, ctx, changeOrder.projectId, locked, reason);
    });
  }

  /** The cancel itself, for a version already locked by the caller's transaction. */
  private async cancelLocked(
    tx: TransactionContext,
    ctx: RequestContext,
    projectId: string,
    version: VersionRow,
    reason: string,
  ): Promise<void> {
    await this.app.repos.changeOrders.setStatus(
      tx,
      ctx.tenant,
      version.id,
      'CANCELLED',
      this.app.clock.now(),
    );
    await this.app.repos.approvals.revokeForVersion(
      tx,
      ctx.tenant.organizationId,
      version.id,
      'CANCELLED',
    );
    await this.app.repos.reminders.cancelForVersion(
      tx,
      ctx.tenant.organizationId,
      version.id,
      'CANCELLED',
    );

    await this.app.repos.audit.append(tx, ctx.tenant, [
      {
        aggregateType: 'change_order',
        aggregateId: version.changeOrderId,
        projectId,
        eventType: DOMAIN_EVENTS.CHANGE_ORDER_CANCELLED,
        actorType: ctx.actor.userId ? 'USER' : 'SYSTEM',
        actorId: ctx.actor.userId,
        occurredAt: this.app.clock.now(),
        payload: { reason, versionNumber: version.versionNumber },
      },
    ]);
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

    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.changeOrders.addAttachment(
        tx,
        ctx.tenant,
        version.id,
        fileObjectId,
        caption,
        this.app.env.MAX_ATTACHMENTS_PER_VERSION,
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

  // --- Designer review (spec 2026-10-12, D4) ---------------------------------

  /**
   * Raises a request for the designer to review: a DRAFT with review
   * provenance, which may be as incomplete as the person on site left it.
   *
   * This is the one entry point for every door a request comes through — a
   * collaborator in the web app, the designer pasting a WhatsApp message, and
   * (slice D) WhatsApp intake and the homeowner portal. The last two have no
   * user behind them: call it with an intake-style context (see
   * `IntakeService.intakeContext`: `userId: null`, a designer role, and a grant
   * on exactly the one project) and name the person through `provenance`
   * (`raisedByEmployeeId` for a site-team number, `submittedByContactId` for
   * the homeowner). The audit then records a SYSTEM actor, never a user who
   * did not act.
   */
  async createProposal(
    ctx: RequestContext,
    projectId: string,
    input: ProposalInput,
    provenance: ProposalProvenance,
    hooks: CreateChangeOrderHooks = {},
  ): Promise<{ changeOrderId: string; number: string; version: VersionRow }> {
    const project = await this.app.repos.projects.requireById(ctx.tenant, projectId);
    authorize(ctx.actor, 'change_order:propose', {
      organizationId: project.organizationId,
      projectId: project.id,
    });

    const raisedByEmployeeId = provenance.raisedByEmployeeId ?? null;
    if (raisedByEmployeeId) {
      // Attributing a request to someone else is the designer's call: a
      // collaborator naming a site worker would put words in their mouth.
      if (!isDesignerRole(ctx.actor.role)) {
        throw new AppError('FORBIDDEN', {
          message: 'Only the design team can record a request on behalf of a site-team member.',
        });
      }
      const allowed = await this.app.repos.employees.canRaiseFor(
        ctx.tenant,
        raisedByEmployeeId,
        project.id,
      );
      if (!allowed) {
        throw new AppError('VALIDATION_FAILED', {
          message: 'That site-team member is not on this project.',
          details: { field: 'raisedByEmployeeId' },
        });
      }
    }

    const submittedByContactId = provenance.submittedByContactId ?? null;
    if (submittedByContactId) {
      const contact = await this.app.repos.customers.requireContact(
        ctx.tenant,
        submittedByContactId,
      );
      if (contact.customerId !== project.customerId) {
        throw new AppError('VALIDATION_FAILED', {
          message: 'The person raising this must be a contact of this project’s customer.',
        });
      }
    }

    if (!project.defaultApproverContactId) {
      throw new AppError('VALIDATION_FAILED', {
        message:
          'This project has no homeowner approver recorded yet. Add one on the project before raising requests.',
        details: { field: 'defaultApproverContactId' },
      });
    }

    const description = input.description.trim();
    const title = (input.title?.trim() || firstLine(description)).slice(0, PROPOSAL_TITLE_MAX);
    // A figure from site becomes one all-in line the designer can rework; no
    // tax is added, because the submitter quoted what it costs, not a rate.
    const lineItems: LineItemInput[] =
      input.amountMinor && input.amountMinor > 0
        ? [
            {
              description: title,
              quantity: '1',
              unit: 'lot',
              unitPriceMinor: input.amountMinor,
              taxRateBps: 0,
              direction: 1,
            },
          ]
        : [];
    const scheduleDeltaDays = input.scheduleDeltaDays ?? 0;
    const lines = toCalcInputs(lineItems);
    const type = deriveChangeType(lines, scheduleDeltaDays);

    const priorApproved = await this.app.repos.changeOrders.priorApprovedDelta(
      this.app.uow.db,
      ctx.tenant,
      projectId,
    );
    const totals = validateDraft(
      {
        projectCurrency: project.currency,
        currency: project.currency,
        projectStatus: project.status,
        baselineTotalMinor: project.baselineTotalMinor,
        priorApprovedDeltaMinor: priorApproved,
        lineItems: lines,
        scheduleDeltaDays,
        type,
        assuranceRequired: 'A0',
        attachmentScanStatuses: [],
      },
      { allowEmpty: true },
    );

    for (const fileId of input.attachmentIds) {
      const file = await this.app.repos.files.requireById(ctx.tenant, fileId);
      // A file uploaded against another project stays there.
      if (file.projectId && file.projectId !== project.id) {
        throw new AppError('ATTACHMENT_NOT_FOUND');
      }
    }

    const now = this.app.clock.now();
    const approverContactId = project.defaultApproverContactId;

    return this.app.uow.transaction(async (tx) => {
      const number = await this.allocateRequestNumber(tx, ctx, project);
      const { changeOrder, version } = await this.app.repos.changeOrders.createWithDraft(
        tx,
        ctx.tenant,
        {
          projectId,
          number,
          type,
          title,
          scope: description,
          reason: input.reason ?? null,
          room: input.room ?? null,
          workCategory: input.workCategory ?? null,
          scheduleDeltaDays,
          revisedCompletionDate: this.projectedCompletion(project, scheduleDeltaDays),
          approverContactId,
          assuranceRequired: 'A0',
          currency: project.currency,
          subtotalDeltaMinor: totals.subtotalDeltaMinor,
          taxDeltaMinor: totals.taxDeltaMinor,
          totalDeltaMinor: totals.totalDeltaMinor,
          expiresAt: null,
          lineItems: buildLineItemWrites(lineItems),
          proposal: {
            origin: provenance.origin,
            raisedByEmployeeId,
            submittedByUserId: ctx.actor.userId,
            submittedByContactId,
            submissionNote: input.note ?? null,
            submittedAt: now,
          },
        },
      );

      for (const fileId of input.attachmentIds) {
        await this.app.repos.changeOrders.addAttachment(
          tx,
          ctx.tenant,
          version.id,
          fileId,
          null,
          this.app.env.MAX_ATTACHMENTS_PER_VERSION,
        );
      }

      const actorType = ctx.actor.userId ? 'USER' : 'SYSTEM';
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrder.id,
          projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_CREATED,
          actorType,
          actorId: ctx.actor.userId,
          occurredAt: now,
          payload: {
            number: changeOrder.number,
            type,
            title,
            totalDeltaMinor: totals.totalDeltaMinor.toString(),
            scheduleDeltaDays,
            lineItemCount: lineItems.length,
          },
        },
        {
          aggregateType: 'change_order',
          aggregateId: changeOrder.id,
          projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_SUBMITTED_FOR_REVIEW,
          actorType,
          actorId: ctx.actor.userId,
          occurredAt: now,
          payload: {
            versionNumber: version.versionNumber,
            origin: provenance.origin,
            raisedByEmployeeId,
            submittedByContactId,
            attachmentCount: input.attachmentIds.length,
          },
        },
      ]);

      const submitter = await this.app.repos.changeOrders.findSubmitterLabel(
        tx.db,
        ctx.tenant,
        version.id,
      );
      await new NotificationService(this.app).notifyProject(tx, ctx.tenant, {
        projectId,
        audience: 'DESIGNERS',
        excludeUserIds: [ctx.actor.userId],
        kind: 'REQUEST_SUBMITTED',
        title: `New request to review: ${changeOrder.number}`,
        body: `${title} · ${project.title}`,
        linkPath: `/app/changes/${changeOrder.id}`,
        actorLabel: submitter,
        dedupeKey: `request-submitted:${version.id}`,
      });

      const created = { changeOrderId: changeOrder.id, number: changeOrder.number, version };
      await hooks.afterCreate?.(tx, created);
      return created;
    });
  }

  /**
   * The designer declines a proposal without sending it to the homeowner. It is
   * cancelled through the ordinary cancel path, so the record keeps it, and the
   * person who raised it is told why.
   */
  async dismissProposal(ctx: RequestContext, changeOrderId: string, reason: string): Promise<void> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:cancel', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });
    const current = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!current) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    if (!isAwaitingReview(current)) throw new AppError('NOT_AWAITING_REVIEW');

    await this.app.uow.transaction(async (tx) => {
      const locked = await this.app.repos.changeOrders.lockVersion(tx, ctx.tenant, current.id);
      if (!locked) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      // Re-checked under the lock: another designer may have sent it meanwhile.
      if (!isAwaitingReview(locked)) throw new AppError('NOT_AWAITING_REVIEW');

      const now = this.app.clock.now();
      await this.app.repos.changeOrders.markReviewed(tx, ctx.tenant, locked.id, {
        reviewedByUserId: ctx.actor.userId,
        at: now,
      });
      await this.cancelLocked(tx, ctx, changeOrder.projectId, locked, reason);
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrderId,
          projectId: changeOrder.projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_PROPOSAL_DISMISSED,
          actorType: ctx.actor.userId ? 'USER' : 'SYSTEM',
          actorId: ctx.actor.userId,
          occurredAt: now,
          payload: { reason, versionNumber: locked.versionNumber },
        },
      ]);

      if (locked.submittedByUserId && locked.submittedByUserId !== ctx.actor.userId) {
        await new NotificationService(this.app).notifyUsers(
          tx,
          ctx.tenant,
          [locked.submittedByUserId],
          {
            kind: 'REQUEST_DISMISSED',
            title: `Request not taken forward: ${changeOrder.number}`,
            body: reason,
            linkPath: `/app/changes/${changeOrderId}`,
            projectId: changeOrder.projectId,
            dedupeKey: `request-dismissed:${locked.id}`,
          },
        );
      }
    });
  }

  // --- Invoiced mark (Tier 1 B) ---------------------------------------------

  /**
   * Records that an approved change has been billed, with the firm's own
   * invoice number when given. Bookkeeping about the record, never a term of
   * it: the snapshot and its digest are untouched (migration 0021).
   */
  async markInvoiced(
    ctx: RequestContext,
    changeOrderId: string,
    invoiceReference: string | null,
  ): Promise<VersionRow> {
    const { changeOrder, version } = await this.approvedForInvoicing(ctx, changeOrderId);
    return this.app.uow.transaction(async (tx) => {
      const locked = await this.app.repos.changeOrders.lockVersionForTenant(
        tx,
        ctx.tenant,
        version.id,
      );
      if (!locked) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      const now = this.app.clock.now();
      const updated = await this.app.repos.changeOrders.setInvoiced(tx, ctx.tenant, locked.id, {
        invoicedByUserId: ctx.actor.userId,
        invoiceReference,
        at: now,
      });
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrderId,
          projectId: changeOrder.projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_INVOICED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: now,
          payload: {
            versionNumber: locked.versionNumber,
            invoiceReference,
            totalDeltaMinor: locked.totalDeltaMinor.toString(),
            previouslyInvoicedAt: locked.invoicedAt?.toISOString() ?? null,
          },
        },
      ]);
      return updated;
    });
  }

  /** Removes the invoiced mark — a mistake, or a cancelled invoice. */
  async clearInvoiced(ctx: RequestContext, changeOrderId: string): Promise<VersionRow> {
    const { changeOrder, version } = await this.approvedForInvoicing(ctx, changeOrderId);
    return this.app.uow.transaction(async (tx) => {
      const locked = await this.app.repos.changeOrders.lockVersionForTenant(
        tx,
        ctx.tenant,
        version.id,
      );
      if (!locked) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      // Clearing nothing is not an event worth an entry in the chain.
      if (!locked.invoicedAt) return locked;
      const updated = await this.app.repos.changeOrders.clearInvoiced(tx, ctx.tenant, locked.id);
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrderId,
          projectId: changeOrder.projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_INVOICE_CLEARED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: {
            versionNumber: locked.versionNumber,
            clearedInvoiceReference: locked.invoiceReference,
            invoicedAt: locked.invoicedAt.toISOString(),
          },
        },
      ]);
      return updated;
    });
  }

  private async approvedForInvoicing(ctx: RequestContext, changeOrderId: string) {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:invoice', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });
    const version = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    if (version.status !== 'APPROVED') {
      throw new AppError('INVALID_STATE_TRANSITION', {
        message: 'Only an approved change can carry an invoiced mark.',
        details: { currentStatus: version.status },
      });
    }
    return { changeOrder, version };
  }

  // --- Paste-to-draft (Tier 1 C) --------------------------------------------

  /**
   * Reads a pasted WhatsApp message and says what it found. Creates nothing:
   * the designer sees the reading, fixes what is missing, and only then raises
   * the proposal. The project is matched only among projects the actor can
   * see, so the answer can never name a project they have no access to.
   */
  async parsePastedMessage(
    ctx: RequestContext,
    text: string,
    projectId?: string,
  ): Promise<ParseIntakeResponse> {
    authorize(ctx.actor, 'change_order:propose', { organizationId: ctx.actor.organizationId });
    const parsed = parseIntakeMessage(text);

    let project: { id: string; title: string; projectNumber: string } | null = null;
    if (projectId) {
      const chosen = await this.app.repos.projects.requireById(ctx.tenant, projectId);
      authorize(ctx.actor, 'change_order:propose', {
        organizationId: chosen.organizationId,
        projectId: chosen.id,
      });
      project = { id: chosen.id, title: chosen.title, projectNumber: chosen.projectNumber };
    } else {
      const page = await this.app.repos.projects.list(ctx.tenant, {
        status: 'ACTIVE',
        limit: 100,
        projectGrants: projectAccessFilter(ctx.actor),
      });
      const outcome = matchProject(
        parsed.project,
        page.items.map((p) => ({
          id: p.id,
          projectNumber: p.projectNumber,
          title: p.title,
          customerName: p.customerName,
        })),
      );
      if (outcome.kind === 'MATCHED' || outcome.kind === 'ASSUMED') {
        project = {
          id: outcome.project.id,
          title: outcome.project.title,
          projectNumber: outcome.project.projectNumber,
        };
      }
    }

    const validation = validateIntake(parsed, {
      projectResolved: project !== null,
      requiresProject: true,
    });
    return {
      description: parsed.description,
      reason: parsed.reason,
      amountMinor: parsed.amountMinor === null ? null : Number(parsed.amountMinor),
      days: parsed.days,
      room: parsed.room,
      workCategory: parsed.workCategory,
      missing: validation.missing,
      problems: validation.problems,
      project,
    };
  }

  /**
   * Spec D8: `P-0004-R03`. The per-project sequence is the one the legacy
   * `EW-` numbers came from, so numbering simply continues in the new form.
   */
  private async allocateRequestNumber(
    tx: TransactionContext,
    ctx: RequestContext,
    project: { id: string; projectNumber: string },
  ): Promise<string> {
    const allocated = await allocateNumber(tx, ctx.tenant, 'CHANGE_ORDER', project.id);
    return formatRequestNumber(project.projectNumber, allocated.allocated);
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

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim();
}

export { versionEtag };

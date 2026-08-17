import {
  AppError,
  DOMAIN_EVENTS,
  JOB_KINDS,
  OUTBOX_TOPICS,
  TERMS_VERSION,
  type SendChangeOrderInput,
} from '@extrawork/contracts';
import { enqueueJob, publishOutbox } from '@extrawork/db';
import {
  assertQuota,
  assertTransition,
  authorize,
  buildMailtoUrl,
  buildReminderMessage,
  buildRequestMessage,
  buildSmsUrl,
  buildWhatsAppShareUrl,
  buildReminderSchedule,
  calculateRevisedContractTotal,
  calculateVersionTotals,
  collectSendBlockers,
  freezeSnapshot,
  generateApprovalToken,
  maskEmail,
  maskPhone,
  maskedContactLabel,
  requestEmailSubject,
  resolveExpiry,
  DEFAULT_REMINDER_POLICY,
} from '@extrawork/domain';
import type { AppContext, RequestContext } from '../context.js';

/**
 * Send — report §4.2, §4.4, §8.3, §10.3.
 *
 * One transaction freezes the canonical snapshot, allocates the token, latches
 * the project's baseline lock, writes audit and outbox events, and commits.
 * The provider (or the share sheet) is only touched after the commit, per
 * report §7.6 and §14.4.
 *
 * The plaintext token is returned to the caller exactly once and is never
 * logged or persisted (report §3.4).
 */

export interface SendResult {
  changeOrderId: string;
  versionId: string;
  versionNumber: number;
  approvalUrl: string;
  expiresAt: Date;
  canonicalSha256: string;
  messageText: string;
  whatsappUrl: string | null;
  smsUrl: string | null;
  mailtoUrl: string | null;
}

export class SendService {
  constructor(private readonly app: AppContext) {}

  async send(
    ctx: RequestContext,
    changeOrderId: string,
    input: SendChangeOrderInput,
  ): Promise<SendResult> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:send', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const [organization, entitlementState] = await Promise.all([
      this.app.repos.organizations.findById(ctx.tenant),
      this.app.repos.organizations.resolveEntitlements(ctx.tenant),
    ]);
    if (!organization) throw new AppError('ORGANIZATION_REQUIRED');

    // Report §8.7: a lapsed subscription stops new sends but never hides data.
    if (entitlementState.readOnly) {
      throw new AppError('SUBSCRIPTION_READ_ONLY');
    }
    // Report §13.1 puts the customer decision above everything, so the plan
    // limit is checked here at send rather than at decision time.
    assertQuota(
      entitlementState.entitlements,
      entitlementState.usage,
      'completedDecisionsPerPeriod',
    );

    const version = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    // Throws the right code if this version is not sendable.
    assertTransition(version.status, 'SEND');

    const project = await this.app.repos.projects.requireById(ctx.tenant, changeOrder.projectId);
    const [lineItems, attachments, approver, customer] = await Promise.all([
      this.app.repos.changeOrders.listLineItems(this.app.uow.db, version.id),
      this.app.repos.changeOrders.listAttachments(this.app.uow.db, version.id),
      this.app.repos.customers.requireContact(ctx.tenant, version.approverContactId),
      this.app.repos.customers.requireById(ctx.tenant, project.customerId),
    ]);

    const calcLines = lineItems.map((l) => ({
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      taxRateBps: l.taxRateBps,
      direction: l.direction,
    }));

    const blockers = collectSendBlockers({
      lineItems: calcLines,
      scheduleDeltaDays: version.scheduleDeltaDays,
      attachmentScanStatuses: attachments.map((a) => a.scanStatus),
      approverHasContactChannel: Boolean(approver.phoneE164 || approver.emailNormalized),
      projectStatus: project.status,
      scopeLength: version.scopeDescription.length,
      readOnlySubscription: entitlementState.readOnly,
    });
    if (blockers.length > 0) {
      throw new AppError('VALIDATION_FAILED', {
        message: blockers[0]?.message ?? 'This change request is not ready to send.',
        details: { blockers },
      });
    }

    // Recomputed at send time so the frozen snapshot can never inherit a stale
    // stored total (report §8.1).
    const totals = calculateVersionTotals(calcLines);
    const priorApproved = await this.app.repos.changeOrders.priorApprovedDelta(
      this.app.uow.db,
      ctx.tenant,
      project.id,
      version.id,
    );
    const revisedContractTotalMinor = calculateRevisedContractTotal({
      baselineTotalMinor: project.baselineTotalMinor,
      priorApprovedDeltaMinor: priorApproved,
      currentVersionDeltaMinor: totals.totalDeltaMinor,
    });

    const now = this.app.clock.now();
    const expiresAt = resolveExpiry(
      input.expiresAt ? new Date(input.expiresAt) : version.expiresAt,
      now,
      this.app.env.APPROVAL_TOKEN_MAX_LIFETIME_DAYS,
      this.app.env.DEFAULT_REQUEST_EXPIRY_DAYS,
    );

    const frozen = freezeSnapshot({
      organization: {
        displayName: organization.displayName,
        legalName: organization.legalName,
        gstin: organization.gstin,
      },
      project: {
        id: project.id,
        number: project.projectNumber,
        title: project.title,
        baselineTotalMinor: project.baselineTotalMinor,
        currency: project.currency,
        timezone: project.timezone,
      },
      change: {
        id: changeOrder.id,
        number: changeOrder.number,
        version: version.versionNumber,
        type: version.type,
      },
      scope: {
        title: version.title,
        description: version.scopeDescription,
        reason: version.reason,
      },
      commercial: {
        currency: version.currency,
        lines: lineItems.map((l) => ({
          position: l.position,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPriceMinor: l.unitPriceMinor,
          taxRateBps: l.taxRateBps,
          direction: l.direction,
          subtotalMinor: l.subtotalMinor,
          taxMinor: l.taxMinor,
          totalMinor: l.totalMinor,
        })),
        subtotalDeltaMinor: totals.subtotalDeltaMinor,
        taxDeltaMinor: totals.taxDeltaMinor,
        totalDeltaMinor: totals.totalDeltaMinor,
        priorApprovedDeltaMinor: priorApproved,
        revisedContractTotalMinor,
      },
      schedule: {
        deltaDays: version.scheduleDeltaDays,
        revisedCompletionDate: version.revisedCompletionDate,
      },
      approver: {
        contactId: approver.id,
        name: approver.name,
        maskedPhone: maskPhone(approver.phoneE164),
        maskedEmail: maskEmail(approver.emailNormalized),
        authorityNote: approver.authorityNote,
      },
      attachments: attachments.map((a) => ({
        id: a.fileObjectId,
        sha256: a.sha256?.toString('hex') ?? '',
        mimeType: a.mimeType,
        filename: a.filename,
        byteSize: Number(a.byteSize),
        caption: a.caption,
      })),
      assuranceRequired: version.assuranceRequired,
      expiresAt: expiresAt.toISOString(),
      sentAt: now.toISOString(),
    });

    // Generated outside the transaction so the plaintext never sits in a
    // transaction-scoped structure longer than necessary.
    const token = generateApprovalToken();
    const approvalUrl = `${this.app.env.WEB_PUBLIC_URL.replace(/\/+$/, '')}/r/${token.plaintext}`;

    const messageText = buildRequestMessage({
      organizationName: organization.displayName,
      customerFirstName: firstName(approver.name || customer.displayName),
      projectTitle: project.title,
      changeNumber: changeOrder.number,
      totalDeltaMinor: totals.totalDeltaMinor,
      currency: version.currency,
      scheduleDeltaDays: version.scheduleDeltaDays,
      approvalUrl,
      expiresAt,
      timezone: project.timezone,
      note: input.messageNote ?? null,
    });

    await this.app.uow.transaction(async (tx) => {
      const frozenVersion = await this.app.repos.changeOrders.freezeAndSend(
        tx,
        ctx.tenant,
        version.id,
        {
          snapshot: frozen.snapshot,
          canonicalSha256: frozen.sha256,
          canonicalizerVersion: frozen.canonicalizerVersion,
          termsVersion: frozen.termsVersion,
          baselineTotalMinor: project.baselineTotalMinor,
          priorApprovedDeltaMinor: priorApproved,
          revisedContractTotalMinor,
          revisedCompletionDate: version.revisedCompletionDate,
          sentAt: now,
          expiresAt,
        },
      );

      await this.app.repos.approvals.issueToken(tx, ctx.tenant, {
        versionId: frozenVersion.id,
        approverContactId: approver.id,
        assuranceRequired: version.assuranceRequired,
        expiresAt,
        tokenHash: token.hash,
      });

      // Latches the baseline lock (report §4.1).
      await this.app.repos.projects.markHasSentChange(tx, ctx.tenant, project.id);

      // `WHATSAPP` is a request to deliver, not a channel a message can sit on.
      // The row records the gateway that will actually carry it, so the message
      // log answers "did this reach the customer, and through what?" honestly.
      const recordedChannel =
        input.channel === 'WHATSAPP' ? this.app.integrations.whatsapp.channel : input.channel;
      const systemDelivers = input.channel === 'EMAIL' || input.channel === 'WHATSAPP';

      await this.app.repos.messages.record(tx, ctx.tenant, {
        versionId: frozenVersion.id,
        contactId: approver.id,
        channel: recordedChannel,
        purpose: 'REQUEST',
        // Report §10.3: record the intent, never a delivery claim. PENDING for
        // the channels the worker will attempt; the share channels are the
        // contractor's own action and are only ever an opened intent.
        status: systemDelivers ? 'PENDING' : 'SHARE_INTENT_OPENED',
        dedupeKey: `request:${frozenVersion.id}:${input.channel}`,
      });

      const reminderChannel = input.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP_NATIVE_SHARE';
      await this.app.repos.reminders.schedule(
        tx,
        ctx.tenant.organizationId,
        frozenVersion.id,
        reminderChannel,
        buildReminderSchedule(frozenVersion.id, now, expiresAt, reminderChannel, {
          ...DEFAULT_REMINDER_POLICY,
          stepsHoursAfterSend: organization.reminderPolicyHours,
        }),
      );

      await this.app.repos.organizations.incrementUsage(
        tx,
        ctx.tenant,
        entitlementState.subscription.currentPeriodStart,
        'sends',
      );

      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrder.id,
          projectId: project.id,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_VERSION_FROZEN,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: now,
          payload: {
            versionNumber: frozenVersion.versionNumber,
            canonicalSha256: frozen.sha256Hex,
            canonicalizerVersion: frozen.canonicalizerVersion,
            termsVersion: TERMS_VERSION,
            totalDeltaMinor: totals.totalDeltaMinor.toString(),
            revisedContractTotalMinor: revisedContractTotalMinor.toString(),
          },
        },
        {
          aggregateType: 'change_order',
          aggregateId: changeOrder.id,
          projectId: project.id,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_SENT,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: now,
          payload: {
            versionNumber: frozenVersion.versionNumber,
            channel: input.channel,
            approverContactId: approver.id,
            expiresAt: expiresAt.toISOString(),
            assuranceRequired: version.assuranceRequired,
          },
        },
      ]);

      // Committed with the domain change; the worker acts on it afterwards
      // (report §13.2). The payload carries no token.
      await publishOutbox(tx, {
        topic: OUTBOX_TOPICS.CHANGE_ORDER_SENT,
        aggregateId: changeOrder.id,
        organizationId: ctx.tenant.organizationId,
        payload: {
          versionId: frozenVersion.id,
          channel: input.channel,
          contactId: approver.id,
        },
      });

      if (input.channel === 'EMAIL' || input.channel === 'WHATSAPP') {
        // Only the channels the system delivers on ask the worker to send.
        // Native share is the contractor's own action, and COPY_LINK is theirs
        // to paste, so neither enqueues anything.
        await enqueueJob(tx, {
          kind: JOB_KINDS.SEND_REQUEST_MESSAGE,
          organizationId: ctx.tenant.organizationId,
          dedupeKey: `send-request:${frozenVersion.id}:${input.channel}`,
          payload: {
            versionId: frozenVersion.id,
            contactId: approver.id,
            channel: input.channel,
            // The plaintext token exists only here (report §3.4 stores only its
            // hash), so the worker cannot rebuild the link and it has to travel
            // in the payload. That payload lives in `job_queue` in the same
            // database as the hash, never in log output.
            approvalUrl,
          },
        });
      }
    });

    return {
      changeOrderId: changeOrder.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      approvalUrl,
      expiresAt,
      canonicalSha256: frozen.sha256Hex,
      messageText,
      whatsappUrl: buildWhatsAppShareUrl(approver.phoneE164, messageText),
      smsUrl: buildSmsUrl(approver.phoneE164, messageText),
      mailtoUrl: buildMailtoUrl(
        approver.emailNormalized,
        requestEmailSubject(changeOrder.number, project.title),
        messageText,
      ),
    };
  }

  /**
   * Records that the contractor actually opened the share sheet. Report §10.3:
   * store SHARE_INTENT_OPENED, not MESSAGE_SENT.
   */
  async recordShareIntent(
    ctx: RequestContext,
    changeOrderId: string,
    channel: string,
  ): Promise<void> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:send', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const version = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');

    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.audit.append(tx, ctx.tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: changeOrderId,
          projectId: changeOrder.projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_SHARE_INTENT_OPENED,
          actorType: 'USER',
          actorId: ctx.actor.userId,
          occurredAt: this.app.clock.now(),
          payload: { channel, versionNumber: version.versionNumber },
        },
      ]);
    });
  }

  /**
   * Contractor-triggered reminder. Shares the cooldown rules with the automated
   * schedule (report §8.6) and, in the native-share MVP, produces a prefilled
   * message rather than claiming delivery.
   */
  async remind(
    ctx: RequestContext,
    changeOrderId: string,
    channel: 'WHATSAPP_NATIVE_SHARE' | 'EMAIL',
  ): Promise<{
    messageText: string;
    whatsappUrl: string | null;
    mailtoUrl: string | null;
    cooldownUntil: Date | null;
  }> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:remind', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const version = await this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    if (version.status !== 'SENT' && version.status !== 'VIEWED') {
      throw new AppError('INVALID_STATE_TRANSITION', {
        message: 'Only a request that is awaiting a decision can be reminded.',
        details: { currentStatus: version.status },
      });
    }

    const lastReminder = await this.app.repos.messages.lastReminderAt(ctx.tenant, version.id);
    const now = this.app.clock.now();
    if (lastReminder) {
      const nextAllowed = new Date(
        lastReminder.getTime() + DEFAULT_REMINDER_POLICY.cooldownHours * 3_600_000,
      );
      if (nextAllowed > now) {
        throw new AppError('RATE_LIMITED', {
          message: 'A reminder was sent recently. Please wait before sending another.',
          details: { retryAt: nextAllowed.toISOString() },
        });
      }
    }

    const [organization, project, approver] = await Promise.all([
      this.app.repos.organizations.findById(ctx.tenant),
      this.app.repos.projects.requireById(ctx.tenant, changeOrder.projectId),
      this.app.repos.customers.requireContact(ctx.tenant, version.approverContactId),
    ]);
    if (!organization) throw new AppError('ORGANIZATION_REQUIRED');

    // A reminder cannot resurrect the plaintext token: it was never stored.
    // The customer already holds the link, so the reminder points at the
    // original message rather than minting a new one.
    const messageText = buildReminderMessage({
      organizationName: organization.displayName,
      customerFirstName: firstName(approver.name),
      projectTitle: project.title,
      changeNumber: changeOrder.number,
      totalDeltaMinor: version.totalDeltaMinor,
      currency: version.currency,
      scheduleDeltaDays: version.scheduleDeltaDays,
      approvalUrl: '(use the link from the original message)',
      expiresAt: version.expiresAt ?? now,
      timezone: project.timezone,
    });

    await this.app.uow.transaction(async (tx) => {
      await this.app.repos.messages.record(tx, ctx.tenant, {
        versionId: version.id,
        contactId: approver.id,
        channel,
        purpose: 'REMINDER',
        status: channel === 'EMAIL' ? 'PENDING' : 'SHARE_INTENT_OPENED',
      });
    });

    return {
      messageText,
      whatsappUrl: buildWhatsAppShareUrl(approver.phoneE164, messageText),
      mailtoUrl: buildMailtoUrl(
        approver.emailNormalized,
        `Reminder: ${changeOrder.number} on ${project.title}`,
        messageText,
      ),
      cooldownUntil: new Date(now.getTime() + DEFAULT_REMINDER_POLICY.cooldownHours * 3_600_000),
    };
  }
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export { maskedContactLabel };

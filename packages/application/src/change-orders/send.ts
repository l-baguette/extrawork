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
  encryptApprovalUrl,
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
    const initialChangeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      ctx.tenant,
      changeOrderId,
    );
    authorize(ctx.actor, 'change_order:send', {
      organizationId: initialChangeOrder.organizationId,
      projectId: initialChangeOrder.projectId,
    });

    // Cheap preflight checks keep ordinary validation failures fast. Every
    // mutable value used below is reloaded again under database locks before
    // the canonical snapshot is built.
    const [candidateVersion, preflightEntitlements] = await Promise.all([
      this.app.repos.changeOrders.getCurrentVersion(ctx.tenant, changeOrderId),
      this.app.repos.organizations.resolveEntitlements(ctx.tenant),
    ]);
    if (!candidateVersion) throw new AppError('CHANGE_ORDER_NOT_FOUND');
    assertTransition(candidateVersion.status, 'SEND');
    if (preflightEntitlements.readOnly) {
      throw new AppError('SUBSCRIPTION_READ_ONLY');
    }
    assertQuota(
      preflightEntitlements.entitlements,
      preflightEntitlements.usage,
      'completedDecisionsPerPeriod',
    );

    const token = generateApprovalToken();
    const approvalUrl = `${this.app.env.WEB_PUBLIC_URL.replace(/\/+$/, '')}/r/${token.plaintext}`;

    const sent = await this.app.uow.transaction(async (tx) => {
      // The version is the command's serialization point. Draft edits and
      // attachment changes acquire this same lock before mutating child rows.
      const version = await this.app.repos.changeOrders.lockVersionForTenant(
        tx,
        ctx.tenant,
        candidateVersion.id,
      );
      if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      assertTransition(version.status, 'SEND');

      const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
        tx.db,
        ctx.tenant,
        changeOrderId,
      );
      if (changeOrder.currentVersionId !== version.id) {
        throw new AppError('INVALID_STATE_TRANSITION', {
          message: 'A newer version of this change request is now current.',
        });
      }
      authorize(ctx.actor, 'change_order:send', {
        organizationId: changeOrder.organizationId,
        projectId: changeOrder.projectId,
      });

      // Match the decision path's version -> project lock order. The remaining
      // legal-document inputs are then locked in stable table order.
      const project = await this.app.repos.projects.lockById(tx, ctx.tenant, version.projectId);
      const organization = await this.app.repos.organizations.lockById(tx, ctx.tenant);
      const customer = await this.app.repos.customers.lockById(tx, ctx.tenant, project.customerId);
      const approver = await this.app.repos.customers.lockContact(
        tx,
        ctx.tenant,
        version.approverContactId,
      );
      const lineItems = await this.app.repos.changeOrders.listLineItems(
        tx.db,
        ctx.tenant,
        version.id,
      );
      const attachments = await this.app.repos.changeOrders.lockAttachments(
        tx,
        ctx.tenant,
        version.id,
      );
      const entitlementState = await this.app.repos.organizations.resolveEntitlements(
        ctx.tenant,
        tx.db,
      );

      // Report §8.7: a lapsed subscription stops new sends but never hides data.
      if (entitlementState.readOnly) throw new AppError('SUBSCRIPTION_READ_ONLY');
      assertQuota(
        entitlementState.entitlements,
        entitlementState.usage,
        'completedDecisionsPerPeriod',
      );

      const calcLines = lineItems.map((line) => ({
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        taxRateBps: line.taxRateBps,
        direction: line.direction,
      }));
      const blockers = collectSendBlockers({
        lineItems: calcLines,
        scheduleDeltaDays: version.scheduleDeltaDays,
        attachmentScanStatuses: attachments.map((attachment) => attachment.scanStatus),
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

      // Recomputed from the row-locked draft so the snapshot cannot inherit a
      // stale stored total or a mix of two concurrent edits.
      const totals = calculateVersionTotals(calcLines);
      const priorApproved = await this.app.repos.changeOrders.priorApprovedDelta(
        tx.db,
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
          lines: lineItems.map((line) => ({
            position: line.position,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unitPriceMinor: line.unitPriceMinor,
            taxRateBps: line.taxRateBps,
            direction: line.direction,
            subtotalMinor: line.subtotalMinor,
            taxMinor: line.taxMinor,
            totalMinor: line.totalMinor,
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
        attachments: attachments.map((attachment) => ({
          id: attachment.fileObjectId,
          sha256: attachment.sha256?.toString('hex') ?? '',
          mimeType: attachment.mimeType,
          filename: attachment.filename,
          byteSize: Number(attachment.byteSize),
          caption: attachment.caption,
        })),
        assuranceRequired: version.assuranceRequired,
        expiresAt: expiresAt.toISOString(),
        sentAt: now.toISOString(),
      });
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

      if (systemDelivers) {
        const reminderChannel = input.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';
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
      }

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
            // The worker needs the one-time link after commit, but job_queue is
            // durable storage. Persist authenticated ciphertext, bound to this
            // tenant and version, rather than placing the bearer token beside
            // its hash in the database.
            approvalUrlCiphertext: encryptApprovalUrl(
              approvalUrl,
              this.app.env.APPROVAL_LINK_ENCRYPTION_SECRET,
              {
                organizationId: ctx.tenant.organizationId,
                versionId: frozenVersion.id,
              },
            ),
          },
        });
      }

      return {
        changeOrderId: changeOrder.id,
        versionId: frozenVersion.id,
        versionNumber: frozenVersion.versionNumber,
        expiresAt,
        canonicalSha256: frozen.sha256Hex,
        messageText,
        approverPhone: approver.phoneE164,
        approverEmail: approver.emailNormalized,
        changeNumber: changeOrder.number,
        projectTitle: project.title,
      };
    });

    return {
      changeOrderId: sent.changeOrderId,
      versionId: sent.versionId,
      versionNumber: sent.versionNumber,
      approvalUrl,
      expiresAt: sent.expiresAt,
      canonicalSha256: sent.canonicalSha256,
      messageText: sent.messageText,
      whatsappUrl: buildWhatsAppShareUrl(sent.approverPhone, sent.messageText),
      smsUrl: buildSmsUrl(sent.approverPhone, sent.messageText),
      mailtoUrl: buildMailtoUrl(
        sent.approverEmail,
        requestEmailSubject(sent.changeNumber, sent.projectTitle),
        sent.messageText,
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

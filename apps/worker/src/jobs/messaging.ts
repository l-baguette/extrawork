import { createHash } from 'node:crypto';
import { DOMAIN_EVENTS, JOB_KINDS } from '@extrawork/contracts';
import { enqueueJob, type JobRow, type MessageDeliveryPayload } from '@extrawork/db';
import {
  DEFAULT_REMINDER_POLICY,
  buildDecisionReceiptMessage,
  buildDecisionReceiptTemplateParameters,
  buildReminderMessage,
  buildReminderTemplateParameters,
  buildRequestMessage,
  buildRequestTemplateParameters,
  decryptApprovalUrl,
  decisionReply,
  requestEmailSubject,
  shouldSendReminder,
  systemTenantContext,
  type ShareMessageInput,
} from '@extrawork/domain';
import { WHATSAPP_TEMPLATES, WHATSAPP_TEMPLATE_LANGUAGE } from '@extrawork/integrations';
import { METRIC, metrics } from '@extrawork/observability';
import type { WorkerContext } from '../context.js';
import {
  optionalPayloadString,
  PermanentJobError,
  requirePayloadInteger,
  requirePayloadOneOf,
  requirePayloadString,
  requirePayloadUuid,
  requireTenant,
} from '../runner.js';

/**
 * Messaging jobs — report §10.3 and §8.6.
 *
 * In the MVP the WhatsApp gateway is the native-share driver: the contractor
 * sends from their own account, so the gateway returns
 * `SHARE_INTENT_PREPARED` and the system records intent, never delivery
 * (report §10.3: "Store SHARE_INTENT_OPENED, not MESSAGE_SENT; the application
 * cannot claim delivery"). Email is a genuine send when a driver is configured.
 *
 * All of this runs after the domain transaction has committed, because report
 * §7.6 forbids provider calls inside a database transaction.
 */

export async function sendReminder(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = {
    reminderId: requirePayloadUuid(job, 'reminderId'),
    versionId: requirePayloadUuid(job, 'versionId'),
    policyStep: requirePayloadInteger(job, 'policyStep'),
    channel: requirePayloadOneOf(job, 'channel', [
      'WHATSAPP',
      'WHATSAPP_NATIVE_SHARE',
      'EMAIL',
    ] as const),
    dedupeKey: requirePayloadString(job, 'dedupeKey'),
  };
  const organizationId = requireTenant(job, optionalPayloadString(job, 'organizationId'));
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const log = ctx.logger.child({ versionId: payload.versionId, step: payload.policyStep });

  const version = await ctx.repos.changeOrders.findVersion(ctx.db, tenant, payload.versionId);
  if (!version) throw new PermanentJobError('VERSION_MISSING', 'Version no longer exists');

  const [organization, changeOrder, project, contact, lastReminderAt, approvalToken] =
    await Promise.all([
      ctx.repos.organizations.findById(tenant),
      ctx.repos.changeOrders.requireChangeOrder(ctx.db, tenant, version.changeOrderId),
      ctx.repos.projects.requireById(tenant, version.projectId),
      ctx.repos.customers.findContact(tenant, version.approverContactId),
      ctx.repos.messages.lastReminderAt(tenant, payload.versionId),
      ctx.repos.approvals.findForVersion(tenant, payload.versionId),
    ]);

  const overWhatsApp = payload.channel === 'WHATSAPP';
  const gateway = overWhatsApp ? ctx.app.integrations.whatsapp : ctx.app.integrations.email;
  const recordedChannel =
    payload.channel === 'EMAIL'
      ? 'EMAIL'
      : overWhatsApp
        ? gateway.channel
        : 'WHATSAPP_NATIVE_SHARE';
  const hasChannel =
    payload.channel === 'EMAIL'
      ? Boolean(contact?.emailNormalized)
      : overWhatsApp && gateway.canDeliver && Boolean(contact?.phoneE164);

  // Report §8.6: state is re-checked immediately before sending, not just when
  // the reminder was scheduled.
  const decision = shouldSendReminder({
    versionStatus: version.status,
    tokenRevoked: !approvalToken || approvalToken.revokedAt !== null,
    expiresAt: version.expiresAt ?? new Date(0),
    optedOut: contact?.whatsappOptInStatus === 'OPTED_OUT',
    lastReminderAt,
    // The dedupe key is unique in the table, so "already sent" is enforced by
    // the row's own state rather than by a set membership test here.
    alreadySentSteps: new Set<string>(),
    dedupeKey: payload.dedupeKey,
    hasChannel,
    timezone: organization?.timezone ?? 'Asia/Kolkata',
    now: ctx.app.clock.now(),
    policy: {
      ...DEFAULT_REMINDER_POLICY,
      localHourStart: ctx.env.REMINDER_LOCAL_HOUR_START,
      localHourEnd: ctx.env.REMINDER_LOCAL_HOUR_END,
      ...(organization?.reminderPolicyHours?.length
        ? { stepsHoursAfterSend: organization.reminderPolicyHours }
        : {}),
    },
  });

  if (!decision.send) {
    if (decision.retryAt) {
      // Outside allowed local hours, or inside the cooldown: defer rather than
      // drop, so the reminder still lands at a civil time.
      await ctx.repos.reminders.defer(ctx.db, organizationId, payload.reminderId, decision.retryAt);
      log.info({ reason: decision.reason, retryAt: decision.retryAt }, 'reminder deferred');
      return;
    }
    await ctx.repos.reminders.markSuppressed(
      ctx.db,
      organizationId,
      payload.reminderId,
      decision.reason ?? 'UNKNOWN',
    );
    await ctx.app.uow.transaction(async (tx) => {
      await ctx.repos.messages.record(tx, tenant, {
        versionId: payload.versionId,
        contactId: version.approverContactId,
        channel: recordedChannel,
        purpose: 'REMINDER',
        status: 'SUPPRESSED',
        dedupeKey: payload.dedupeKey,
        suppressionReason: decision.reason ?? 'UNKNOWN',
      });
    });
    log.info({ reason: decision.reason }, 'reminder suppressed');
    return;
  }

  // The plaintext token was never stored (report §3.4), so a reminder points
  // the customer at the link they already hold rather than minting a new one.
  const messageInput: ShareMessageInput = {
    organizationName: organization?.displayName ?? 'Your contractor',
    customerFirstName: firstName(contact?.name ?? 'there'),
    projectTitle: project.title,
    changeNumber: changeOrder.number,
    totalDeltaMinor: version.totalDeltaMinor,
    currency: version.currency,
    scheduleDeltaDays: version.scheduleDeltaDays,
    approvalUrl: '(use the link from the original message)',
    expiresAt: version.expiresAt ?? ctx.app.clock.now(),
    timezone: project.timezone,
  };
  const body = buildReminderMessage(messageInput);

  const result = await gateway.send({
    to: {
      name: contact?.name ?? 'Customer',
      phoneE164: contact?.phoneE164 ?? null,
      email: contact?.emailNormalized ?? null,
    },
    subject: requestEmailSubject(changeOrder.number, project.title),
    body,
    ...(overWhatsApp
      ? {
          template: {
            name: WHATSAPP_TEMPLATES.REMINDER,
            languageCode: WHATSAPP_TEMPLATE_LANGUAGE,
            bodyParameters: buildReminderTemplateParameters(messageInput),
          },
        }
      : {}),
    purpose: 'REMINDER',
    // Report §13.2: the provider idempotency key is the event/job identity, so
    // a worker crash after a provider success cannot double-send.
    idempotencyKey: payload.dedupeKey,
    organizationName: organization?.displayName ?? 'ExtraWork',
  });

  await ctx.app.uow.transaction(async (tx) => {
    await ctx.repos.messages.record(tx, tenant, {
      versionId: payload.versionId,
      contactId: version.approverContactId,
      channel: recordedChannel,
      purpose: 'REMINDER',
      status: result.status,
      dedupeKey: payload.dedupeKey,
      provider: result.provider,
      providerAccountId: result.providerAccountId ?? null,
      providerMessageId: result.providerMessageId,
    });
    await ctx.repos.audit.append(tx, tenant, [
      {
        aggregateType: 'change_order',
        aggregateId: version.changeOrderId,
        projectId: version.projectId,
        eventType: DOMAIN_EVENTS.MESSAGE_SEND_REQUESTED,
        actorType: 'SYSTEM',
        actorId: null,
        occurredAt: ctx.app.clock.now(),
        payload: {
          purpose: 'REMINDER',
          channel: payload.channel,
          policyStep: payload.policyStep,
          status: result.status,
        },
      },
    ]);
  });
  await ctx.repos.reminders.markSent(ctx.db, organizationId, payload.reminderId);

  metrics.counter(METRIC.PROVIDER_CALLS, 'Provider calls', {
    provider: result.provider,
    purpose: 'reminder',
  });
  log.info({ status: result.status }, 'reminder processed');
}

/**
 * Decision receipt. Report §7.6: "Approval confirmation notification failure
 * never reverses the approval" — the decision committed long before this runs,
 * so a failure here only retries the message.
 */
export async function sendDecisionReceipt(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = {
    decisionId: requirePayloadUuid(job, 'decisionId'),
    versionId: requirePayloadUuid(job, 'versionId'),
  };
  const organizationId = requireTenant(job, optionalPayloadString(job, 'organizationId'));
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);

  const decision = await ctx.repos.approvals.findDecisionByVersion(
    ctx.db,
    tenant,
    payload.versionId,
  );
  if (!decision) throw new PermanentJobError('DECISION_MISSING', 'Decision no longer exists');
  if (decision.id !== payload.decisionId) {
    throw new PermanentJobError(
      'DECISION_MISMATCH',
      'Decision receipt payload does not match the version decision',
    );
  }

  const version = await ctx.repos.changeOrders.requireVersion(ctx.db, tenant, payload.versionId);
  const [organization, changeOrder, project, contact] = await Promise.all([
    ctx.repos.organizations.findById(tenant),
    ctx.repos.changeOrders.requireChangeOrder(ctx.db, tenant, version.changeOrderId),
    ctx.repos.projects.requireById(tenant, version.projectId),
    ctx.repos.customers.findContact(tenant, version.approverContactId),
  ]);

  const receiptInput = {
    organizationName: organization?.displayName ?? 'Your contractor',
    customerFirstName: firstName(contact?.name ?? 'there'),
    changeNumber: changeOrder.number,
    projectTitle: project.title,
    decisionType: decision.type,
    receiptId: decision.receiptDisplayId,
    occurredAt: decision.occurredAt,
    timezone: project.timezone,
  };
  const body = buildDecisionReceiptMessage(receiptInput);
  const recipientName = contact?.name ?? 'Customer';

  /**
   * Confirmation goes out on **every** channel the customer is reachable on,
   * not the first one that works.
   *
   * They have just agreed to spend money, and the only record they hold is the
   * link. A confirmation is the receipt for that, so picking one channel and
   * hoping means a customer whose email bounces has agreed to a cost with
   * nothing in hand. Each send is keyed separately so a retry after one
   * succeeded cannot duplicate the other.
   */
  const organizationName = organization?.displayName ?? 'ExtraWork';
  const intents: Array<{
    channel: string;
    recipientAddress: string;
    dedupeKey: string;
    deliveryPayload: MessageDeliveryPayload;
  }> = [];
  const whatsapp = ctx.app.integrations.whatsapp;

  if (whatsapp.canDeliver && contact?.phoneE164) {
    intents.push({
      channel: whatsapp.channel,
      recipientAddress: contact.phoneE164,
      dedupeKey: `receipt:${organizationId}:${decision.id}:whatsapp`,
      deliveryPayload: {
        body,
        organizationName,
        // Business-initiated: the customer decided on a web page, not in a
        // WhatsApp thread, so no service window is open and this needs the
        // approved template. Gateways that cannot send templates use `body`.
        template: {
          name: WHATSAPP_TEMPLATES.DECISION_RECEIPT,
          languageCode: WHATSAPP_TEMPLATE_LANGUAGE,
          bodyParameters: buildDecisionReceiptTemplateParameters(receiptInput),
        },
      },
    });
  }

  if (contact?.emailNormalized) {
    intents.push({
      channel: 'EMAIL',
      recipientAddress: contact.emailNormalized,
      dedupeKey: `receipt:${organizationId}:${decision.id}:email`,
      deliveryPayload: {
        body,
        organizationName,
        subject: `Receipt ${decision.receiptDisplayId} — ${changeOrder.number}`,
      },
    });
  }

  if (intents.length === 0) {
    // Not a failure to retry: the approver simply has no channel on record.
    // Retrying cannot change that, and the decision itself is already durable.
    ctx.logger.warn(
      { decisionId: decision.id },
      'approver has no phone or email on record; no confirmation sent',
    );
    return;
  }

  await ctx.app.uow.transaction(async (tx) => {
    for (const intent of intents) {
      const messageId = await ctx.repos.messages.createDeliveryIntent(tx, tenant, {
        versionId: version.id,
        contactId: version.approverContactId,
        decisionId: decision.id,
        channel: intent.channel,
        purpose: 'DECISION_RECEIPT',
        recipientKind: 'CUSTOMER',
        recipientName,
        recipientAddress: intent.recipientAddress,
        deliveryPayload: intent.deliveryPayload,
        dedupeKey: intent.dedupeKey,
      });
      await enqueueJob(tx, {
        kind: JOB_KINDS.SEND_MESSAGE_DELIVERY,
        organizationId,
        dedupeKey: `message-delivery:${messageId}`,
        payload: { messageId },
      });
    }
  });
}

/**
 * Sends one row from the durable delivery ledger.
 *
 * Provider calls happen outside a database transaction. A short compare-and-
 * set lease prevents concurrent child jobs from sending the same row, while a
 * stable message dedupe key is passed to the provider for crash recovery.
 */
export async function sendMessageDelivery(job: JobRow, ctx: WorkerContext): Promise<void> {
  const messageId = requirePayloadUuid(job, 'messageId');
  const organizationId = requireTenant(job, optionalPayloadString(job, 'organizationId'));
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const leaseToken = `${job.id}:${job.attemptCount}`;
  const log = ctx.logger.child({ messageId, step: 'message-delivery' });

  const delivery = await ctx.repos.messages.claimDelivery(
    ctx.db,
    tenant,
    messageId,
    leaseToken,
    ctx.env.WORKER_LEASE_SECONDS,
  );

  if (!delivery) {
    const existing = await ctx.repos.messages.findDelivery(ctx.db, tenant, messageId);
    if (!existing) {
      throw new PermanentJobError('DELIVERY_MISSING', 'Message delivery no longer exists');
    }
    // A completed row, or a row actively leased by another child job, needs no
    // second provider call. The active owner will finish or its lease will
    // expire and its own queue job will be reclaimed.
    log.debug({ status: existing.status }, 'message delivery is not claimable');
    return;
  }

  try {
    const payload = requireDeliveryPayload(delivery.deliveryPayload);
    const isEmail = delivery.channel === 'EMAIL';
    const isWhatsApp = delivery.channel.startsWith('WHATSAPP_');
    if (!isEmail && !isWhatsApp) {
      throw new PermanentJobError(
        'DELIVERY_CHANNEL_INVALID',
        `Unsupported durable delivery channel ${delivery.channel}`,
      );
    }

    const gateway = isEmail ? ctx.app.integrations.email : ctx.app.integrations.whatsapp;
    if (!gateway.canDeliver) {
      throw new PermanentJobError(
        'CHANNEL_UNAVAILABLE',
        `The configured ${isEmail ? 'email' : 'WhatsApp'} gateway cannot deliver messages`,
      );
    }

    const result = await gateway.send({
      to: {
        name: delivery.recipientName,
        phoneE164: isWhatsApp ? delivery.recipientAddress : null,
        email: isEmail ? delivery.recipientAddress : null,
      },
      body: payload.body,
      ...(payload.subject ? { subject: payload.subject } : {}),
      ...(payload.template ? { template: payload.template } : {}),
      purpose: 'DECISION_RECEIPT',
      idempotencyKey: delivery.dedupeKey,
      organizationName: payload.organizationName,
    });

    if (result.status !== 'ACCEPTED' && result.status !== 'SENT') {
      throw new Error(`Provider returned non-success message status ${result.status}`);
    }

    const marked = await ctx.repos.messages.markDeliverySent(ctx.db, tenant, messageId, {
      // Record the gateway that actually carried this attempt. This remains
      // truthful if a deployment changes WhatsApp driver between plan/retry.
      channel: gateway.channel,
      status: result.status,
      provider: result.provider,
      providerAccountId: result.providerAccountId ?? null,
      providerMessageId: result.providerMessageId,
    });
    if (!marked) {
      const current = await ctx.repos.messages.findDelivery(ctx.db, tenant, messageId);
      if (!current?.sentAt) {
        throw new Error(
          'Provider accepted the message but the delivery row could not be finalized',
        );
      }
    }

    metrics.counter(METRIC.PROVIDER_CALLS, 'Provider calls', {
      provider: result.provider,
      purpose: delivery.purpose === 'TEAM_DECISION' ? 'team-decision' : 'receipt',
    });
    log.info(
      { status: result.status, recipientKind: delivery.recipientKind },
      'message delivery sent',
    );
  } catch (error) {
    await ctx.repos.messages.markDeliveryFailed(
      ctx.db,
      tenant,
      messageId,
      leaseToken,
      deliveryErrorCode(error),
      String((error as Error)?.message ?? error),
    );
    throw error;
  }
}

/**
 * The "new request" notification.
 *
 * Under native share the contractor has already sent the message from their own
 * WhatsApp and the send transaction recorded the intent, so there is nothing to
 * deliver here. `EMAIL` and `WHATSAPP` are the channels the system delivers on.
 *
 * The approval URL cannot be rebuilt here because only its hash is stored with
 * the token record. The API therefore seals it into the job payload using a
 * dedicated key; this worker is the only durable consumer that opens it.
 */
export async function sendRequestMessage(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = {
    versionId: requirePayloadUuid(job, 'versionId'),
    channel: requirePayloadOneOf(job, 'channel', [
      'WHATSAPP_NATIVE_SHARE',
      'WHATSAPP',
      'EMAIL',
      'COPY_LINK',
    ] as const),
    approvalUrlCiphertext: optionalPayloadString(job, 'approvalUrlCiphertext'),
  };
  const organizationId = requireTenant(job, optionalPayloadString(job, 'organizationId'));
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);

  if (payload.channel !== 'EMAIL' && payload.channel !== 'WHATSAPP') {
    ctx.logger.debug(
      { channel: payload.channel },
      'no automated delivery for this channel; share intent already recorded',
    );
    return;
  }

  if (!payload.approvalUrlCiphertext) {
    throw new PermanentJobError(
      'APPROVAL_LINK_MISSING',
      'Automated request delivery carries no encrypted approval link',
    );
  }
  let approvalUrl: string;
  try {
    approvalUrl = decryptApprovalUrl(
      payload.approvalUrlCiphertext,
      ctx.env.APPROVAL_LINK_ENCRYPTION_SECRET,
      { organizationId, versionId: payload.versionId },
    );
  } catch {
    throw new PermanentJobError(
      'APPROVAL_LINK_INVALID',
      'Automated request delivery carries an invalid encrypted approval link',
    );
  }

  const version = await ctx.repos.changeOrders.findVersion(ctx.db, tenant, payload.versionId);
  if (!version) throw new PermanentJobError('VERSION_MISSING', 'Version no longer exists');

  const [organization, changeOrder, project, contact] = await Promise.all([
    ctx.repos.organizations.findById(tenant),
    ctx.repos.changeOrders.requireChangeOrder(ctx.db, tenant, version.changeOrderId),
    ctx.repos.projects.requireById(tenant, version.projectId),
    ctx.repos.customers.findContact(tenant, version.approverContactId),
  ]);

  const overWhatsApp = payload.channel === 'WHATSAPP';

  if (overWhatsApp && !contact?.phoneE164) {
    throw new PermanentJobError('NO_PHONE', 'Approver has no phone number on record');
  }
  if (!overWhatsApp && !contact?.emailNormalized) {
    throw new PermanentJobError('NO_EMAIL', 'Approver has no email address on record');
  }

  const gateway = overWhatsApp ? ctx.app.integrations.whatsapp : ctx.app.integrations.email;
  if (overWhatsApp && !gateway.canDeliver) {
    // A gateway that cannot deliver would silently record a "sent" message that
    // no customer ever receives, which is worse than a visible failure.
    throw new PermanentJobError(
      'CHANNEL_UNAVAILABLE',
      'The configured WhatsApp gateway cannot deliver messages',
    );
  }

  // Built once and rendered twice — as plain text for email and the record, and
  // as template parameters for WhatsApp. Two renderings of one message: derive
  // them from separate inputs and they eventually disagree about the amount.
  const messageInput: ShareMessageInput = {
    organizationName: organization?.displayName ?? 'Your contractor',
    customerFirstName: firstName(contact?.name ?? 'there'),
    projectTitle: project.title,
    changeNumber: changeOrder.number,
    totalDeltaMinor: version.totalDeltaMinor,
    currency: version.currency,
    scheduleDeltaDays: version.scheduleDeltaDays,
    approvalUrl,
    expiresAt: version.expiresAt ?? ctx.app.clock.now(),
    timezone: project.timezone,
    // So a customer who is unsure can verify through a channel this message
    // does not control.
    ...(organization?.contactPhone ? { organizationPhone: organization.contactPhone } : {}),
  };

  const result = await gateway.send({
    to: {
      name: contact?.name ?? 'Customer',
      email: contact?.emailNormalized ?? null,
      phoneE164: contact?.phoneE164 ?? null,
    },
    subject: requestEmailSubject(changeOrder.number, project.title),
    body: buildRequestMessage(messageInput),
    // An approval request reaches a customer who has not messaged the business,
    // so it is outside WhatsApp's 24-hour service window and must be a template
    // (report §10.3). Gateways that cannot send templates ignore this and use
    // `body`, which is why it is attached without a driver check.
    ...(overWhatsApp
      ? {
          template: {
            name: WHATSAPP_TEMPLATES.REQUEST,
            languageCode: WHATSAPP_TEMPLATE_LANGUAGE,
            bodyParameters: buildRequestTemplateParameters(messageInput),
          },
        }
      : {}),
    purpose: 'REQUEST',
    idempotencyKey: `request:${version.id}`,
    organizationName: organization?.displayName ?? 'ExtraWork',
  });

  await ctx.app.uow.transaction(async (tx) => {
    await ctx.repos.messages.record(tx, tenant, {
      versionId: payload.versionId,
      contactId: version.approverContactId,
      // The gateway's own channel, not the requested one: "WHATSAPP" is a
      // request to deliver, while this column records what actually carried the
      // message — WHATSAPP_SIMULATOR and WHATSAPP_CLOUD_API are very different
      // answers to "did the customer receive this?".
      channel: overWhatsApp ? gateway.channel : 'EMAIL',
      purpose: 'REQUEST',
      status: result.status,
      dedupeKey: `request:${version.id}`,
      provider: result.provider,
      providerAccountId: result.providerAccountId ?? null,
      providerMessageId: result.providerMessageId,
    });
  });
}

/** First name only: the message is a WhatsApp greeting, not a formal letter. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Tells the contractor's own people that a customer decided.
 *
 * This closes the loop the employee was promised. The reply they got when they
 * texted the request in says "I will message you the moment they respond" — so
 * without this the product makes a claim it does not keep, which is worse than
 * having said nothing.
 *
 * Two recipients, for different reasons:
 *   - the **employee who raised it**, because they are the one waiting to know
 *     whether they may start the work, and were explicitly told not to until
 *     this message arrives;
 *   - the **owner**, because an approved change is money the business has just
 *     committed to and they should not have to open a dashboard to learn it.
 *
 * A failure here never touches the decision: it committed long before this ran
 * (report §7.6), and the customer's own receipt is a separate job so a
 * unreachable employee cannot delay or retry it.
 */
export async function notifyTeamDecision(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = {
    decisionId: requirePayloadUuid(job, 'decisionId'),
    versionId: requirePayloadUuid(job, 'versionId'),
  };
  const organizationId = requireTenant(job, optionalPayloadString(job, 'organizationId'));
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const log = ctx.logger.child({ versionId: payload.versionId, step: 'notify-team' });

  const gateway = ctx.app.integrations.whatsapp;
  if (!gateway.canDeliver) {
    // Native share cannot deliver anything. Recording a "sent" message would
    // claim a notification the employee never received.
    log.debug({ channel: gateway.channel }, 'gateway cannot deliver; nothing to notify');
    return;
  }

  const decision = await ctx.repos.approvals.findDecisionByVersion(
    ctx.db,
    tenant,
    payload.versionId,
  );
  if (!decision) throw new PermanentJobError('DECISION_MISSING', 'Decision no longer exists');
  if (decision.id !== payload.decisionId) {
    throw new PermanentJobError(
      'DECISION_MISMATCH',
      'Team notification payload does not match the version decision',
    );
  }

  const version = await ctx.repos.changeOrders.requireVersion(ctx.db, tenant, payload.versionId);
  const [organization, changeOrder, project, origin] = await Promise.all([
    ctx.repos.organizations.findById(tenant),
    ctx.repos.changeOrders.requireChangeOrder(ctx.db, tenant, version.changeOrderId),
    ctx.repos.projects.requireById(tenant, version.projectId),
    ctx.repos.changeOrders.findOrigin(ctx.db, tenant, payload.versionId),
  ]);

  const body = decisionReply({
    changeNumber: changeOrder.number,
    projectTitle: project.title,
    decision: decision.type,
    signerName: decision.signerName,
    comment: decision.signerComment,
    amountMinor: version.totalDeltaMinor,
    currency: version.currency,
    receiptId: decision.receiptDisplayId,
  });

  // Deduplicated by number: the employee who raised it may also be reachable on
  // the organization's contact line, and one person should get one message.
  const recipients = new Map<
    string,
    { kind: 'EMPLOYEE' | 'OWNER'; name: string; phoneE164: string }
  >();

  if (origin?.raisedByEmployeeId) {
    const employee = await ctx.repos.employees.findById(tenant, origin.raisedByEmployeeId);
    // A removed employee keeps their row so the log stays readable, but they
    // are no longer someone to message.
    if (employee && employee.status === 'ACTIVE') {
      recipients.set(employee.phoneE164, {
        kind: 'EMPLOYEE',
        name: employee.name,
        phoneE164: employee.phoneE164,
      });
    }
  }
  if (organization?.contactPhone) {
    // The owner may be the employee who raised the request. Keep the first row
    // so one phone number receives one notification, never one per role.
    if (!recipients.has(organization.contactPhone)) {
      recipients.set(organization.contactPhone, {
        kind: 'OWNER',
        name: organization.displayName,
        phoneE164: organization.contactPhone,
      });
    }
  }

  if (recipients.size === 0) {
    log.debug('no internal recipient on record; nothing to notify');
    return;
  }

  await ctx.app.uow.transaction(async (tx) => {
    for (const recipient of recipients.values()) {
      const addressHash = createHash('sha256')
        .update(recipient.phoneE164)
        .digest('hex')
        .slice(0, 24);
      const messageId = await ctx.repos.messages.createDeliveryIntent(tx, tenant, {
        versionId: version.id,
        contactId: null,
        decisionId: decision.id,
        channel: gateway.channel,
        purpose: 'TEAM_DECISION',
        recipientKind: recipient.kind,
        recipientName: recipient.name,
        recipientAddress: recipient.phoneE164,
        deliveryPayload: {
          body,
          organizationName: organization?.displayName ?? 'ExtraWork',
        },
        // Do not put a staff phone number into queue/operations identifiers.
        dedupeKey: `team-decision:${organizationId}:${decision.id}:${addressHash}`,
      });
      await enqueueJob(tx, {
        kind: JOB_KINDS.SEND_MESSAGE_DELIVERY,
        organizationId,
        dedupeKey: `message-delivery:${messageId}`,
        payload: { messageId },
      });
    }
  });

  log.info(
    { recipients: recipients.size, decision: decision.type },
    'team notification deliveries planned',
  );
}

function requireDeliveryPayload(value: unknown): MessageDeliveryPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PermanentJobError('DELIVERY_PAYLOAD_INVALID', 'Delivery payload must be an object');
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.body !== 'string' || payload.body.length === 0) {
    throw new PermanentJobError('DELIVERY_PAYLOAD_INVALID', 'Delivery payload has no body');
  }
  if (typeof payload.organizationName !== 'string' || payload.organizationName.length === 0) {
    throw new PermanentJobError(
      'DELIVERY_PAYLOAD_INVALID',
      'Delivery payload has no organization name',
    );
  }
  if (payload.subject !== undefined && typeof payload.subject !== 'string') {
    throw new PermanentJobError('DELIVERY_PAYLOAD_INVALID', 'Delivery subject must be text');
  }

  let template: MessageDeliveryPayload['template'];
  if (payload.template !== undefined) {
    if (
      !payload.template ||
      typeof payload.template !== 'object' ||
      Array.isArray(payload.template)
    ) {
      throw new PermanentJobError('DELIVERY_PAYLOAD_INVALID', 'Delivery template is invalid');
    }
    const raw = payload.template as Record<string, unknown>;
    if (
      typeof raw.name !== 'string' ||
      typeof raw.languageCode !== 'string' ||
      !Array.isArray(raw.bodyParameters) ||
      !raw.bodyParameters.every((entry) => typeof entry === 'string')
    ) {
      throw new PermanentJobError('DELIVERY_PAYLOAD_INVALID', 'Delivery template is invalid');
    }
    template = {
      name: raw.name,
      languageCode: raw.languageCode,
      bodyParameters: raw.bodyParameters as string[],
    };
  }

  return {
    body: payload.body,
    organizationName: payload.organizationName,
    ...(typeof payload.subject === 'string' ? { subject: payload.subject } : {}),
    ...(template ? { template } : {}),
  };
}

function deliveryErrorCode(error: unknown): string {
  if (error instanceof PermanentJobError) return error.code;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return 'DELIVERY_FAILED';
}

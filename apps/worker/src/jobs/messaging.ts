import { DOMAIN_EVENTS } from '@extrawork/contracts';
import type { JobRow } from '@extrawork/db';
import {
  DEFAULT_REMINDER_POLICY,
  buildDecisionReceiptMessage,
  buildReminderMessage,
  buildRequestMessage,
  decisionReply,
  requestEmailSubject,
  shouldSendReminder,
  systemTenantContext,
} from '@extrawork/domain';
import { METRIC, metrics } from '@extrawork/observability';
import type { WorkerContext } from '../context.js';
import { PermanentJobError, requireTenant } from '../runner.js';

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

interface ReminderPayload {
  reminderId: string;
  versionId: string;
  organizationId: string;
  policyStep: number;
  channel: 'WHATSAPP_NATIVE_SHARE' | 'EMAIL';
  dedupeKey: string;
}

export async function sendReminder(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = job.payload as unknown as ReminderPayload;
  const organizationId = requireTenant(job, payload.organizationId);
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const log = ctx.logger.child({ versionId: payload.versionId, step: payload.policyStep });

  const version = await ctx.repos.changeOrders.findVersion(ctx.db, tenant, payload.versionId);
  if (!version) throw new PermanentJobError('VERSION_MISSING', 'Version no longer exists');

  const [organization, changeOrder, project, contact, lastReminderAt] = await Promise.all([
    ctx.repos.organizations.findById(tenant),
    ctx.repos.changeOrders.requireChangeOrder(ctx.db, tenant, version.changeOrderId),
    ctx.repos.projects.requireById(tenant, version.projectId),
    ctx.repos.customers.findContact(tenant, version.approverContactId),
    ctx.repos.messages.lastReminderAt(tenant, payload.versionId),
  ]);

  // Report §8.6: state is re-checked immediately before sending, not just when
  // the reminder was scheduled.
  const decision = shouldSendReminder({
    versionStatus: version.status,
    tokenRevoked: false,
    expiresAt: version.expiresAt ?? new Date(0),
    optedOut: contact?.whatsappOptInStatus === 'OPTED_OUT',
    lastReminderAt,
    // The dedupe key is unique in the table, so "already sent" is enforced by
    // the row's own state rather than by a set membership test here.
    alreadySentSteps: new Set<string>(),
    dedupeKey: payload.dedupeKey,
    hasChannel: Boolean(contact?.phoneE164 ?? contact?.emailNormalized),
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
      await ctx.repos.reminders.defer(ctx.db, payload.reminderId, decision.retryAt);
      log.info({ reason: decision.reason, retryAt: decision.retryAt }, 'reminder deferred');
      return;
    }
    await ctx.repos.reminders.markSuppressed(
      ctx.db,
      payload.reminderId,
      decision.reason ?? 'UNKNOWN',
    );
    await ctx.app.uow.transaction(async (tx) => {
      await ctx.repos.messages.record(tx, tenant, {
        versionId: payload.versionId,
        contactId: version.approverContactId,
        channel: payload.channel,
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
  const body = buildReminderMessage({
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
  });

  const gateway =
    payload.channel === 'EMAIL' ? ctx.app.integrations.email : ctx.app.integrations.whatsapp;

  const result = await gateway.send({
    to: {
      name: contact?.name ?? 'Customer',
      phoneE164: contact?.phoneE164 ?? null,
      email: contact?.emailNormalized ?? null,
    },
    subject: requestEmailSubject(changeOrder.number, project.title),
    body,
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
      channel: payload.channel,
      purpose: 'REMINDER',
      status: result.status,
      dedupeKey: payload.dedupeKey,
      provider: result.provider,
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
  await ctx.repos.reminders.markSent(ctx.db, payload.reminderId);

  metrics.counter(METRIC.PROVIDER_CALLS, 'Provider calls', {
    provider: result.provider,
    purpose: 'reminder',
  });
  log.info({ status: result.status }, 'reminder processed');
}

interface ReceiptPayload {
  decisionId: string;
  versionId: string;
  organizationId: string;
}

/**
 * Decision receipt. Report §7.6: "Approval confirmation notification failure
 * never reverses the approval" — the decision committed long before this runs,
 * so a failure here only retries the message.
 */
export async function sendDecisionReceipt(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = job.payload as unknown as ReceiptPayload;
  const organizationId = requireTenant(job, payload.organizationId);
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);

  const decision = await ctx.repos.approvals.findDecisionByVersion(
    ctx.db,
    tenant,
    payload.versionId,
  );
  if (!decision) throw new PermanentJobError('DECISION_MISSING', 'Decision no longer exists');

  const version = await ctx.repos.changeOrders.requireVersion(ctx.db, tenant, payload.versionId);
  const [organization, changeOrder, project, contact] = await Promise.all([
    ctx.repos.organizations.findById(tenant),
    ctx.repos.changeOrders.requireChangeOrder(ctx.db, tenant, version.changeOrderId),
    ctx.repos.projects.requireById(tenant, version.projectId),
    ctx.repos.customers.findContact(tenant, version.approverContactId),
  ]);

  const body = buildDecisionReceiptMessage({
    organizationName: organization?.displayName ?? 'Your contractor',
    customerFirstName: firstName(contact?.name ?? 'there'),
    changeNumber: changeOrder.number,
    projectTitle: project.title,
    decisionType: decision.type,
    receiptId: decision.receiptDisplayId,
    occurredAt: decision.occurredAt,
    timezone: project.timezone,
  });

  const result = await ctx.app.integrations.email.send({
    to: {
      name: contact?.name ?? 'Customer',
      email: contact?.emailNormalized ?? null,
      phoneE164: contact?.phoneE164 ?? null,
    },
    subject: `Receipt ${decision.receiptDisplayId} — ${changeOrder.number}`,
    body,
    purpose: 'DECISION_RECEIPT',
    idempotencyKey: `receipt:${decision.id}`,
    organizationName: organization?.displayName ?? 'ExtraWork',
  });

  await ctx.app.uow.transaction(async (tx) => {
    await ctx.repos.messages.record(tx, tenant, {
      versionId: version.id,
      contactId: version.approverContactId,
      channel: 'EMAIL',
      purpose: 'DECISION_RECEIPT',
      status: result.status,
      dedupeKey: `receipt:${decision.id}`,
      provider: result.provider,
    });
  });

  metrics.counter(METRIC.PROVIDER_CALLS, 'Provider calls', {
    provider: result.provider,
    purpose: 'receipt',
  });
}

interface RequestMessagePayload {
  versionId: string;
  organizationId: string;
  channel: 'WHATSAPP_NATIVE_SHARE' | 'WHATSAPP' | 'EMAIL' | 'COPY_LINK';
  /** Present only for channels the system delivers on (report §3.4). */
  approvalUrl?: string;
}

/**
 * The "new request" notification.
 *
 * Under native share the contractor has already sent the message from their own
 * WhatsApp and the send transaction recorded the intent, so there is nothing to
 * deliver here. `EMAIL` and `WHATSAPP` are the channels the system delivers on.
 *
 * The approval URL cannot be rebuilt here — the plaintext token exists only in
 * the response to the send call (report §3.4) — so it travels in the job
 * payload. Where it is missing the message still goes out, pointing the
 * customer at the link they were already given rather than inventing one.
 */
export async function sendRequestMessage(job: JobRow, ctx: WorkerContext): Promise<void> {
  const payload = job.payload as unknown as RequestMessagePayload;
  const organizationId = requireTenant(job, payload.organizationId);
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);

  if (payload.channel !== 'EMAIL' && payload.channel !== 'WHATSAPP') {
    ctx.logger.debug(
      { channel: payload.channel },
      'no automated delivery for this channel; share intent already recorded',
    );
    return;
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

  const result = await gateway.send({
    to: {
      name: contact?.name ?? 'Customer',
      email: contact?.emailNormalized ?? null,
      phoneE164: contact?.phoneE164 ?? null,
    },
    subject: requestEmailSubject(changeOrder.number, project.title),
    body: buildRequestMessage({
      organizationName: organization?.displayName ?? 'Your contractor',
      customerFirstName: firstName(contact?.name ?? 'there'),
      projectTitle: project.title,
      changeNumber: changeOrder.number,
      totalDeltaMinor: version.totalDeltaMinor,
      currency: version.currency,
      scheduleDeltaDays: version.scheduleDeltaDays,
      approvalUrl: payload.approvalUrl ?? '(use the link from the original message)',
      expiresAt: version.expiresAt ?? ctx.app.clock.now(),
      timezone: project.timezone,
      // So a customer who is unsure can verify through a channel this message
      // does not control.
      ...(organization?.contactPhone ? { organizationPhone: organization.contactPhone } : {}),
    }),
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
    });
  });
}

/** First name only: the message is a WhatsApp greeting, not a formal letter. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

interface TeamDecisionPayload {
  decisionId: string;
  versionId: string;
  organizationId: string;
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
  const payload = job.payload as unknown as TeamDecisionPayload;
  const organizationId = requireTenant(job, payload.organizationId);
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
  const recipients = new Map<string, string>();

  if (origin?.raisedByEmployeeId) {
    const employee = await ctx.repos.employees.findById(tenant, origin.raisedByEmployeeId);
    // A removed employee keeps their row so the log stays readable, but they
    // are no longer someone to message.
    if (employee && employee.status === 'ACTIVE') {
      recipients.set(employee.phoneE164, employee.name);
    }
  }
  if (organization?.contactPhone) {
    recipients.set(organization.contactPhone, organization.displayName);
  }

  if (recipients.size === 0) {
    log.debug('no internal recipient on record; nothing to notify');
    return;
  }

  for (const [phoneE164, name] of recipients) {
    // Sent one at a time and keyed per recipient, so a failure to reach one
    // does not re-send to the others when the job retries.
    const result = await gateway.send({
      to: { name, phoneE164, email: null },
      body,
      purpose: 'DECISION_RECEIPT',
      idempotencyKey: `team-decision:${decision.id}:${phoneE164}`,
      organizationName: organization?.displayName ?? 'ExtraWork',
    });

    metrics.counter(METRIC.PROVIDER_CALLS, 'Provider calls', {
      provider: result.provider,
      purpose: 'team-decision',
    });
  }

  log.info({ recipients: recipients.size, decision: decision.type }, 'team notified of decision');
}

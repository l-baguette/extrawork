import type { JobRow, PaymentIntentStatus, WebhookEventRow } from '@extrawork/db';
import { DOMAIN_EVENTS } from '@extrawork/contracts';
import { systemTenantContext } from '@extrawork/domain';
import { normalizeRazorpayPaymentEvent, verifyPaymentMatchesIntent } from '@extrawork/integrations';
import type { WorkerContext } from '../context.js';
import { PermanentJobError, requirePayloadUuid } from '../runner.js';
import { handleInboundMessage } from './inbound.js';

/**
 * Webhook normalisation — report §13.2 and §10.3.
 *
 * The API verifies the provider signature against the raw body, inserts the
 * event into `webhook_inbox` under a unique provider key, and returns 200
 * quickly. This job does the slow half: mapping a provider payload onto
 * internal state.
 *
 * Three rules from the report shape it:
 *  - a payload is never reused as a domain model (§14.4) — it is mapped;
 *  - an older status must not regress internal state, but the raw event is
 *    still preserved (§10.3);
 *  - an unknown event is preserved and alerted on, never discarded (§14.6).
 */

/**
 * The row id in `webhook_inbox`. The name matches the table the id belongs to,
 * and matches what the API and the outbox pump enqueue — a mismatch here reads
 * `undefined`, finds no row, and fails every job as WEBHOOK_MISSING.
 */
/** Delivery states in the order a provider may legitimately advance through. */
const STATUS_RANK: Record<string, number> = {
  PENDING: 0,
  SHARE_INTENT_PREPARED: 0,
  ACCEPTED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
};

export async function normalizeWebhook(job: JobRow, ctx: WorkerContext): Promise<void> {
  const webhookInboxId = requirePayloadUuid(job, 'webhookInboxId');
  const log = ctx.logger.child({ webhookInboxId });

  const event = await ctx.repos.webhooks.findById(ctx.db, webhookInboxId);
  if (!event) throw new PermanentJobError('WEBHOOK_MISSING', 'Webhook event no longer exists');
  if (event.processedAt) {
    log.debug('webhook already normalised');
    return;
  }

  // A payload whose signature failed verification must never reach domain
  // state. The row is retained for forensics (report §12.2, forged webhooks).
  if (!event.signatureVerified) {
    await ctx.repos.webhooks.markProcessed(
      ctx.db,
      webhookInboxId,
      'signature not verified; ignored',
    );
    log.warn({ provider: event.provider }, 'ignoring webhook with unverified signature');
    return;
  }

  try {
    // `kind` is the adapter's own classification, stored since migration 0009.
    // Rows written before it fall back to shape detection below, which is what
    // the whole handler relied on previously.
    if (event.kind === 'INBOUND_MESSAGE') {
      await handleInboundMessage(event, ctx);
      await ctx.repos.webhooks.markProcessed(ctx.db, webhookInboxId, null);
      return;
    }

    if (event.kind === 'PAYMENT_STATUS') {
      const processError = await reconcilePaymentStatus(event, ctx);
      await ctx.repos.webhooks.markProcessed(ctx.db, webhookInboxId, processError);
      return;
    }

    const statuses = mapMessageStatuses(event);

    if (statuses.length > 0) {
      for (const status of statuses) await applyMessageStatus(event, status, ctx);
    } else if (event.kind === null && looksLikeInboundMessage(event)) {
      // An unclassified row that is unmistakably a person's message. Handled
      // rather than warned about, so events stored before 0009 still reach
      // intake instead of sitting unprocessed.
      await handleInboundMessage(event, ctx);
    } else {
      // Preserved, acknowledged, and surfaced — the report is explicit that an
      // unrecognised provider event must not be silently dropped.
      log.warn(
        { provider: event.provider, providerEventId: event.providerEventId },
        'webhook has no applicable normaliser; raw event preserved for review',
      );
    }
    await ctx.repos.webhooks.markProcessed(ctx.db, webhookInboxId, null);
  } catch (error) {
    await ctx.repos.webhooks
      .recordProcessingError(ctx.db, webhookInboxId, String((error as Error).message))
      .catch(() => undefined);
    throw error;
  }
}

const PAYMENT_STATUS_RANK: Record<PaymentIntentStatus, number> = {
  CREATED: 0,
  PENDING: 1,
  FAILED: 1,
  CANCELLED: 1,
  PAID: 2,
  REFUNDED: 3,
};

/** Reconciles an already signature-verified Razorpay event atomically. */
async function reconcilePaymentStatus(
  event: WebhookEventRow,
  ctx: WorkerContext,
): Promise<string | null> {
  if (event.provider !== 'razorpay') {
    throw new PermanentJobError(
      'PAYMENT_PROVIDER_UNSUPPORTED',
      `No payment normaliser exists for ${event.provider}`,
    );
  }

  const normalized = normalizeRazorpayPaymentEvent(event.rawPayload);
  if (!normalized) {
    throw new PermanentJobError(
      'PAYMENT_EVENT_INVALID',
      'Verified payment webhook did not contain a usable order identity',
    );
  }

  return ctx.app.uow.transaction(async (tx) => {
    const intent = await ctx.repos.payments.lockByProviderOrder(
      tx,
      event.provider,
      normalized.providerOrderId,
    );
    // This can be a real ordering race: retain the unprocessed inbox row and
    // retry rather than acknowledging money we cannot yet associate.
    if (!intent) {
      throw new Error(`Payment intent not found for order ${normalized.providerOrderId}`);
    }

    const tenant = systemTenantContext(intent.organizationId, `webhook:${event.id}`);
    const match = verifyPaymentMatchesIntent(normalized, intent);
    if (!match.ok) {
      const reason = match.reason ?? 'Payment reconciliation mismatch';
      await ctx.repos.audit.append(tx, tenant, [
        {
          aggregateType: 'PAYMENT_INTENT',
          aggregateId: intent.id,
          projectId: intent.projectId,
          eventType: DOMAIN_EVENTS.INTEGRITY_MISMATCH_DETECTED,
          actorType: 'SYSTEM',
          actorId: event.provider,
          occurredAt: event.providerEventAt ?? ctx.app.clock.now(),
          payload: {
            source: 'PAYMENT_WEBHOOK',
            providerEventId: event.providerEventId,
            providerOrderId: normalized.providerOrderId,
            reason,
          },
        },
      ]);
      ctx.logger.error(
        { paymentIntentId: intent.id, providerEventId: event.providerEventId, reason },
        'payment webhook did not match stored intent',
      );
      return reason;
    }

    const incoming = normalized.status as PaymentIntentStatus;
    const shouldAdvance = PAYMENT_STATUS_RANK[incoming] >= PAYMENT_STATUS_RANK[intent.status];
    // PAID is authoritative even after a local cancellation or an earlier
    // failed attempt on the same order; no lower state can regress PAID.
    const nextStatus = shouldAdvance || incoming === 'PAID' ? incoming : intent.status;

    await ctx.repos.payments.updateFromProvider(tx, intent, {
      status: nextStatus,
      providerPaymentId: normalized.providerPaymentId,
    });
    await ctx.repos.audit.append(tx, tenant, [
      {
        aggregateType: 'PAYMENT_INTENT',
        aggregateId: intent.id,
        projectId: intent.projectId,
        eventType: DOMAIN_EVENTS.PAYMENT_STATUS_CHANGED,
        actorType: 'SYSTEM',
        actorId: event.provider,
        occurredAt: event.providerEventAt ?? ctx.app.clock.now(),
        payload: {
          providerEventId: event.providerEventId,
          providerOrderId: normalized.providerOrderId,
          providerPaymentId: normalized.providerPaymentId,
          providerStatus: normalized.status,
          previousStatus: intent.status,
          status: nextStatus,
          applied: nextStatus !== intent.status,
        },
      },
    ]);
    return null;
  });
}

/**
 * Whether an unclassified payload is a person's message rather than a delivery
 * receipt. A status always carries a `status` field; a message never does, and
 * always identifies its sender.
 */
function looksLikeInboundMessage(event: WebhookEventRow): boolean {
  const raw = event.rawPayload as Record<string, unknown> | null;
  if (!raw || typeof raw.status === 'string') return false;
  return typeof raw.from === 'string' || typeof raw.fromPhoneE164 === 'string';
}

interface NormalizedStatus {
  providerMessageId: string;
  status: string;
  errorCode: string | null;
  occurredAt: Date | null;
}

/**
 * Maps the provider payload into internal statuses.
 *
 * Two shapes reach this function, because `webhook_inbox` holds one row per
 * provider *event*, not one per HTTP request:
 *
 *  - a bare Meta status object. This is what actually gets stored: the gateway
 *    splits `entry[].changes[].value.statuses[]` into one event per status so
 *    each carries its own `(id, status, timestamp)` dedupe key, and persists
 *    that lone status as the row's raw payload;
 *  - the full `entry[].changes[].value.statuses[]` envelope, for a producer
 *    that stores a request body whole.
 *
 * Reading only the envelope was the second half of this seam's breakage: with
 * the job payload key fixed, every delivery receipt still mapped to zero
 * statuses and no message ever left ACCEPTED.
 *
 * Anything matching neither shape yields no statuses, which routes the event to
 * the "preserve and alert" path rather than to a partial update.
 */
export function mapMessageStatuses(event: WebhookEventRow): NormalizedStatus[] {
  const raw = event.rawPayload;
  if (!raw) return [];

  const entries = Array.isArray(raw.entry) ? raw.entry : [];
  const out: NormalizedStatus[] = [];

  for (const entry of entries) {
    const changes = Array.isArray((entry as Record<string, unknown>)?.changes)
      ? ((entry as Record<string, unknown>).changes as unknown[])
      : [];
    for (const change of changes) {
      const value = (change as Record<string, unknown>)?.value as
        | Record<string, unknown>
        | undefined;
      const statuses = Array.isArray(value?.statuses) ? (value?.statuses as unknown[]) : [];
      for (const entryStatus of statuses) {
        const mapped = toNormalizedStatus(entryStatus, event);
        if (mapped) out.push(mapped);
      }
    }
  }
  if (out.length > 0) return out;

  const single = toNormalizedStatus(raw, event);
  return single ? [single] : [];
}

/**
 * One Meta status object to one internal status, or null when the value is not
 * a status at all — which is how a payment or auth payload falls through to the
 * "preserve and alert" path instead of being read as a delivery receipt.
 */
function toNormalizedStatus(input: unknown, event: WebhookEventRow): NormalizedStatus | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as Record<string, unknown>;
  const id = typeof s.id === 'string' ? s.id : null;
  const status = typeof s.status === 'string' ? s.status.toUpperCase() : null;
  if (!id || !status) return null;

  const timestamp = typeof s.timestamp === 'string' ? Number.parseInt(s.timestamp, 10) : null;
  const errors = Array.isArray(s.errors) ? (s.errors as Array<Record<string, unknown>>) : [];
  return {
    providerMessageId: id,
    status,
    errorCode: errors[0]?.code !== undefined ? String(errors[0]?.code) : null,
    occurredAt: timestamp ? new Date(timestamp * 1000) : event.providerEventAt,
  };
}

async function applyMessageStatus(
  event: WebhookEventRow,
  normalized: NormalizedStatus,
  ctx: WorkerContext,
): Promise<void> {
  const message = await ctx.repos.messages.findByProviderMessageId(
    ctx.db,
    event.provider,
    event.providerAccountId,
    normalized.providerMessageId,
  );
  if (!message) {
    ctx.logger.warn(
      { providerMessageId: normalized.providerMessageId },
      'message status for an unknown provider message id',
    );
    return;
  }

  // Every status is recorded as an event, including a late one, so the history
  // stays complete.
  await ctx.repos.messages.appendEvent(ctx.db, {
    organizationId: message.organizationId,
    messageId: message.id,
    status: normalized.status,
    providerEventAt: normalized.occurredAt,
    payload: {
      provider: event.provider,
      providerAccountId: event.providerAccountId,
      errorCode: normalized.errorCode,
    },
  });

  // Out-of-order delivery is normal, so only a forward move updates state.
  const currentRank = STATUS_RANK[message.status] ?? 0;
  const incomingRank = STATUS_RANK[normalized.status] ?? 0;
  if (incomingRank >= currentRank) {
    await ctx.repos.messages.updateStatus(
      ctx.db,
      message.id,
      normalized.status,
      normalized.providerMessageId,
      normalized.errorCode,
    );
  } else {
    ctx.logger.info(
      { messageId: message.id, current: message.status, incoming: normalized.status },
      'ignoring out-of-order message status regression',
    );
  }
}

import type { JobRow, WebhookEventRow } from '@extrawork/db';
import type { WorkerContext } from '../context.js';
import { PermanentJobError } from '../runner.js';

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

interface WebhookPayload {
  webhookId: string;
}

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
  const payload = job.payload as unknown as WebhookPayload;
  const log = ctx.logger.child({ webhookId: payload.webhookId });

  const event = await ctx.repos.webhooks.findById(ctx.db, payload.webhookId);
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
      payload.webhookId,
      'signature not verified; ignored',
    );
    log.warn({ provider: event.provider }, 'ignoring webhook with unverified signature');
    return;
  }

  try {
    const statuses = mapMessageStatuses(event);

    if (statuses.length > 0) {
      for (const status of statuses) await applyMessageStatus(event, status, ctx);
    } else {
      // Preserved, acknowledged, and surfaced — the report is explicit that an
      // unrecognised provider event must not be silently dropped.
      log.warn(
        { provider: event.provider, providerEventId: event.providerEventId },
        'webhook has no applicable normaliser; raw event preserved for review',
      );
    }
    await ctx.repos.webhooks.markProcessed(ctx.db, payload.webhookId, null);
  } catch (error) {
    await ctx.repos.webhooks
      .markProcessed(ctx.db, payload.webhookId, String((error as Error).message))
      .catch(() => undefined);
    throw error;
  }
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
 * Meta's Cloud API nests delivery receipts under
 * `entry[].changes[].value.statuses[]`. Anything that does not match that shape
 * yields no statuses, which routes the event to the "preserve and alert" path
 * rather than to a partial update.
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
        const s = entryStatus as Record<string, unknown>;
        const id = typeof s.id === 'string' ? s.id : null;
        const status = typeof s.status === 'string' ? s.status.toUpperCase() : null;
        if (!id || !status) continue;
        const timestamp = typeof s.timestamp === 'string' ? Number.parseInt(s.timestamp, 10) : null;
        const errors = Array.isArray(s.errors) ? (s.errors as Array<Record<string, unknown>>) : [];
        out.push({
          providerMessageId: id,
          status,
          errorCode: errors[0]?.code !== undefined ? String(errors[0]?.code) : null,
          occurredAt: timestamp ? new Date(timestamp * 1000) : event.providerEventAt,
        });
      }
    }
  }
  return out;
}

async function applyMessageStatus(
  event: WebhookEventRow,
  normalized: NormalizedStatus,
  ctx: WorkerContext,
): Promise<void> {
  const message = await ctx.repos.messages.findByProviderMessageId(
    ctx.db,
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
    payload: { provider: event.provider, errorCode: normalized.errorCode },
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

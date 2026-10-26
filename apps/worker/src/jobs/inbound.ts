import type { WebhookEventRow } from '@extrawork/db';
import {
  parseMetaInboundMessage,
  type InboundMediaRef,
  type InboundMessageEvent,
} from '@extrawork/integrations';
import type { WorkerContext } from '../context.js';

/**
 * A message a person sent to the business number — report §10.3, handoff §15.
 *
 * The API stores the event and answers 200 immediately, because Meta redelivers
 * anything it does not hear back about within seconds and intake is far too
 * slow to run inside that window: it resolves the employee, matches a project,
 * prices the work, freezes a version, mints a token and schedules a customer
 * send. All of that happens here instead.
 *
 * Three things this does that the simulator route never had to:
 *
 *  - it **sends the reply**. The simulator returned it in an HTTP response and
 *    the UI displayed it; over real WhatsApp there is no response to return, so
 *    without an explicit send the employee gets silence — the one outcome the
 *    intake design rules out. The reply is free: they messaged first, so it is
 *    inside the 24-hour service window and needs no template.
 *  - it **fetches attachments**, through `IntakeService.storeMedia`, but only
 *    once the message has been filed into a workspace and project.
 *  - it **never fetches for a stranger**. Intake records the media handles with
 *    the message and fetches only for a row it attributed; downloading for an
 *    unknown number would let anyone holding the business number make this
 *    worker pull arbitrary bytes.
 */

/**
 * Rebuilds the parsed event from the raw payload stored in `webhook_inbox`.
 *
 * The stored payload is the provider's own object, kept verbatim so an
 * unrecognised event is still evidence (report §14.6). Re-deriving the parsed
 * form therefore goes back through the adapter's parser rather than reading
 * fields here: parsing Meta's envelope in two places is how an attachment ends
 * up visible on one path and silently dropped on the other.
 *
 * The already-normalised shape is still accepted, so a payload stored by a
 * producer that persisted the normalised form remains processable.
 */
export function toInboundMessageEvent(event: WebhookEventRow): InboundMessageEvent | null {
  const raw = event.rawPayload as Record<string, unknown> | null;
  if (!raw) return null;

  const id = typeof raw.providerMessageId === 'string' ? raw.providerMessageId : null;
  const from = typeof raw.fromPhoneE164 === 'string' ? raw.fromPhoneE164 : null;
  if (id && from) {
    return {
      providerMessageId: id,
      fromPhoneE164: from,
      body: typeof raw.body === 'string' ? raw.body : '',
      media: Array.isArray(raw.media) ? (raw.media as InboundMediaRef[]) : [],
      messageType: typeof raw.messageType === 'string' ? raw.messageType : 'unknown',
    };
  }

  return parseMetaInboundMessage(raw);
}

export async function handleInboundMessage(
  event: WebhookEventRow,
  ctx: WorkerContext,
): Promise<void> {
  const message = toInboundMessageEvent(event);
  if (!message) {
    ctx.logger.warn(
      { webhookId: event.id, provider: event.provider },
      'inbound webhook carried no recognisable message; raw event preserved',
    );
    return;
  }

  const log = ctx.logger.child({ webhookId: event.id, messageType: message.messageType });

  // The same service the simulator and every test drive. Intake owns its own
  // replay protection, so a job retry re-reads the stored outcome rather than
  // raising a second change request. The media handles are recorded with the
  // message, so a message held for a project choice can still have its
  // attachments fetched once the sender answers (spec 2026-10-12, D6).
  const outcome = await ctx.services.intake.handleInbound({
    provider: event.provider,
    providerAccountId: event.providerAccountId,
    providerMessageId: message.providerMessageId,
    fromPhoneE164: message.fromPhoneE164,
    body: message.body,
    mediaCount: message.media.length,
    media: message.media.map((ref) => ({
      mediaId: ref.mediaId,
      mimeType: ref.mimeType,
      filename: ref.filename,
      caption: ref.caption,
    })),
  });

  // Reply first: media quarantine may be temporarily unavailable, but a person
  // standing on site should still hear what happened to their message.
  await sendReply(message.fromPhoneE164, outcome.reply, outcome.inboundMessageId, ctx);

  if (outcome.status === 'REJECTED_UNKNOWN_SENDER' && message.media.length > 0) {
    log.warn(
      { mediaCount: message.media.length },
      'discarding media from an unrecognised sender without fetching it',
    );
  } else {
    // Intake decides from the stored row: it fetches only for a message filed
    // into a workspace and project (this one, or the held messages this answer
    // released), never for a stranger or a message still held. Failure stays
    // retryable at the webhook/job boundary; already-linked media is skipped,
    // so a partial batch resumes instead of duplicating.
    await ctx.services.intake.storeMedia(outcome.inboundMessageId);
  }

  log.info(
    {
      status: outcome.status,
      duplicate: outcome.duplicate,
      changeOrderId: outcome.changeOrderId,
    },
    'inbound message processed',
  );
}

/**
 * Answers the sender.
 *
 * Sent even when intake reported a duplicate. A duplicate means the message was
 * already processed, but not necessarily that the reply reached anyone — a
 * crash between intake committing and this send leaves the employee waiting,
 * and on retry `handleInbound` reports the stored outcome as a duplicate. Given
 * the choice between a repeated reply and no reply, the product picks the
 * repeat: the employee is standing on a site waiting to know whether to start.
 */
export async function sendReply(
  phoneE164: string,
  reply: string,
  inboundMessageId: string,
  ctx: WorkerContext,
): Promise<void> {
  if (!reply.trim()) return;
  const gateway = ctx.app.integrations.whatsapp;
  if (!gateway.canDeliver) {
    ctx.logger.debug({ channel: gateway.channel }, 'gateway cannot deliver; no reply sent');
    return;
  }

  await gateway.send({
    to: { name: 'there', phoneE164, email: null },
    body: reply,
    purpose: 'INTAKE_REPLY',
    // Keyed on the message being answered, so a provider that honours it cannot
    // deliver two copies of the same reply — and two different messages (two
    // photos of an album, say) never share a key because their replies happen
    // to be the same length.
    idempotencyKey: `intake-reply:${inboundMessageId}`,
    organizationName: 'ExtraWork',
  });
}

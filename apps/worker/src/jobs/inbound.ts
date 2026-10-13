import { createHash } from 'node:crypto';
import { JOB_KINDS } from '@extrawork/contracts';
import { enqueueJob, newId, type WebhookEventRow } from '@extrawork/db';
import { systemTenantContext } from '@extrawork/domain';
import { StorageKeys } from '@extrawork/files';
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
 *  - it **fetches attachments**, but only once the sender is a known employee.
 *  - it **never fetches for a stranger**. `organizationId` is null exactly when
 *    the number matched no employee, and downloading in that case would let
 *    anyone holding the business number make this worker pull arbitrary bytes.
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
  // raising a second change request.
  const outcome = await ctx.services.intake.handleInbound({
    provider: event.provider,
    providerAccountId: event.providerAccountId,
    providerMessageId: message.providerMessageId,
    fromPhoneE164: message.fromPhoneE164,
    body: message.body,
    mediaCount: message.media.length,
  });

  // Reply first: media quarantine may be temporarily unavailable, but an
  // employee standing on site should still hear that the request was accepted.
  await sendReply(message.fromPhoneE164, outcome.reply, ctx);

  if (outcome.organizationId && message.media.length > 0) {
    // Failure stays retryable at the webhook/job boundary. Already-linked media
    // is skipped on retry, so a partial batch resumes instead of duplicating.
    await storeInboundMedia(message, outcome.inboundMessageId, outcome.organizationId, ctx);
  } else if (message.media.length > 0) {
    log.warn(
      { mediaCount: message.media.length },
      'discarding media from an unrecognised sender without fetching it',
    );
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
 * Answers the employee.
 *
 * Sent even when intake reported a duplicate. A duplicate means the message was
 * already processed, but not necessarily that the reply reached anyone — a
 * crash between intake committing and this send leaves the employee waiting,
 * and on retry `handleInbound` reports the stored outcome as a duplicate. Given
 * the choice between a repeated reply and no reply, the product picks the
 * repeat: the employee is standing on a site waiting to know whether to start.
 */
async function sendReply(phoneE164: string, reply: string, ctx: WorkerContext): Promise<void> {
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
    // deliver two copies of the same reply.
    idempotencyKey: `intake-reply:${phoneE164}:${reply.length}`,
    organizationName: 'ExtraWork',
  });
}

/**
 * Pulls each attachment into the existing quarantine pipeline.
 *
 * Nothing bespoke happens to these bytes: they land under the same quarantine
 * prefix as a composer upload and the same `SCAN_FILE` job validates magic
 * bytes, scans, strips EXIF and promotes them. That reuse is the point — a
 * second, parallel path for "files that arrived over WhatsApp" is how one of
 * the two ends up without a scan.
 */
async function storeInboundMedia(
  message: InboundMessageEvent,
  inboundMessageId: string,
  organizationId: string,
  ctx: WorkerContext,
): Promise<void> {
  const gateway = ctx.app.integrations.whatsapp;
  if (typeof gateway.fetchMedia !== 'function') {
    ctx.logger.debug({ channel: gateway.channel }, 'gateway cannot fetch media');
    return;
  }

  const tenant = systemTenantContext(organizationId, `intake-media:${inboundMessageId}`);
  const alreadyFetched = await ctx.repos.inboundMessages.linkedMediaIds(ctx.db, inboundMessageId);

  for (const ref of message.media) {
    if (alreadyFetched.has(ref.mediaId)) continue;

    const fetched = await gateway.fetchMedia(ref.mediaId, { maxBytes: ctx.env.MAX_UPLOAD_BYTES });

    // The provider caps its own uploads, but this is the boundary that protects
    // our storage, so it is enforced here rather than assumed upstream.
    if (fetched.byteSize > ctx.env.MAX_UPLOAD_BYTES) {
      ctx.logger.warn(
        { byteSize: fetched.byteSize, limit: ctx.env.MAX_UPLOAD_BYTES },
        'inbound attachment exceeds the upload limit; not stored',
      );
      continue;
    }

    const fileObjectId = newId();
    const filename = ref.filename ?? `whatsapp-${ref.mediaId}${extensionFor(fetched.mimeType)}`;
    const quarantineKey = StorageKeys.quarantine(organizationId, fileObjectId, filename);

    // Bytes first: a registered row pointing at an object that does not exist
    // would fail the scan job for a reason that has nothing to do with the file.
    await ctx.app.objectStore.put(quarantineKey, fetched.bytes, fetched.mimeType);

    await ctx.app.uow.transaction(async (tx) => {
      await ctx.repos.files.register(tx, tenant, {
        id: fileObjectId,
        // No project yet: intake may not have matched one, and a photo belongs
        // to the message regardless of whether the request was accepted.
        projectId: null,
        storageKey: quarantineKey,
        filename,
        declaredMimeType: fetched.mimeType,
        byteSize: BigInt(fetched.byteSize),
        purpose: 'INTAKE_MEDIA',
        // Our own digest of the bytes we actually received, never the
        // provider's claim about them.
        sha256: createHash('sha256').update(fetched.bytes).digest(),
      });
      await ctx.repos.files.markUploaded(tx, tenant, fileObjectId);
      await ctx.repos.inboundMessages.linkMedia(tx, {
        inboundMessageId,
        fileObjectId,
        organizationId,
        providerMediaId: ref.mediaId,
      });
      await enqueueJob(tx, {
        kind: JOB_KINDS.SCAN_FILE,
        organizationId,
        dedupeKey: `scan:${fileObjectId}`,
        payload: { fileObjectId, organizationId },
      });
    });

    ctx.logger.info(
      { fileObjectId, byteSize: fetched.byteSize },
      'inbound attachment quarantined and queued for scanning',
    );
  }
}

/** A best-effort extension so a downloaded file has a usable name. */
function extensionFor(mimeType: string): string {
  const known: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'video/mp4': '.mp4',
    'audio/ogg': '.ogg',
  };
  return known[mimeType.split(';')[0]?.trim() ?? ''] ?? '';
}

import { AppError } from '@extrawork/contracts';
import type {
  FetchedMedia,
  InboundMediaRef,
  InboundMessageEvent,
  MessageGateway,
  OutboundMessage,
  ProviderEvent,
  ProviderMessageRef,
} from '../gateways.js';
import { verifyMetaSignature } from '../webhooks/signature.js';

/**
 * WhatsApp — report §10.3.
 *
 * Phase 0 (this MVP) is native share: the backend prepares the URL and the
 * message text, and the contractor sends it from their own account. The system
 * records SHARE_INTENT_OPENED and must never claim MESSAGE_SENT, because it
 * genuinely cannot observe delivery.
 *
 * Phase 1 (Cloud API) is implemented behind the same interface but is inert
 * unless credentials are configured AND the organization holds the
 * `automatedWhatsApp` entitlement. Report §15.2 defers it until automation is
 * shown to improve conversion or retention.
 */

export class NativeShareWhatsAppGateway implements MessageGateway {
  readonly channel = 'WHATSAPP_NATIVE_SHARE';
  /** The decisive honesty flag: this gateway does not deliver anything. */
  readonly canDeliver = false;

  async send(command: OutboundMessage): Promise<ProviderMessageRef> {
    if (!command.to.phoneE164) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'A WhatsApp share needs the approver phone number.',
      });
    }
    // Nothing is transmitted. The caller opens the prepared deep link.
    return {
      provider: 'native-share',
      providerMessageId: null,
      status: 'SHARE_INTENT_PREPARED',
      detail: 'Message prepared for the contractor to send from their own WhatsApp account',
    };
  }

  verifyAndParse(): ProviderEvent[] {
    // No webhooks exist for native share.
    return [];
  }
}

export interface WhatsAppCloudOptions {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

/** Pre-approved utility templates named in report §10.3. */
export const WHATSAPP_TEMPLATES = {
  REQUEST: 'extra_work_request_v1',
  REMINDER: 'extra_work_reminder_v1',
  DECISION_RECEIPT: 'extra_work_decision_receipt_v1',
} as const;

/** Language code the templates are registered under. */
export const WHATSAPP_TEMPLATE_LANGUAGE = 'en';

/**
 * Builds the Graph API request body.
 *
 * Two shapes, and which one is used is not a preference:
 *
 *  - **template**, for a business-initiated message. WhatsApp refuses free-form
 *    text to a customer who has not messaged the business in the last 24 hours,
 *    so an approval request — which by definition arrives unprompted — has to
 *    be a template Meta has already reviewed.
 *  - **text**, for a reply inside that service window, such as answering an
 *    employee who just messaged in. A template there would be needless cost and
 *    needless review friction.
 *
 * Exported so a test can assert the payload shape without a live Graph API
 * call; that assertion is the only cheap way to catch a template payload that
 * Meta will reject, since the failure is otherwise a 400 in production.
 */
export function buildCloudApiPayload(command: OutboundMessage): Record<string, unknown> {
  const to = (command.to.phoneE164 ?? '').replace('+', '');

  if (!command.template) {
    return {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: command.body, preview_url: true },
    };
  }

  const components: Array<Record<string, unknown>> = [];
  if (command.template.bodyParameters.length > 0) {
    components.push({
      type: 'body',
      parameters: command.template.bodyParameters.map((text) => ({ type: 'text', text })),
    });
  }
  if (command.template.urlButtonParameter) {
    components.push({
      type: 'button',
      sub_type: 'url',
      // Index of the button within the approved template. There is exactly one
      // in `extra_work_request_v1`, so it is always the first.
      index: '0',
      parameters: [{ type: 'text', text: command.template.urlButtonParameter }],
    });
  }

  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: command.template.name,
      language: { code: command.template.languageCode },
      components,
    },
  };
}

export class WhatsAppCloudGateway implements MessageGateway {
  readonly channel = 'WHATSAPP_CLOUD_API';
  readonly canDeliver = true;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WhatsAppCloudOptions) {
    this.apiVersion = options.apiVersion ?? 'v21.0';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(command: OutboundMessage): Promise<ProviderMessageRef> {
    if (!command.to.phoneE164) {
      throw new AppError('VALIDATION_FAILED', { message: 'WhatsApp send needs a phone number.' });
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.options.phoneNumberId}/messages`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.accessToken}`,
        'Content-Type': 'application/json',
        // Provider idempotency keyed on the outbox event id (report §13.2).
        'Idempotency-Key': command.idempotencyKey,
      },
      body: JSON.stringify(buildCloudApiPayload(command)),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // 4xx other than 429 is permanent: report §7.6 says not to retry those.
      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
      throw new AppError(permanent ? 'VALIDATION_FAILED' : 'PROVIDER_UNAVAILABLE', {
        message: `WhatsApp Cloud API returned ${response.status}`,
        details: { status: response.status, detail: detail.slice(0, 500) },
      });
    }

    const body = (await response.json()) as { messages?: Array<{ id?: string }> };
    return {
      provider: 'whatsapp-cloud',
      providerMessageId: body.messages?.[0]?.id ?? null,
      status: 'ACCEPTED',
    };
  }

  /**
   * Report §10.3 webhook lifecycle: verify the raw-body signature BEFORE JSON
   * parsing, then normalise. Unknown shapes are preserved rather than dropped
   * (report §14.6).
   */
  verifyAndParse(raw: Buffer, headers: Record<string, string>): ProviderEvent[] {
    const signature = headers['x-hub-signature-256'];
    if (!verifyMetaSignature(raw, signature, this.options.appSecret)) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', { details: { provider: 'whatsapp-cloud' } });
    }

    const payload = JSON.parse(raw.toString('utf8')) as MetaWebhookPayload;
    const events: ProviderEvent[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const accountId = value?.metadata?.phone_number_id ?? entry.id ?? null;

        for (const status of value?.statuses ?? []) {
          events.push({
            provider: 'whatsapp-cloud',
            providerAccountId: accountId,
            providerEventId: `${status.id}:${status.status}:${status.timestamp}`,
            kind: 'MESSAGE_STATUS',
            occurredAt: status.timestamp ? new Date(Number(status.timestamp) * 1000) : null,
            normalized: {
              providerMessageId: status.id,
              status: mapDeliveryStatus(status.status),
              recipient: status.recipient_id,
              errorCode: status.errors?.[0]?.code ?? null,
            },
            raw: status,
          });
        }

        for (const message of value?.messages ?? []) {
          const normalized = normalizeInboundMessage(message);
          if (!normalized) continue;
          events.push({
            provider: 'whatsapp-cloud',
            providerAccountId: accountId,
            // The provider message id alone. Unlike a status — where the same id
            // legitimately arrives several times as delivery progresses — a
            // message is one event, and this id is what makes a redelivery
            // dedupe against `webhook_inbox` and `inbound_messages` alike.
            providerEventId: normalized.providerMessageId,
            kind: 'INBOUND_MESSAGE',
            occurredAt: message.timestamp ? new Date(Number(message.timestamp) * 1000) : null,
            normalized: normalized as unknown as Record<string, unknown>,
            raw: message,
          });
        }

        if (!value?.statuses?.length && !value?.messages?.length) {
          events.push({
            provider: 'whatsapp-cloud',
            providerAccountId: accountId,
            providerEventId: `${entry.id ?? 'unknown'}:${change.field ?? 'unknown'}:${payloadFingerprint(raw)}`,
            kind: 'UNKNOWN',
            occurredAt: null,
            normalized: { field: change.field ?? null },
            raw: change,
          });
        }
      }
    }

    return events;
  }

  /**
   * Fetches one attachment — two authenticated calls, because Graph returns a
   * short-lived, single-use URL rather than the bytes.
   *
   * The second call needs the bearer token too: the URL is on a Meta CDN host
   * but is not public, and omitting the header returns a 401 that reads like a
   * bad media id.
   */
  async fetchMedia(mediaId: string): Promise<FetchedMedia> {
    const auth = { Authorization: `Bearer ${this.options.accessToken}` };

    const lookup = await this.fetchImpl(
      `https://graph.facebook.com/${this.apiVersion}/${encodeURIComponent(mediaId)}`,
      { headers: auth, signal: AbortSignal.timeout(30_000) },
    );
    if (!lookup.ok) {
      throw new AppError('PROVIDER_UNAVAILABLE', {
        message: `WhatsApp media lookup returned ${lookup.status}`,
        details: { status: lookup.status },
      });
    }
    const meta = (await lookup.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!meta.url) {
      throw new AppError('PROVIDER_UNAVAILABLE', {
        message: 'WhatsApp media lookup returned no download URL',
      });
    }

    const download = await this.fetchImpl(meta.url, {
      headers: auth,
      signal: AbortSignal.timeout(60_000),
    });
    if (!download.ok) {
      throw new AppError('PROVIDER_UNAVAILABLE', {
        message: `WhatsApp media download returned ${download.status}`,
        details: { status: download.status },
      });
    }

    const bytes = Buffer.from(await download.arrayBuffer());
    return {
      bytes,
      // The provider's declared type is a hint only. The quarantine scanner
      // re-derives the real type from magic bytes before anything is promoted,
      // so a lie here cannot make a file servable.
      mimeType: meta.mime_type ?? 'application/octet-stream',
      byteSize: bytes.byteLength,
    };
  }
}

/**
 * Flattens one Meta message into the shape intake consumes.
 *
 * Media messages carry their text in `caption`, and an image with no caption
 * has no text at all — which the intake parser must see as an empty body rather
 * than as the word "undefined". A type nobody handles still returns an event so
 * the sender gets an answer instead of silence.
 *
 * Exported because `webhook_inbox` stores the **raw** provider object, not this
 * normalised one (report §14.6 keeps the original for forensics). The worker
 * therefore has to re-derive the normalised form when it processes the row, and
 * it must do so with this exact function: a second parser in the worker is how
 * `image.id` gets dropped on one path and not the other, which is precisely the
 * bug this comment exists to prevent recurring.
 */
export function parseMetaInboundMessage(input: unknown): InboundMessageEvent | null {
  if (!input || typeof input !== 'object') return null;
  return normalizeInboundMessage(input as MetaInboundMessage);
}

function normalizeInboundMessage(message: MetaInboundMessage): InboundMessageEvent | null {
  if (!message.id || !message.from) return null;

  const mediaField =
    message.image ?? message.document ?? message.video ?? message.audio ?? message.sticker ?? null;

  const media: InboundMediaRef[] = mediaField?.id
    ? [
        {
          mediaId: mediaField.id,
          mimeType: mediaField.mime_type ?? null,
          filename: mediaField.filename ?? null,
          caption: mediaField.caption ?? null,
          sha256: mediaField.sha256 ?? null,
        },
      ]
    : [];

  return {
    providerMessageId: message.id,
    // Meta reports `from` as digits with no `+`; every internal lookup is E.164.
    fromPhoneE164: message.from.startsWith('+') ? message.from : `+${message.from}`,
    body: message.text?.body ?? mediaField?.caption ?? '',
    media,
    messageType: message.type ?? 'unknown',
  };
}

/**
 * Ordering rule from report §10.3: "Ignore an older status if the provider
 * sequence would regress the internal state, but preserve the raw event."
 */
const STATUS_RANK: Record<string, number> = {
  ACCEPTED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
};

export function shouldApplyStatus(current: string, incoming: string): boolean {
  if (incoming === 'FAILED') return true;
  return (STATUS_RANK[incoming] ?? 0) > (STATUS_RANK[current] ?? 0);
}

function mapDeliveryStatus(providerStatus: string | undefined): string {
  switch (providerStatus) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return 'ACCEPTED';
  }
}

function payloadFingerprint(raw: Buffer): string {
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + (raw[i] as number)) | 0;
  }
  return String(hash >>> 0);
}

interface MetaMediaObject {
  id?: string;
  mime_type?: string;
  sha256?: string;
  filename?: string;
  caption?: string;
}

interface MetaInboundMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: MetaMediaObject;
  document?: MetaMediaObject;
  video?: MetaMediaObject;
  audio?: MetaMediaObject;
  sticker?: MetaMediaObject;
}

interface MetaWebhookPayload {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: MetaInboundMessage[];
        statuses?: Array<{
          id: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
          errors?: Array<{ code?: number }>;
        }>;
      };
    }>;
  }>;
}

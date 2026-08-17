import { AppError } from '@extrawork/contracts';
import type {
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
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: command.to.phoneE164.replace('+', ''),
        type: 'text',
        text: { body: command.body, preview_url: true },
      }),
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
        for (const status of value?.statuses ?? []) {
          events.push({
            provider: 'whatsapp-cloud',
            providerAccountId: value?.metadata?.phone_number_id ?? entry.id ?? null,
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
        if (!value?.statuses?.length) {
          events.push({
            provider: 'whatsapp-cloud',
            providerAccountId: value?.metadata?.phone_number_id ?? entry.id ?? null,
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

interface MetaWebhookPayload {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
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

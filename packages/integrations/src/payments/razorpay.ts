import { AppError } from '@extrawork/contracts';
import type {
  CreatePaymentCommand,
  PaymentGateway,
  PaymentOrderRef,
  ProviderEvent,
} from '../gateways.js';
import { verifyRazorpaySignature } from '../webhooks/signature.js';

/**
 * Razorpay deposit collection — report §10.4.
 *
 * Payments are optional deposits AFTER approval and never affect the validity
 * of the approval itself. The verified webhook is authoritative; the browser
 * callback is provisional. Handlers must be idempotent and tolerate out-of-order
 * delivery, which is why every event carries a stable provider event id for the
 * webhook inbox to dedupe on.
 */

export interface RazorpayOptions {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay';
  readonly available = true;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: RazorpayOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://api.razorpay.com/v1';
  }

  async createOrder(command: CreatePaymentCommand): Promise<PaymentOrderRef> {
    const auth = Buffer.from(`${this.options.keyId}:${this.options.keySecret}`).toString('base64');
    const response = await this.fetchImpl(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'X-Payment-Idempotency-Key': command.idempotencyKey,
      },
      body: JSON.stringify({
        // Razorpay amounts are already in the smallest currency unit.
        amount: Number(command.amountMinor),
        currency: command.currency,
        receipt: command.reference,
        notes: { description: command.description, customer: command.customerName },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
      throw new AppError(permanent ? 'VALIDATION_FAILED' : 'PROVIDER_UNAVAILABLE', {
        message: `Razorpay returned ${response.status}`,
        details: { status: response.status, detail: detail.slice(0, 500) },
      });
    }

    const body = (await response.json()) as { id: string; short_url?: string };
    return {
      provider: this.name,
      providerOrderId: body.id,
      checkoutUrl: body.short_url ?? null,
    };
  }

  verifyAndParse(raw: Buffer, headers: Record<string, string>): ProviderEvent[] {
    if (
      !verifyRazorpaySignature(raw, headers['x-razorpay-signature'], this.options.webhookSecret)
    ) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', { details: { provider: this.name } });
    }

    const payload = JSON.parse(raw.toString('utf8')) as RazorpayWebhook;
    const entity = payload.payload?.payment?.entity ?? payload.payload?.order?.entity;
    if (!entity) return [];

    return [
      {
        provider: this.name,
        providerAccountId: this.options.keyId,
        // `x-razorpay-event-id` is the provider's own dedupe key; fall back to
        // the entity id plus event name so dedupe still works without it.
        providerEventId: headers['x-razorpay-event-id'] ?? `${entity.id}:${payload.event}`,
        kind: 'PAYMENT_STATUS',
        occurredAt: payload.created_at ? new Date(payload.created_at * 1000) : null,
        normalized: {
          event: payload.event,
          providerOrderId: entity.order_id ?? entity.id,
          providerPaymentId: entity.order_id ? entity.id : null,
          status: mapPaymentStatus(payload.event),
          // Reconciliation compares these against the stored intent (report §10.4).
          amountMinor: entity.amount ?? null,
          currency: entity.currency ?? null,
        },
        raw: payload,
      },
    ];
  }
}

function mapPaymentStatus(event: string | undefined): string {
  switch (event) {
    case 'payment.captured':
    case 'order.paid':
      return 'PAID';
    case 'payment.failed':
      return 'FAILED';
    case 'refund.processed':
      return 'REFUNDED';
    case 'payment.authorized':
      return 'PENDING';
    default:
      return 'PENDING';
  }
}

/**
 * Report §10.4: the worker verifies amount and currency against the stored
 * intent before marking it paid. A mismatch is never silently accepted.
 */
export function verifyPaymentMatchesIntent(
  event: { amountMinor: number | null; currency: string | null },
  intent: { amountMinor: bigint; currency: string },
): { ok: boolean; reason: string | null } {
  if (event.amountMinor === null || event.currency === null) {
    return { ok: false, reason: 'Provider event did not include an amount or currency' };
  }
  if (BigInt(event.amountMinor) !== intent.amountMinor) {
    return {
      ok: false,
      reason: `Amount mismatch: provider ${event.amountMinor}, intent ${intent.amountMinor}`,
    };
  }
  if (event.currency.toUpperCase() !== intent.currency.toUpperCase()) {
    return {
      ok: false,
      reason: `Currency mismatch: provider ${event.currency}, intent ${intent.currency}`,
    };
  }
  return { ok: true, reason: null };
}

interface RazorpayWebhook {
  event?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: RazorpayEntity };
    order?: { entity?: RazorpayEntity };
  };
}

interface RazorpayEntity {
  id: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
}

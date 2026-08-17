import { AppError } from '@extrawork/contracts';

/**
 * Provider-facing interfaces — report §14.3 and §10.2.
 *
 * Every external system sits behind one of these. Report §10.1: "Each adapter
 * maps provider data into an internal normalized record so provider outages do
 * not corrupt domain state", and §5.2: adapters must not own domain decisions.
 */

export interface ProviderMessageRef {
  provider: string;
  providerMessageId: string | null;
  /** What the system can honestly claim happened. */
  status: 'SHARE_INTENT_PREPARED' | 'ACCEPTED' | 'SENT' | 'FAILED';
  detail?: string;
}

export interface ProviderEvent {
  provider: string;
  providerAccountId: string | null;
  providerEventId: string;
  kind: 'MESSAGE_STATUS' | 'PAYMENT_STATUS' | 'AUTH' | 'ESIGN' | 'UNKNOWN';
  occurredAt: Date | null;
  normalized: Record<string, unknown>;
  raw: unknown;
}

// --- Messaging --------------------------------------------------------------

export interface OutboundMessage {
  to: { phoneE164?: string | null; email?: string | null; name: string };
  subject?: string;
  body: string;
  purpose: 'REQUEST' | 'REMINDER' | 'DECISION_RECEIPT' | 'OTP';
  /** Provider idempotency key; the outbox event id (report §13.2). */
  idempotencyKey: string;
  organizationName: string;
}

export interface MessageGateway {
  readonly channel: string;
  readonly canDeliver: boolean;
  send(command: OutboundMessage): Promise<ProviderMessageRef>;
  verifyAndParse(raw: Buffer, headers: Record<string, string>): ProviderEvent[];
}

// --- OTP --------------------------------------------------------------------

export interface OtpDeliveryCommand {
  phoneE164: string;
  code: string;
  organizationName: string;
  ttlSeconds: number;
}

export interface OtpGateway {
  readonly name: string;
  readonly available: boolean;
  deliver(command: OtpDeliveryCommand): Promise<ProviderMessageRef>;
}

// --- Payments ---------------------------------------------------------------

export interface CreatePaymentCommand {
  amountMinor: bigint;
  currency: string;
  reference: string;
  description: string;
  customerName: string;
  customerContact: { phoneE164?: string | null; email?: string | null };
  idempotencyKey: string;
}

export interface PaymentOrderRef {
  provider: string;
  providerOrderId: string;
  checkoutUrl: string | null;
}

export interface PaymentGateway {
  readonly name: string;
  readonly available: boolean;
  createOrder(command: CreatePaymentCommand): Promise<PaymentOrderRef>;
  verifyAndParse(raw: Buffer, headers: Record<string, string>): ProviderEvent[];
}

// --- E-signature (A2) -------------------------------------------------------

export interface ESignGateway {
  readonly name: string;
  readonly available: boolean;
  createCeremony(command: { documentSha256: string; signerName: string }): Promise<never>;
  verifyAndParse(raw: Buffer, headers: Record<string, string>): ProviderEvent[];
}

/**
 * Report §15.2 defers A2 e-signature. The interface exists so the capability can
 * be added later; the driver refuses loudly rather than silently downgrading
 * assurance, which report §13.1 explicitly forbids.
 */
export class UnavailableESignGateway implements ESignGateway {
  readonly name = 'none';
  readonly available = false;

  async createCeremony(): Promise<never> {
    throw new AppError('ASSURANCE_UNAVAILABLE', {
      message:
        'Licensed electronic signature (A2) is not part of this release. ' +
        'Reissue the request at a supported assurance level.',
    });
  }

  verifyAndParse(): ProviderEvent[] {
    return [];
  }
}

export class DisabledPaymentGateway implements PaymentGateway {
  readonly name = 'disabled';
  readonly available = false;

  async createOrder(): Promise<PaymentOrderRef> {
    throw new AppError('NOT_IMPLEMENTED', {
      message: 'Online deposit collection is not enabled for this organization.',
    });
  }

  verifyAndParse(): ProviderEvent[] {
    return [];
  }
}

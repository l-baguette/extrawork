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
  /** Concrete sender account/phone-number id when the provider has one. */
  providerAccountId?: string | null;
  providerMessageId: string | null;
  /** What the system can honestly claim happened. */
  status: 'SHARE_INTENT_PREPARED' | 'ACCEPTED' | 'SENT' | 'FAILED';
  detail?: string;
}

export interface ProviderEvent {
  provider: string;
  providerAccountId: string | null;
  providerEventId: string;
  kind: 'MESSAGE_STATUS' | 'INBOUND_MESSAGE' | 'PAYMENT_STATUS' | 'AUTH' | 'ESIGN' | 'UNKNOWN';
  occurredAt: Date | null;
  normalized: Record<string, unknown>;
  raw: unknown;
}

/** One attachment on an inbound message, before its bytes are fetched. */
export interface InboundMediaRef {
  /** Provider handle; the bytes are a separate authenticated fetch. */
  mediaId: string;
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
  /** Provider-declared digest, where one is given. Never trusted as the real one. */
  sha256: string | null;
}

/**
 * A message a person sent to the business, normalised out of the provider
 * envelope. This is the shape `IntakeService.handleInbound` consumes, so the
 * adapter — not the domain — owns every provider quirk (report §10.1).
 */
export interface InboundMessageEvent {
  providerMessageId: string;
  /** Sender in E.164. Providers omit the `+`; the adapter restores it. */
  fromPhoneE164: string;
  /** Text body, or the caption when the message is media with no text. */
  body: string;
  media: InboundMediaRef[];
  /** Provider message type, kept so an unsupported kind can be answered. */
  messageType: string;
}

/** Bytes fetched for one inbound attachment. */
export interface FetchedMedia {
  bytes: Buffer;
  mimeType: string;
  byteSize: number;
}

// --- Messaging --------------------------------------------------------------

/**
 * A pre-approved provider template and its substitutions.
 *
 * WhatsApp only permits a business-initiated message outside the 24-hour
 * service window if it uses a template Meta has already reviewed, so a request
 * to a customer who has not messaged first cannot be plain text. Replies inside
 * the window still can, which is why this is optional rather than replacing
 * `body`.
 */
export interface OutboundTemplate {
  /** Approved template name, e.g. `extra_work_request_v1`. */
  name: string;
  /** Language code exactly as registered with the provider, e.g. `en`. */
  languageCode: string;
  /** Ordered `{{1}}..{{n}}` body substitutions. */
  bodyParameters: string[];
  /**
   * Dynamic suffix for a URL button, when the approved template carries one.
   * Meta only allows the trailing portion of the URL to vary, so this is the
   * token, never the whole link.
   */
  urlButtonParameter?: string;
}

export interface OutboundMessage {
  to: { phoneE164?: string | null; email?: string | null; name: string };
  subject?: string;
  /**
   * The human-readable message. Always present, even when `template` is set:
   * it is what the email gateway sends, what the simulator writes to its
   * outbox, and the record of what the customer was actually shown. A template
   * send is the same message through a different transport, not a different
   * message.
   */
  body: string;
  /**
   * Set for business-initiated sends that must go out as an approved template.
   * Gateways that cannot send templates ignore it and use `body`.
   */
  template?: OutboundTemplate;
  /**
   * `INTAKE_REPLY` is the answer to an employee who just messaged in. It is
   * deliberately absent from the `messages` table's purpose check: direct
   * intake replies already have a home in `inbound_messages.reply_text`, next
   * to the message they answer. Recording them twice would put the same fact in
   * two places that can disagree.
   */
  purpose: 'REQUEST' | 'REMINDER' | 'DECISION_RECEIPT' | 'OTP' | 'INTAKE_REPLY';
  /** Provider idempotency key; the outbox event id (report §13.2). */
  idempotencyKey: string;
  organizationName: string;
}

export interface MessageGateway {
  readonly channel: string;
  readonly canDeliver: boolean;
  send(command: OutboundMessage): Promise<ProviderMessageRef>;
  verifyAndParse(raw: Buffer, headers: Record<string, string>): ProviderEvent[];
  /**
   * Fetches one inbound attachment's bytes. Optional because only a gateway
   * with a real provider behind it can: native share and the simulator never
   * receive media, so requiring it would force them to implement a throw.
   *
   * Callers must treat its absence as "no media pipeline on this driver" rather
   * than as an error.
   */
  fetchMedia?(mediaId: string, options?: { maxBytes?: number }): Promise<FetchedMedia>;
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

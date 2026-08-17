import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '@extrawork/contracts';
import type {
  MessageGateway,
  OutboundMessage,
  ProviderEvent,
  ProviderMessageRef,
} from '../gateways.js';

/**
 * A WhatsApp gateway that delivers nowhere and records everything.
 *
 * The point is to make the entire intake flow — employee texts in, customer
 * gets a link, both get told what happened — runnable today, with no Meta
 * Business Account, no template approval and no per-message cost. Swapping to
 * the real Cloud API is an environment-variable change, because both drivers
 * satisfy the same `MessageGateway`.
 *
 * `canDeliver` is **true**, unlike the native-share driver. That flag answers
 * "did this system transmit the message?", and here the answer is genuinely
 * yes — it went to a file the operator can read. Marking it false would make
 * the flow behave as though nothing was sent, which is precisely the behaviour
 * being simulated away. What the simulator must never do is claim delivery to a
 * real handset: every record is stamped `simulated: true`, and the outbox lives
 * under `.data/` so it can never be mistaken for a provider receipt.
 */
export interface SimulatorOptions {
  /** Directory for `outbox.jsonl`. Defaults to `./.data/whatsapp`. */
  outboxDir?: string;
  /** Injectable for tests that assert timestamps. */
  now?: () => Date;
}

/** One line of `outbox.jsonl`. */
export interface SimulatedOutboundRecord {
  id: string;
  simulated: true;
  sentAt: string;
  to: string | null;
  toName: string;
  purpose: OutboundMessage['purpose'];
  organizationName: string;
  body: string;
  idempotencyKey: string;
}

export class SimulatorWhatsAppGateway implements MessageGateway {
  readonly channel = 'WHATSAPP_SIMULATOR';
  readonly canDeliver = true;

  private readonly outboxPath: string;
  private readonly now: () => Date;
  /** Serialises appends so two concurrent sends cannot interleave a line. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: SimulatorOptions = {}) {
    this.outboxPath = join(options.outboxDir ?? './.data/whatsapp', 'outbox.jsonl');
    this.now = options.now ?? (() => new Date());
  }

  async send(command: OutboundMessage): Promise<ProviderMessageRef> {
    if (!command.to.phoneE164) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'A WhatsApp message needs a phone number.',
      });
    }

    const record: SimulatedOutboundRecord = {
      id: randomUUID(),
      simulated: true,
      sentAt: this.now().toISOString(),
      to: command.to.phoneE164,
      toName: command.to.name,
      purpose: command.purpose,
      organizationName: command.organizationName,
      body: command.body,
      idempotencyKey: command.idempotencyKey,
    };

    await this.append(record);

    return {
      provider: 'whatsapp-simulator',
      providerMessageId: record.id,
      status: 'SENT',
      detail: 'Recorded to the simulator outbox; no message left this machine',
    };
  }

  /**
   * The simulator has no signed webhook — inbound messages are injected through
   * a development-only route that already knows they are trusted. Returning an
   * empty list keeps it honest: this driver never parses a provider callback.
   */
  verifyAndParse(): ProviderEvent[] {
    return [];
  }

  /** Everything recorded so far, newest last. Used by the simulator UI. */
  async readOutbox(limit = 100): Promise<SimulatedOutboundRecord[]> {
    let contents: string;
    try {
      contents = await readFile(this.outboxPath, 'utf8');
    } catch {
      return [];
    }

    const records: SimulatedOutboundRecord[] = [];
    for (const line of contents.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as SimulatedOutboundRecord);
      } catch {
        // A truncated final line is expected if a write was interrupted; the
        // outbox is a debugging aid, so skip it rather than failing the read.
      }
    }
    return records.slice(-limit);
  }

  /**
   * Appends one JSON line. Writes are chained rather than concurrent: two
   * `appendFile` calls racing on the same handle can interleave partial lines,
   * and a corrupt outbox is confusing in exactly the situation it exists to
   * clarify.
   */
  private append(record: SimulatedOutboundRecord): Promise<void> {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.outboxPath), { recursive: true });
        await appendFile(this.outboxPath, `${JSON.stringify(record)}\n`, 'utf8');
      });
    return this.writeChain;
  }
}

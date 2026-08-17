import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@extrawork/contracts';
import type {
  MessageGateway,
  OutboundMessage,
  ProviderEvent,
  ProviderMessageRef,
} from '../gateways.js';

/**
 * Email fallback — report §6.8 and §13.1: when native WhatsApp launch fails,
 * Copy link, Share sheet, SMS and email remain available.
 *
 * Three drivers: `console` (logs), `file` (writes .eml so a developer or a test
 * can actually read the approval link), and `smtp` (real delivery). The
 * production config guard rejects the first two.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  from: string;
}

export interface EmailDriver {
  readonly name: string;
  deliver(message: EmailMessage): Promise<{ messageId: string | null }>;
}

export class ConsoleEmailDriver implements EmailDriver {
  readonly name = 'console';
  constructor(
    private readonly log: (line: string) => void = (l) => process.stdout.write(`${l}\n`),
  ) {}

  async deliver(message: EmailMessage): Promise<{ messageId: string | null }> {
    this.log(
      [
        '',
        '─── email ───',
        `to: ${message.to}`,
        `subject: ${message.subject}`,
        '',
        message.text,
        '─────────────',
        '',
      ].join('\n'),
    );
    return { messageId: null };
  }
}

/**
 * Writes RFC-822 files to a directory. This is what makes the local end-to-end
 * flow real: the test or the developer opens the .eml and follows the link,
 * rather than the code pretending an email was sent.
 */
export class FileEmailDriver implements EmailDriver {
  readonly name = 'file';
  constructor(private readonly directory: string) {}

  async deliver(message: EmailMessage): Promise<{ messageId: string | null }> {
    await mkdir(this.directory, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const filename = path.join(this.directory, `${id}.eml`);
    const content = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${id}@extrawork.local>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
    ].join('\r\n');
    await writeFile(filename, content, 'utf8');
    return { messageId: id };
  }
}

export class SmtpEmailDriver implements EmailDriver {
  readonly name = 'smtp';
  constructor(private readonly smtpUrl: string) {}

  async deliver(message: EmailMessage): Promise<{ messageId: string | null }> {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport(this.smtpUrl);
    try {
      const result = await transport.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return { messageId: result.messageId ?? null };
    } catch (error) {
      throw new AppError('PROVIDER_UNAVAILABLE', {
        message: 'The email provider could not accept the message.',
        cause: error,
      });
    } finally {
      transport.close();
    }
  }
}

export class EmailGateway implements MessageGateway {
  readonly channel = 'EMAIL';
  readonly canDeliver = true;

  constructor(
    private readonly driver: EmailDriver,
    private readonly from: string,
  ) {}

  async send(command: OutboundMessage): Promise<ProviderMessageRef> {
    if (!command.to.email) {
      throw new AppError('VALIDATION_FAILED', {
        message: 'This contact has no email address on file.',
      });
    }
    const result = await this.driver.deliver({
      to: command.to.email,
      from: this.from,
      subject: command.subject ?? `Update from ${command.organizationName}`,
      text: command.body,
    });
    return {
      provider: `email:${this.driver.name}`,
      providerMessageId: result.messageId,
      status: 'SENT',
    };
  }

  verifyAndParse(): ProviderEvent[] {
    // Bounce/complaint webhooks belong to a specific ESP; none is configured in
    // the MVP, so there is nothing to verify here yet.
    return [];
  }
}

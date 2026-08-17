import { maskPhone } from '@extrawork/domain';
import type { OtpDeliveryCommand, OtpGateway, ProviderMessageRef } from './gateways.js';

/**
 * OTP delivery for A1 assurance — report §3.3 and §10.2.
 *
 * The code never enters a log line: the console driver prints only the masked
 * destination and a marker, and the real driver hands the code straight to the
 * provider. Report §11.5: "OTP delivery/verification without logging code."
 */

export class ConsoleOtpGateway implements OtpGateway {
  readonly name = 'console';
  readonly available = true;

  /**
   * Local development only. `onCode` lets a test read the code without it ever
   * reaching stdout or a log file.
   */
  constructor(private readonly onCode?: (phoneE164: string, code: string) => void) {}

  async deliver(command: OtpDeliveryCommand): Promise<ProviderMessageRef> {
    this.onCode?.(command.phoneE164, command.code);
    process.stdout.write(
      `[otp] a verification code was issued for ${maskPhone(command.phoneE164)} ` +
        `(valid ${command.ttlSeconds}s) — code withheld from logs\n`,
    );
    return { provider: 'console', providerMessageId: null, status: 'SENT' };
  }
}

/**
 * Sends the OTP through whatever message gateway the organization has. Report
 * §13.1: if the provider is unavailable, A1 shows "verification unavailable"
 * and does NOT silently downgrade — that decision is made by the assurance
 * engine, which reads `available`.
 */
export class MessageGatewayOtpGateway implements OtpGateway {
  readonly name: string;
  readonly available: boolean;

  constructor(
    private readonly send: (command: {
      phoneE164: string;
      body: string;
      idempotencyKey: string;
      organizationName: string;
    }) => Promise<ProviderMessageRef>,
    name: string,
    available: boolean,
  ) {
    this.name = name;
    this.available = available;
  }

  async deliver(command: OtpDeliveryCommand): Promise<ProviderMessageRef> {
    const minutes = Math.max(1, Math.round(command.ttlSeconds / 60));
    return this.send({
      phoneE164: command.phoneE164,
      organizationName: command.organizationName,
      idempotencyKey: `otp:${command.phoneE164}:${Date.now()}`,
      body:
        `${command.code} is your verification code for approving a change from ` +
        `${command.organizationName}. It expires in ${minutes} minute${minutes === 1 ? '' : 's'}. ` +
        `Do not share this code with anyone.`,
    });
  }
}

/** Used when the organization is not entitled to A1 or no provider exists. */
export class UnavailableOtpGateway implements OtpGateway {
  readonly name = 'none';
  readonly available = false;

  async deliver(): Promise<ProviderMessageRef> {
    return {
      provider: 'none',
      providerMessageId: null,
      status: 'FAILED',
      detail: 'No OTP provider is configured',
    };
  }
}

import { describe, expect, it } from 'vitest';
import { MessageGatewayOtpGateway } from '@extrawork/integrations';

/**
 * A1 phone verification must never silently become A0.
 *
 * Report §13.1 is explicit: when the provider cannot deliver, the customer is
 * shown "verification unavailable" rather than being quietly dropped to a
 * weaker assurance level they did not agree to. The assurance engine decides
 * that by reading `available`, so a gateway wrapping a transport that cannot
 * deliver has to say so — accepting the code and dropping it would produce an
 * approval recorded as phone-verified when no phone was ever verified.
 */

function gateway(canDeliver: boolean, sent: unknown[] = []) {
  return new MessageGatewayOtpGateway(
    async (command) => {
      sent.push(command);
      return { provider: 'test', providerMessageId: 'm1', status: 'SENT' as const };
    },
    'WHATSAPP_CLOUD_API',
    canDeliver,
  );
}

describe('A1 OTP over the message gateway', () => {
  it('reports unavailable when the transport cannot deliver', () => {
    // Native share and the unconfigured Cloud API both land here.
    expect(gateway(false).available).toBe(false);
  });

  it('reports available when the transport can', () => {
    expect(gateway(true).available).toBe(true);
  });

  it('passes the bare code through, not only the rendered sentence', async () => {
    // An AUTHENTICATION template takes the code as its sole parameter and
    // renders the sentence itself, so a gateway handed only prose cannot make
    // a compliant send.
    const sent: Array<Record<string, unknown>> = [];
    await gateway(true, sent).deliver({
      phoneE164: '+919876543210',
      code: '481920',
      organizationName: 'Shree Interiors',
      ttlSeconds: 300,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.code).toBe('481920');
    expect(sent[0]?.ttlSeconds).toBe(300);
  });

  it('still renders a human-readable body for transports without templates', async () => {
    const sent: Array<Record<string, unknown>> = [];
    await gateway(true, sent).deliver({
      phoneE164: '+919876543210',
      code: '481920',
      organizationName: 'Shree Interiors',
      ttlSeconds: 300,
    });

    const body = String(sent[0]?.body);
    expect(body).toContain('481920');
    expect(body).toContain('Shree Interiors');
    // The one instruction that matters on an OTP message.
    expect(body).toMatch(/do not share/i);
  });

  it('keys each delivery separately so a resend is a new message', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const g = gateway(true, sent);
    const cmd = {
      phoneE164: '+919876543210',
      code: '481920',
      organizationName: 'Shree Interiors',
      ttlSeconds: 300,
    };
    await g.deliver(cmd);
    await new Promise((r) => setTimeout(r, 2));
    await g.deliver({ ...cmd, code: '222333' });

    expect(sent[0]?.idempotencyKey).not.toBe(sent[1]?.idempotencyKey);
  });
});

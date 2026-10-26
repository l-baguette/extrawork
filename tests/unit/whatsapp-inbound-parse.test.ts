import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WhatsAppCloudGateway, type InboundMessageEvent } from '@extrawork/integrations';

/**
 * Parsing a message a person sent to the business number — report §10.3.
 *
 * The adapter is the only place that should know a provider quirk, so each of
 * these is a quirk being absorbed here rather than leaking into intake:
 * Meta reports the sender without a `+`, puts a media message's text in
 * `caption` rather than `text.body`, and batches messages and delivery receipts
 * into the same envelope.
 */

const APP_SECRET = 'unit-test-app-secret';

const gateway = new WhatsAppCloudGateway({
  phoneNumberId: '111111111111111',
  accessToken: 'unit-test-token',
  appSecret: APP_SECRET,
});

function parse(value: unknown) {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-1', changes: [{ field: 'messages', value }] }],
  });
  const raw = Buffer.from(body, 'utf8');
  const signature = createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  return gateway.verifyAndParse(raw, { 'x-hub-signature-256': `sha256=${signature}` });
}

function textMessage(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { phone_number_id: '111111111111111' },
    messages: [
      {
        id: 'wamid.INBOUND001',
        from: '919876543210',
        timestamp: '1755400000',
        type: 'text',
        text: { body: 'Project: Tower 4\nWhat: Two extra power points\nCost: 15800\nDays: 2' },
        ...overrides,
      },
    ],
  };
}

function inboundOf(events: ReturnType<typeof parse>): InboundMessageEvent[] {
  return events
    .filter((e) => e.kind === 'INBOUND_MESSAGE')
    .map((e) => e.normalized as unknown as InboundMessageEvent);
}

describe('inbound message parsing', () => {
  it('normalises a text message into the intake input', () => {
    const [message] = inboundOf(parse(textMessage()));

    expect(message?.providerMessageId).toBe('wamid.INBOUND001');
    // Meta omits the plus; every internal lookup is E.164 and an exact string
    // match, so a missing one means the employee resolves to nobody.
    expect(message?.fromPhoneE164).toBe('+919876543210');
    expect(message?.body).toContain('Tower 4');
    expect(message?.media).toHaveLength(0);
  });

  it('does not double the plus when the provider already sent one', () => {
    const [message] = inboundOf(parse(textMessage({ from: '+919876543210' })));
    expect(message?.fromPhoneE164).toBe('+919876543210');
  });

  it('reads an image caption as the message body', () => {
    const [message] = inboundOf(
      parse(
        textMessage({
          type: 'image',
          text: undefined,
          image: {
            id: 'media-1',
            mime_type: 'image/jpeg',
            sha256: 'abc',
            caption: 'Extra power points, Tower 4, 15800, 2',
          },
        }),
      ),
    );

    expect(message?.body).toBe('Extra power points, Tower 4, 15800, 2');
    expect(message?.media).toEqual([
      {
        mediaId: 'media-1',
        mimeType: 'image/jpeg',
        filename: null,
        caption: 'Extra power points, Tower 4, 15800, 2',
        sha256: 'abc',
      },
    ]);
  });

  it('yields an empty body rather than undefined for a captionless photo', () => {
    // Intake parses this string; `undefined` would reach the parser as the word
    // "undefined" and be read as a description.
    const [message] = inboundOf(
      parse(
        textMessage({
          type: 'image',
          text: undefined,
          image: { id: 'media-2', mime_type: 'image/jpeg' },
        }),
      ),
    );

    expect(message?.body).toBe('');
    expect(message?.media[0]?.mediaId).toBe('media-2');
  });

  it('still surfaces a type nobody handles, so the sender gets an answer', () => {
    const events = parse(
      textMessage({ type: 'location', text: undefined, location: { latitude: 1, longitude: 2 } }),
    );
    const [message] = inboundOf(events);

    expect(message?.messageType).toBe('location');
    expect(message?.body).toBe('');
  });

  it('keeps messages and delivery receipts as separate events', () => {
    const events = parse({
      metadata: { phone_number_id: '111111111111111' },
      messages: [
        {
          id: 'wamid.INBOUND003',
          from: '919876543210',
          timestamp: '1755400000',
          type: 'text',
          text: { body: 'help' },
        },
      ],
      statuses: [
        { id: 'wamid.OUT001', status: 'delivered', timestamp: '1755400001', recipient_id: '9199' },
      ],
    });

    expect(events.filter((e) => e.kind === 'INBOUND_MESSAGE')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'MESSAGE_STATUS')).toHaveLength(1);
    // Neither may be classified as unknown, or the worker preserves-and-warns
    // instead of acting.
    expect(events.some((e) => e.kind === 'UNKNOWN')).toBe(false);
  });

  it('uses the message id alone as the event key', () => {
    // A status legitimately repeats its id as delivery progresses, so its key
    // includes the status and timestamp. A message arrives once, and keying it
    // on anything mutable would let a redelivery through as a new event.
    const [event] = parse(textMessage()).filter((e) => e.kind === 'INBOUND_MESSAGE');
    expect(event?.providerEventId).toBe('wamid.INBOUND001');
  });

  it('rejects an unsigned payload before parsing anything', () => {
    const raw = Buffer.from(JSON.stringify({ entry: [] }), 'utf8');
    expect(() => gateway.verifyAndParse(raw, { 'x-hub-signature-256': 'sha256=deadbeef' })).toThrow(
      /signature/i,
    );
  });
});

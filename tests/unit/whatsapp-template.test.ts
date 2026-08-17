import { describe, expect, it } from 'vitest';
import { buildRequestTemplateParameters, type ShareMessageInput } from '@extrawork/domain';
import {
  WHATSAPP_TEMPLATES,
  WHATSAPP_TEMPLATE_LANGUAGE,
  buildCloudApiPayload,
  type OutboundMessage,
} from '@extrawork/integrations';

/**
 * The Cloud API request body — report §10.3.
 *
 * Every rule asserted here is one Meta enforces by returning a 400 for the
 * whole send. Without these, the first time any of them is discovered is a
 * customer not receiving an approval request in production, with a provider
 * error code as the only clue. They are cheap because none of them needs a
 * live Graph API call.
 */

const BASE: ShareMessageInput = {
  organizationName: 'Shree Interiors',
  customerFirstName: 'Priya',
  projectTitle: 'Tower 4',
  changeNumber: 'CO-0007',
  totalDeltaMinor: 1_580_000n,
  currency: 'INR',
  scheduleDeltaDays: 2,
  approvalUrl: 'https://extrawork.example/r/abcdef',
  expiresAt: new Date('2026-09-01T10:00:00Z'),
  timezone: 'Asia/Kolkata',
  organizationPhone: '+919876543210',
};

function outbound(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    to: { name: 'Priya Mehta', phoneE164: '+919876543210', email: null },
    body: 'plain text rendering',
    purpose: 'REQUEST',
    idempotencyKey: 'request:v1',
    organizationName: 'Shree Interiors',
    ...overrides,
  };
}

describe('extra_work_request_v1 parameters', () => {
  it('emits the seven documented substitutions in order', () => {
    const params = buildRequestTemplateParameters(BASE);

    expect(params).toHaveLength(7);
    expect(params[0]).toBe('Priya');
    expect(params[1]).toBe('Shree Interiors');
    expect(params[2]).toBe('Tower 4');
    expect(params[3]).toContain('15,800');
    expect(params[4]).toBe('https://extrawork.example/r/abcdef');
    expect(params[5]).toContain('2026');
    expect(params[6]).toBe('+919876543210');
  });

  it('never emits a newline, tab or run of spaces', () => {
    // A project title pasted from a spreadsheet is the realistic source of this,
    // and Meta rejects the entire send rather than the offending parameter.
    const params = buildRequestTemplateParameters({
      ...BASE,
      projectTitle: 'Tower 4\n\tPenthouse     block',
      organizationName: 'Shree\r\nInteriors',
    });

    for (const value of params) {
      expect(value).not.toMatch(/[\n\r\t]/);
      expect(value).not.toMatch(/ {5}/);
    }
    expect(params[2]).toBe('Tower 4 Penthouse block');
  });

  it('never emits an empty parameter', () => {
    // Meta rejects an empty substitution, so every field needs a fallback even
    // when the underlying record is blank.
    const params = buildRequestTemplateParameters({
      ...BASE,
      customerFirstName: '   ',
      projectTitle: '',
      organizationPhone: null,
    });

    for (const value of params) expect(value.length).toBeGreaterThan(0);
  });

  it('renders a deduction without a stray minus sign', () => {
    const params = buildRequestTemplateParameters({ ...BASE, totalDeltaMinor: -500_000n });
    expect(params[3]).not.toContain('-');
  });
});

describe('cloud api payload', () => {
  it('sends plain text when no template is set', () => {
    const payload = buildCloudApiPayload(outbound());

    expect(payload.type).toBe('text');
    expect(payload.template).toBeUndefined();
    expect(payload.to).toBe('919876543210');
  });

  it('strips the leading plus from the recipient', () => {
    // Graph rejects a `+`-prefixed recipient.
    expect(buildCloudApiPayload(outbound()).to).toBe('919876543210');
  });

  it('sends an approved template with body parameters when one is set', () => {
    const payload = buildCloudApiPayload(
      outbound({
        template: {
          name: WHATSAPP_TEMPLATES.REQUEST,
          languageCode: WHATSAPP_TEMPLATE_LANGUAGE,
          bodyParameters: buildRequestTemplateParameters(BASE),
        },
      }),
    );

    expect(payload.type).toBe('template');
    const template = payload.template as {
      name: string;
      language: { code: string };
      components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }>;
    };
    expect(template.name).toBe('extra_work_request_v1');
    expect(template.language.code).toBe('en');

    const body = template.components.find((c) => c.type === 'body');
    expect(body?.parameters).toHaveLength(7);
    // Meta requires each substitution to be a typed object, not a bare string.
    expect(body?.parameters[0]).toEqual({ type: 'text', text: 'Priya' });
    // No button in the body-parameter variant of the template.
    expect(template.components.some((c) => c.type === 'button')).toBe(false);
  });

  it('adds a url button component when the approved template carries one', () => {
    const payload = buildCloudApiPayload(
      outbound({
        template: {
          name: WHATSAPP_TEMPLATES.REQUEST,
          languageCode: WHATSAPP_TEMPLATE_LANGUAGE,
          bodyParameters: ['Priya'],
          urlButtonParameter: 'abcdef',
        },
      }),
    );

    const template = payload.template as {
      components: Array<{ type: string; sub_type?: string; index?: string; parameters: unknown[] }>;
    };
    const button = template.components.find((c) => c.type === 'button');
    expect(button).toMatchObject({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: 'abcdef' }],
    });
  });
});

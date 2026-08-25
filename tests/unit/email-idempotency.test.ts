import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmailGateway, FileEmailDriver } from '@extrawork/integrations';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'extrawork-email-idempotency-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('email retry identity', () => {
  it('reuses one RFC Message-ID and outbox file for the same delivery intent', async () => {
    const gateway = new EmailGateway(new FileEmailDriver(directory), 'notices@example.test');
    const command = {
      to: { name: 'Customer', email: 'customer@example.test', phoneE164: null },
      subject: 'Decision receipt',
      body: 'Your decision was recorded.',
      purpose: 'DECISION_RECEIPT' as const,
      idempotencyKey: 'receipt:stable-delivery-id',
      organizationName: 'Example Contractor',
    };

    const first = await gateway.send(command);
    const second = await gateway.send(command);
    const files = await readdir(directory);

    expect(second.providerMessageId).toBe(first.providerMessageId);
    expect(files).toHaveLength(1);
    const email = await readFile(join(directory, files[0] as string), 'utf8');
    expect(email).toContain(`Message-ID: <${first.providerMessageId}@extrawork.local>`);
  });
});

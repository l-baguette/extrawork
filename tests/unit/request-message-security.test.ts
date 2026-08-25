import { describe, expect, it } from 'vitest';
import type { JobRow } from '@extrawork/db';
import { encryptApprovalUrl } from '@extrawork/domain';
import type { WorkerContext } from '../../apps/worker/src/context.js';
import { sendRequestMessage } from '../../apps/worker/src/jobs/messaging.js';

const organizationId = '019fffbd-ccf5-7523-afba-720f39b990da';
const versionId = '019fffbd-ccf5-7523-afba-720f39b990db';
const secret = 'unit-approval-link-secret-unit-approval-link-0001';

function job(payload: Record<string, unknown>): JobRow {
  return {
    id: '019fffbd-ccf5-7523-afba-720f39b990dc',
    organizationId,
    kind: 'send_request_message',
    payload,
    attemptCount: 1,
    maxAttempts: 6,
    dedupeKey: 'request:test',
    createdAt: new Date('2026-08-18T00:00:00Z'),
  };
}

const context = {
  env: { APPROVAL_LINK_ENCRYPTION_SECRET: secret },
} as unknown as WorkerContext;

describe('request-message approval link boundary', () => {
  it('fails closed when an automated delivery has no encrypted link', async () => {
    await expect(
      sendRequestMessage(job({ versionId, channel: 'EMAIL' }), context),
    ).rejects.toMatchObject({ code: 'APPROVAL_LINK_MISSING' });
  });

  it('fails closed when ciphertext is modified', async () => {
    const sealed = encryptApprovalUrl('https://app.example.com/r/private', secret, {
      organizationId,
      versionId,
    });
    const parts = sealed.split('.');
    const ciphertext = parts[2]!;
    parts[2] = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;

    await expect(
      sendRequestMessage(
        job({ versionId, channel: 'EMAIL', approvalUrlCiphertext: parts.join('.') }),
        context,
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_LINK_INVALID' });
  });

  it('fails closed when ciphertext is copied to another version', async () => {
    const sealed = encryptApprovalUrl('https://app.example.com/r/private', secret, {
      organizationId,
      versionId,
    });
    await expect(
      sendRequestMessage(
        job({
          versionId: '019fffbd-ccf5-7523-afba-720f39b990dd',
          channel: 'WHATSAPP',
          approvalUrlCiphertext: sealed,
        }),
        context,
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_LINK_INVALID' });
  });
});

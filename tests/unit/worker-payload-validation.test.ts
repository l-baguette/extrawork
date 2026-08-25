import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { JobKind } from '@extrawork/contracts';
import type { JobRow } from '@extrawork/db';
import type { WorkerContext } from '../../apps/worker/src/context.js';
import { generateEvidence } from '../../apps/worker/src/jobs/evidence.js';
import { generateExport } from '../../apps/worker/src/jobs/exports.js';
import { scanFile } from '../../apps/worker/src/jobs/files.js';
import {
  notifyTeamDecision,
  sendDecisionReceipt,
  sendMessageDelivery,
  sendReminder,
  sendRequestMessage,
} from '../../apps/worker/src/jobs/messaging.js';
import { normalizeWebhook } from '../../apps/worker/src/jobs/webhooks.js';

const organizationId = randomUUID();
const noContext = {} as WorkerContext;

function job(
  kind: JobKind,
  payload: Record<string, unknown>,
  tenant: string | null = organizationId,
): JobRow {
  return {
    id: randomUUID(),
    organizationId: tenant,
    kind,
    payload,
    attemptCount: 1,
    maxAttempts: 6,
    dedupeKey: null,
    createdAt: new Date(),
  };
}

async function expectInvalid(run: Promise<void>): Promise<void> {
  await expect(run).rejects.toMatchObject({
    name: 'PermanentJobError',
    code: 'INVALID_JOB_PAYLOAD',
  });
}

describe('worker job payload validation', () => {
  it('rejects malformed identifiers before any repository or provider call', async () => {
    await expectInvalid(
      generateEvidence(
        job('generate_evidence', { documentId: 'not-a-uuid', versionId: randomUUID() }),
        noContext,
      ),
    );
    await expectInvalid(
      generateExport(job('generate_export', { documentId: randomUUID() }), noContext),
    );
    await expectInvalid(scanFile(job('scan_file', { fileObjectId: '' }), noContext));
    await expectInvalid(
      normalizeWebhook(job('normalize_webhook', { webhookInboxId: 42 }), noContext),
    );
  });

  it('rejects incomplete and invalid messaging payloads before delivery', async () => {
    await expectInvalid(
      sendReminder(
        job('send_reminder', {
          versionId: randomUUID(),
          policyStep: -1,
          channel: 'EMAIL',
          dedupeKey: 'reminder:test',
        }),
        noContext,
      ),
    );
    await expectInvalid(
      sendDecisionReceipt(
        job('send_decision_receipt', { decisionId: null, versionId: randomUUID() }),
        noContext,
      ),
    );
    await expectInvalid(
      sendRequestMessage(
        job('send_request_message', { versionId: randomUUID(), channel: 'FAX' }),
        noContext,
      ),
    );
    await expectInvalid(
      notifyTeamDecision(
        job('notify_team_decision', { decisionId: randomUUID(), versionId: 'missing' }),
        noContext,
      ),
    );
    await expectInvalid(
      sendMessageDelivery(job('send_message_delivery', { messageId: 'missing' }), noContext),
    );
  });

  it('rejects a malformed fallback tenant instead of passing it into SQL casts', async () => {
    await expectInvalid(
      generateEvidence(
        job(
          'generate_evidence',
          {
            documentId: randomUUID(),
            versionId: randomUUID(),
            organizationId: 'not-a-uuid',
          },
          null,
        ),
        noContext,
      ),
    );
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JOB_KINDS } from '@extrawork/contracts';
import { FixedClock } from '@extrawork/application';
import { claimJobs } from '@extrawork/db';
import type { OutboundMessage, ProviderMessageRef } from '@extrawork/integrations';
import type { Container } from '@extrawork/runtime';
import {
  createDraftChangeOrder,
  createTenant,
  createTestContainer,
  truncateAll,
  type TenantFixture,
} from '@extrawork/testkit';
import { workerContext } from '../../apps/worker/src/context.js';
import { enqueueDueReminders } from '../../apps/worker/src/jobs/maintenance.js';
import { sendReminder } from '../../apps/worker/src/jobs/messaging.js';
import type { PdfRenderer } from '../../apps/worker/src/pdf/renderer.js';

const clock = new FixedClock(new Date('2026-08-18T05:00:00Z'));
const pdfStub: PdfRenderer = {
  render: () => Promise.reject(new Error('reminders must not render PDFs')),
  rendererVersion: () => Promise.resolve('test-renderer'),
  close: () => Promise.resolve(),
};

let container: Container;
let tenant: TenantFixture;
let sent: OutboundMessage[];

beforeAll(() => {
  container = createTestContainer({ env: { WHATSAPP_DRIVER: 'simulator' }, clock });
});

afterAll(async () => {
  await container?.close();
});

beforeEach(async () => {
  await truncateAll(container);
  clock.set(new Date('2026-08-18T05:00:00Z'));
  tenant = await createTenant(container, { name: 'Reminder Interiors' });
  sent = [];
  container.appContext.integrations.whatsapp.send = async (
    command: OutboundMessage,
  ): Promise<ProviderMessageRef> => {
    sent.push(command);
    return {
      provider: 'whatsapp-simulator',
      providerMessageId: `simulated-${sent.length}`,
      status: 'SENT',
    };
  };
});

async function sendAndPromote(channel: 'WHATSAPP' | 'WHATSAPP_NATIVE_SHARE') {
  const draft = await createDraftChangeOrder(container, tenant);
  const result = await container.services.send.send(tenant.owner, draft.changeOrderId, { channel });
  await container.uow.pool.query(
    `UPDATE reminder_schedules SET due_at = now() - interval '1 minute'
     WHERE version_id = $1`,
    [result.versionId],
  );
  await enqueueDueReminders(workerContext(container, pdfStub));
  const jobs = await claimJobs(container.uow.db, {
    limit: 1,
    leaseSeconds: 60,
    workerId: 'reminder-test',
    kinds: [JOB_KINDS.SEND_REMINDER],
  });
  return { result, job: jobs[0] };
}

describe('scheduled reminder delivery', () => {
  it('uses the approved WhatsApp reminder template and records the real gateway channel', async () => {
    const { result, job } = await sendAndPromote('WHATSAPP');
    expect(job).toBeDefined();
    await sendReminder(job!, workerContext(container, pdfStub));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.template).toMatchObject({
      name: 'extra_work_reminder_v1',
      languageCode: 'en',
    });
    expect(sent[0]?.template?.bodyParameters).toHaveLength(6);

    const messages = await container.repos.messages.listForVersion(
      tenant.owner.tenant,
      result.versionId,
    );
    expect(messages.find((message) => message.purpose === 'REMINDER')?.channel).toBe(
      'WHATSAPP_SIMULATOR',
    );
  });

  it('does not create inert automatic reminders for native-share sends', async () => {
    const { result, job } = await sendAndPromote('WHATSAPP_NATIVE_SHARE');
    expect(job).toBeUndefined();
    const rows = await container.uow.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM reminder_schedules WHERE version_id = $1',
      [result.versionId],
    );
    expect(rows.rows[0]?.count).toBe('0');
    expect(sent).toHaveLength(0);
  });

  it('suppresses a scheduled reminder when its approval token was revoked', async () => {
    const { result, job } = await sendAndPromote('WHATSAPP');
    expect(job).toBeDefined();
    await container.uow.pool.query(
      `UPDATE approval_tokens SET revoked_at = now(), revoked_reason = 'LEAKED'
       WHERE version_id = $1`,
      [result.versionId],
    );
    await sendReminder(job!, workerContext(container, pdfStub));

    expect(sent).toHaveLength(0);
    const schedule = await container.uow.pool.query<{ suppressed_reason: string | null }>(
      'SELECT suppressed_reason FROM reminder_schedules WHERE id = $1',
      [job!.payload.reminderId],
    );
    expect(schedule.rows[0]?.suppressed_reason).toBe('REVOKED');
  });
});

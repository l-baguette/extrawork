import { JOB_KINDS, type JobKind } from '@extrawork/contracts';
import { createContainer } from '@extrawork/runtime';
import { workerContext } from './context.js';
import { JobRunner, startLeaseReaper, type JobHandler } from './runner.js';
import { OutboxPump } from './outbox-pump.js';
import { ChromiumPdfRenderer, UnavailablePdfRenderer, type PdfRenderer } from './pdf/renderer.js';
import { generateEvidence } from './jobs/evidence.js';
import {
  notifyTeamDecision,
  sendDecisionReceipt,
  sendReminder,
  sendRequestMessage,
} from './jobs/messaging.js';
import {
  applyRetention,
  checkProjectIntegrity,
  enqueueDueReminders,
  expireRequests,
  scheduleRecurringJobs,
} from './jobs/maintenance.js';
import { scanFile } from './jobs/files.js';
import { generateExport } from './jobs/exports.js';
import { normalizeWebhook } from './jobs/webhooks.js';

/**
 * Worker entrypoint — a second process from the same image as the API
 * (report §11.1, §5.2).
 *
 * It owns outbox consumption, messaging, reminders, PDFs, scans and
 * reconciliation. It must never accept a customer decision: that is the API's
 * responsibility and the report is explicit about the boundary.
 */

const container = createContainer({ applicationName: 'extrawork-worker' });
const { env, logger } = container;

const pdf: PdfRenderer =
  process.env.DISABLE_PDF === '1'
    ? new UnavailablePdfRenderer()
    : new ChromiumPdfRenderer(logger, env.PDF_TIMEOUT_MS);

const ctx = workerContext(container, pdf);

const handlers: Partial<Record<JobKind, JobHandler>> = {
  [JOB_KINDS.GENERATE_EVIDENCE]: generateEvidence,
  [JOB_KINDS.SEND_DECISION_RECEIPT]: sendDecisionReceipt,
  [JOB_KINDS.NOTIFY_TEAM_DECISION]: notifyTeamDecision,
  [JOB_KINDS.SEND_REQUEST_MESSAGE]: sendRequestMessage,
  [JOB_KINDS.SEND_REMINDER]: sendReminder,
  [JOB_KINDS.SCAN_FILE]: scanFile,
  [JOB_KINDS.GENERATE_EXPORT]: generateExport,
  [JOB_KINDS.NORMALIZE_WEBHOOK]: normalizeWebhook,
  [JOB_KINDS.EXPIRE_REQUESTS]: expireRequests,
  [JOB_KINDS.CHECK_PROJECT_INTEGRITY]: checkProjectIntegrity,
  [JOB_KINDS.APPLY_RETENTION]: applyRetention,
};

const runner = new JobRunner(ctx, handlers, {
  concurrency: env.WORKER_CONCURRENCY,
  pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
  leaseSeconds: env.WORKER_LEASE_SECONDS,
});

const outbox = new OutboxPump(ctx, {
  batchSize: 50,
  pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
  leaseSeconds: env.WORKER_LEASE_SECONDS,
});

const stopLeaseReaper = startLeaseReaper(ctx);

/**
 * The scheduler is in-process and idempotent: recurring jobs carry a dedupe key
 * derived from the current time window, so running it on every replica still
 * yields one job per window.
 */
let schedulerTimer: NodeJS.Timeout | null = null;
function startScheduler(): void {
  const tick = async (): Promise<void> => {
    try {
      await scheduleRecurringJobs(ctx);
      const promoted = await enqueueDueReminders(ctx);
      if (promoted > 0) logger.info({ promoted }, 'promoted due reminders');
    } catch (error) {
      logger.error({ err: error }, 'scheduler tick failed');
    }
  };
  void tick();
  schedulerTimer = setInterval(() => void tick(), 60_000);
  schedulerTimer.unref();
}

outbox.start();
runner.start();
if (env.WORKER_SCHEDULER_ENABLED) startScheduler();

logger.info(
  {
    concurrency: env.WORKER_CONCURRENCY,
    scheduler: env.WORKER_SCHEDULER_ENABLED,
    pdf: pdf instanceof UnavailablePdfRenderer ? 'disabled' : 'chromium',
    storage: env.STORAGE_DRIVER,
  },
  'extrawork worker started',
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');
  if (schedulerTimer) clearInterval(schedulerTimer);
  stopLeaseReaper();
  // Stop claiming first, then let in-flight jobs finish. Anything still running
  // when the process dies has its lease reclaimed and is retried.
  await Promise.all([runner.stop(), outbox.stop()]);
  await pdf.close();
  await container.close();
  logger.info('worker stopped cleanly');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection in worker');
});

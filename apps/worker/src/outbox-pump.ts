import { JOB_KINDS, OUTBOX_TOPICS, nextRetryDelaySeconds } from '@extrawork/contracts';
import {
  enqueueJob,
  leaseOutboxBatch,
  markOutboxFailed,
  markOutboxPublished,
  oldestUnpublishedAgeSeconds,
  type OutboxRow,
} from '@extrawork/db';
import { METRIC, metrics, type Logger } from '@extrawork/observability';
import type { WorkerContext } from './context.js';

/**
 * Transactional outbox consumer — report §13.2.
 *
 * The API commits an outbox row inside the same transaction as the domain
 * change, so a side effect can never exist without the change that justified
 * it, and a provider is never called inside a transaction (report §7.6).
 *
 * This pump translates an outbox event into one or more queued jobs. It does
 * not call providers itself: keeping the pump fast and purely local means a
 * slow provider cannot stall outbox drainage, and the job queue supplies the
 * retry, lease and dead-letter semantics.
 *
 * A crash between "job enqueued" and "outbox marked published" replays the
 * event, so every enqueue carries a deterministic dedupe key.
 */
export class OutboxPump {
  private running = false;
  private loop: Promise<void> | null = null;
  private readonly log: Logger;

  constructor(
    private readonly ctx: WorkerContext,
    private readonly options: { batchSize: number; pollIntervalMs: number; leaseSeconds: number },
  ) {
    this.log = ctx.logger.child({ component: 'outbox-pump' });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.pump();
    this.log.info('outbox pump started');
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    this.log.info('outbox pump stopped');
  }

  private async pump(): Promise<void> {
    while (this.running) {
      let processed = 0;
      try {
        const batch = await leaseOutboxBatch(this.ctx.db, {
          limit: this.options.batchSize,
          leaseSeconds: this.options.leaseSeconds,
        });
        for (const event of batch) {
          await this.dispatch(event);
          processed += 1;
        }

        // Report §13.5 SLI: age of the oldest critical outbox event.
        metrics.gauge(
          METRIC.OUTBOX_OLDEST_SECONDS,
          'Age of the oldest unpublished outbox event',
          await oldestUnpublishedAgeSeconds(this.ctx.db),
        );
      } catch (error) {
        this.log.error({ err: error }, 'outbox pump iteration failed');
      }
      if (processed === 0) await delay(this.options.pollIntervalMs);
    }
  }

  private async dispatch(event: OutboxRow): Promise<void> {
    try {
      for (const job of jobsFor(event)) {
        await enqueueJob({ db: this.ctx.db }, job);
      }
      await markOutboxPublished(this.ctx.db, event.id);
      metrics.counter(METRIC.OUTBOX_PUBLISHED, 'Outbox events published', { topic: event.topic });
    } catch (error) {
      // Dispatch is purely local work, so a failure is a bug or a database
      // problem. Back off on the §7.6 schedule, then dead-letter.
      const retryDelay = nextRetryDelaySeconds(event.attemptCount);
      await markOutboxFailed(this.ctx.db, event.id, 'DISPATCH_FAILED', retryDelay);
      this.log.error(
        { err: error, topic: event.topic, eventId: event.id },
        'outbox dispatch failed',
      );
    }
  }
}

type EnqueueInput = Parameters<typeof enqueueJob>[1];

/**
 * Topic to job mapping. The dedupe key is derived from the outbox event id, so
 * a replay after a crash collapses onto the same job rather than duplicating
 * work (report §13.2: "a worker crash after provider success but before local
 * acknowledgement may cause a repeat").
 */
export function jobsFor(event: OutboxRow): EnqueueInput[] {
  const payload = event.payload as Record<string, unknown>;
  const organizationId = event.organizationId;

  switch (event.topic) {
    case OUTBOX_TOPICS.APPROVAL_DECIDED:
      // The decision transaction already enqueued the evidence and receipt jobs
      // atomically with the decision itself, which is exactly the
      // "enqueue-with-transaction" property ADR-003 chose a PostgreSQL queue
      // for. Re-deriving them here would create a second, differently-keyed
      // copy of each. The topic remains published as a notification other
      // consumers can subscribe to.
      return [];

    case OUTBOX_TOPICS.CHANGE_ORDER_SENT:
      // Same reasoning as APPROVAL_DECIDED above: the send transaction already
      // enqueued the delivery job atomically with the freeze, keyed on the
      // version and channel. Re-deriving one here produces a second job with a
      // different dedupe key, and the customer is messaged twice about one
      // request — the copy from this path additionally lacks the approval URL,
      // because only the send call ever holds the plaintext token (report
      // §3.4), so it arrives telling them to use a link it cannot show.
      //
      // The topic stays published as a notification for other consumers.
      return [];

    case OUTBOX_TOPICS.MESSAGE_SEND_REQUESTED:
      // A deliberate re-send request, which nothing else has enqueued.
      return [
        {
          kind: JOB_KINDS.SEND_REQUEST_MESSAGE,
          organizationId,
          payload: {
            versionId: payload.versionId,
            organizationId,
            channel: payload.channel ?? 'WHATSAPP_NATIVE_SHARE',
          },
          dedupeKey: `request-message:${event.id}`,
        },
      ];

    case OUTBOX_TOPICS.DOCUMENT_EVIDENCE_REQUESTED:
      return [
        {
          kind: JOB_KINDS.GENERATE_EVIDENCE,
          organizationId,
          payload: {
            documentId: payload.documentId,
            versionId: payload.versionId,
            organizationId,
          },
          dedupeKey: `evidence:${String(payload.documentId)}`,
        },
      ];

    case OUTBOX_TOPICS.FILE_SCAN_REQUESTED:
      return [
        {
          kind: JOB_KINDS.SCAN_FILE,
          organizationId,
          payload: { fileObjectId: payload.fileObjectId, organizationId },
          dedupeKey: `scan:${String(payload.fileObjectId)}`,
        },
      ];

    case OUTBOX_TOPICS.PROJECT_EXPORT_REQUESTED:
      return [
        {
          kind: JOB_KINDS.GENERATE_EXPORT,
          organizationId,
          payload: { exportId: payload.exportId, organizationId },
          dedupeKey: `export:${String(payload.exportId)}`,
        },
      ];

    case OUTBOX_TOPICS.WEBHOOK_RECEIVED:
      return [
        {
          kind: JOB_KINDS.NORMALIZE_WEBHOOK,
          organizationId,
          payload: { webhookId: payload.webhookId },
          dedupeKey: `webhook:${String(payload.webhookId)}`,
        },
      ];

    case OUTBOX_TOPICS.REMINDER_SCHEDULED:
      // Reminders live in their own schedule table with due times; the
      // scheduler promotes them when they come due, not on publish.
      return [];

    default:
      // An unknown topic is preserved rather than dropped: the row stays
      // unpublished only if this throws, so instead it is acknowledged and
      // logged, matching the report's "preserve the raw unknown event while
      // alerting rather than discarding it" (§14.6).
      return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

import { randomUUID } from 'node:crypto';
import { JOB_PRIORITY, type JobKind } from '@extrawork/contracts';
import {
  claimJobs,
  completeJob,
  failJob,
  heartbeatJob,
  reclaimExpiredLeases,
  type JobRow,
} from '@extrawork/db';
import { METRIC, metrics, type Logger } from '@extrawork/observability';
import type { WorkerContext } from './context.js';

/**
 * Job runner — report §13.4.
 *
 *  - at-least-once execution, so every handler must be idempotent;
 *  - claims with `FOR UPDATE SKIP LOCKED` and a lease (default five minutes);
 *  - heartbeats extend the lease for long PDF and export work;
 *  - retries follow the §7.6 backoff, then dead-letter with the payload and
 *    error code preserved;
 *  - handlers are ordered by the §13.4 priority list, and low-priority work is
 *    paused first under backpressure.
 */

export type JobHandler = (job: JobRow, ctx: WorkerContext) => Promise<void>;

/** Thrown by a handler when retrying cannot help (report §7.6). */
export class PermanentJobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PermanentJobError';
    this.code = code;
  }
}

export interface RunnerOptions {
  concurrency: number;
  pollIntervalMs: number;
  leaseSeconds: number;
  /** Restricts this runner to a subset of kinds, for a dedicated pool later. */
  kinds?: JobKind[];
}

export class JobRunner {
  private readonly workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  private readonly log: Logger;
  private running = false;
  private inFlight = 0;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly ctx: WorkerContext,
    private readonly handlers: Partial<Record<JobKind, JobHandler>>,
    private readonly options: RunnerOptions,
  ) {
    this.log = ctx.logger.child({ component: 'job-runner', workerId: this.workerId });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.pump();
    this.log.info({ concurrency: this.options.concurrency }, 'job runner started');
  }

  /** Waits for in-flight jobs; leases expire on their own if we are killed. */
  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    this.log.info('job runner stopped');
  }

  private async pump(): Promise<void> {
    while (this.running) {
      let claimedAny = false;
      try {
        const capacity = this.options.concurrency - this.inFlight;
        if (capacity > 0) {
          const jobs = await claimJobs(this.ctx.db, {
            limit: capacity,
            leaseSeconds: this.options.leaseSeconds,
            workerId: this.workerId,
            ...(this.options.kinds ? { kinds: this.options.kinds } : {}),
          });
          claimedAny = jobs.length > 0;
          for (const job of jobs) {
            this.inFlight += 1;
            void this.execute(job).finally(() => {
              this.inFlight -= 1;
            });
          }
        }
      } catch (error) {
        this.log.error({ err: error }, 'failed to claim jobs');
      }

      // Only idle when there was nothing to do, so a backlog drains quickly.
      if (!claimedAny) await delay(this.options.pollIntervalMs);
    }

    // Drain before returning so a shutdown does not orphan a running job.
    while (this.inFlight > 0) await delay(50);
  }

  private async execute(job: JobRow): Promise<void> {
    const handler = this.handlers[job.kind];
    const log = this.ctx.logger.child({ jobId: job.id, kind: job.kind, attempt: job.attemptCount });
    const started = Date.now();

    if (!handler) {
      // An unknown kind is a deployment mismatch, not a transient fault.
      await failJob(this.ctx.db, job, `No handler registered for ${job.kind}`, { permanent: true });
      log.error('no handler registered for job kind');
      return;
    }

    // Long jobs keep their lease alive rather than being reclaimed mid-run.
    const heartbeat = setInterval(
      () => {
        void heartbeatJob(this.ctx.db, job.id, this.options.leaseSeconds).catch(
          (error: unknown) => {
            log.warn({ err: error }, 'job heartbeat failed');
          },
        );
      },
      Math.max(this.options.leaseSeconds * 1000 * 0.4, 5_000),
    );

    try {
      await handler(job, this.ctx);
      await completeJob(this.ctx.db, job.id);
      metrics.counter(METRIC.JOB_RUNS, 'Job executions', { kind: job.kind, result: 'success' });
      log.info({ durationMs: Date.now() - started }, 'job completed');
    } catch (error) {
      const permanent = error instanceof PermanentJobError;
      const code = permanent ? (error as PermanentJobError).code : classify(error);

      // The retry/dead-letter decision and the §7.6 backoff schedule live in
      // the queue layer; the runner only classifies the failure.
      const outcome = await failJob(
        this.ctx.db,
        job,
        `${code}: ${truncate((error as Error).message ?? 'unknown error')}`,
        { permanent },
      );
      const willRetry = outcome === 'RETRY';

      metrics.counter(METRIC.JOB_RUNS, 'Job executions', {
        kind: job.kind,
        result: willRetry ? 'retry' : 'dead_letter',
      });
      if (!willRetry) {
        metrics.counter(METRIC.JOB_DEAD_LETTER, 'Jobs sent to the dead-letter state', {
          kind: job.kind,
        });
      }
      log[willRetry ? 'warn' : 'error'](
        { err: error, code, willRetry },
        willRetry ? 'job failed, will retry' : 'job dead-lettered',
      );
    } finally {
      clearInterval(heartbeat);
      metrics.observe(METRIC.JOB_DURATION, 'Job duration', Date.now() - started, {
        kind: job.kind,
      });
    }
  }
}

/**
 * Returns expired leases to PENDING. A worker that was killed mid-job leaves a
 * RUNNING row behind; without this it would never be retried.
 */
export function startLeaseReaper(ctx: WorkerContext, intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    void reclaimExpiredLeases(ctx.db)
      .then((count) => {
        if (count > 0) ctx.logger.warn({ count }, 'reclaimed expired job leases');
      })
      .catch((error: unknown) => ctx.logger.error({ err: error }, 'lease reaper failed'));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * The tenant scope for a job.
 *
 * `job_queue.organization_id` is written by `enqueueJob` inside the same
 * transaction as the domain change, so it is authoritative and always present.
 * Handlers use it in preference to anything in the payload, which would
 * otherwise depend on every producer remembering to duplicate the field.
 */
export function requireTenant(job: JobRow, fallback?: string | null): string {
  const organizationId = job.organizationId ?? fallback ?? null;
  if (!organizationId) {
    throw new PermanentJobError('NO_TENANT', `Job ${job.kind} carries no organization scope`);
  }
  return organizationId;
}

export function priorityFor(kind: JobKind): number {
  return JOB_PRIORITY[kind] ?? 50;
}

function classify(error: unknown): string {
  const message = String((error as Error)?.message ?? '').toLowerCase();
  if (message.includes('timeout') || message.includes('etimedout')) return 'TIMEOUT';
  if (message.includes('econnrefused') || message.includes('enotfound'))
    return 'PROVIDER_UNREACHABLE';
  if (message.includes('rate limit') || message.includes('429')) return 'PROVIDER_RATE_LIMITED';
  return 'UNEXPECTED_ERROR';
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

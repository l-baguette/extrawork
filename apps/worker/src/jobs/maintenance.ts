import { DOMAIN_EVENTS, JOB_KINDS } from '@extrawork/contracts';
import { enqueueJob, listAggregatesForOrganization, readChain, type JobRow } from '@extrawork/db';
import { systemTenantContext, verifyChain } from '@extrawork/domain';
import { METRIC, metrics } from '@extrawork/observability';
import type { WorkerContext } from '../context.js';

/**
 * Recurring maintenance — report §13.3 (projection integrity), §4.3 (expiry),
 * §9.8 (retention) and §13.2 (webhook payload ageing).
 *
 * Every handler is idempotent and safe to run alongside the API and other
 * worker replicas.
 */

/**
 * Expires requests whose deadline has passed. Report §4.3: EXPIRED is reachable
 * from SENT and VIEWED, and the token is revoked with it.
 */
export async function expireRequests(_job: JobRow, ctx: WorkerContext): Promise<void> {
  const now = ctx.app.clock.now();
  const due = await ctx.repos.changeOrders.findExpiredVersions(200);
  if (due.length === 0) return;

  let expired = 0;
  for (const candidate of due) {
    const tenant = systemTenantContext(candidate.organizationId, `job:expire:${candidate.id}`);
    const changed = await ctx.app.uow.transaction(async (tx) => {
      // Re-read under a row lock. A decision may have committed between the
      // scan and this transaction, and a decided version must never be
      // overwritten with EXPIRED (report §4.6, first committed decision wins).
      const version = await ctx.repos.changeOrders.lockVersion(tx, candidate.id);
      if (!version) return false;
      if (version.status !== 'SENT' && version.status !== 'VIEWED') return false;
      if (!version.expiresAt || version.expiresAt.getTime() > now.getTime()) return false;

      await ctx.repos.changeOrders.setStatus(tx, version.id, 'EXPIRED', now);
      await ctx.repos.approvals.revokeForVersion(tx, version.id, 'EXPIRED');
      await ctx.repos.reminders.cancelForVersion(tx, version.id, 'EXPIRED');
      await ctx.repos.audit.append(tx, tenant, [
        {
          aggregateType: 'change_order',
          aggregateId: version.changeOrderId,
          projectId: version.projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_EXPIRED,
          actorType: 'SYSTEM',
          actorId: null,
          occurredAt: now,
          payload: {
            versionNumber: version.versionNumber,
            expiresAt: version.expiresAt.toISOString(),
          },
        },
      ]);
      return true;
    });
    if (changed) expired += 1;
  }

  ctx.logger.info({ scanned: due.length, expired }, 'expiry pass complete');
}

/**
 * Projection integrity — report §13.3.
 *
 * On mismatch: mark the project INTEGRITY_REVIEW (which blocks new sends and
 * evidence regeneration while preserving reads), record the old and new values,
 * and alert. It deliberately does NOT auto-correct the number: a silent fix
 * would destroy the evidence that something went wrong. The rebuild is a
 * controlled repair command.
 */
export async function checkProjectIntegrity(_job: JobRow, ctx: WorkerContext): Promise<void> {
  const mismatches = await ctx.repos.projects.findIntegrityMismatches();

  for (const mismatch of mismatches) {
    const tenant = systemTenantContext(mismatch.organizationId, 'job:integrity');
    await ctx.app.uow.transaction(async (tx) => {
      await ctx.repos.projects.setIntegrityReview(tx, mismatch.projectId, true);
      await ctx.repos.audit.append(tx, tenant, [
        {
          aggregateType: 'project',
          aggregateId: mismatch.projectId,
          projectId: mismatch.projectId,
          eventType: DOMAIN_EVENTS.INTEGRITY_MISMATCH_DETECTED,
          actorType: 'SYSTEM',
          actorId: null,
          occurredAt: ctx.app.clock.now(),
          payload: {
            storedDeltaMinor: mismatch.storedDeltaMinor.toString(),
            recomputedDeltaMinor: mismatch.recomputedDeltaMinor.toString(),
          },
        },
      ]);
    });
    metrics.counter(METRIC.INTEGRITY_MISMATCH, 'Project projection mismatches detected');
    ctx.logger.error(
      {
        projectId: mismatch.projectId,
        stored: mismatch.storedDeltaMinor.toString(),
        recomputed: mismatch.recomputedDeltaMinor.toString(),
      },
      'project total integrity mismatch; project moved to INTEGRITY_REVIEW',
    );
  }

  // Report §13.5 pages on an invalid audit chain, so the sweep runs here too.
  const organizationIds = await ctx.repos.organizations.listAllIds();
  let invalidChains = 0;
  for (const organizationId of organizationIds) {
    const tenant = systemTenantContext(organizationId, 'job:integrity');
    for (const aggregate of await listAggregatesForOrganization(ctx.db, organizationId)) {
      const events = await readChain(
        ctx.db,
        tenant,
        aggregate.aggregateType,
        aggregate.aggregateId,
      );
      if (!verifyChain(events).valid) {
        invalidChains += 1;
        metrics.counter(METRIC.AUDIT_CHAIN_INVALID, 'Audit chains that failed verification');
        ctx.logger.error({ organizationId, ...aggregate }, 'audit chain failed verification');
      }
    }
  }

  ctx.logger.info({ mismatches: mismatches.length, invalidChains }, 'integrity sweep complete');
}

/**
 * Retention — report §9.8. Policy-driven rather than a hard-coded legal period.
 *
 * Approved evidence is only *flagged* as due here. The report requires the
 * organization to be notified and offered an export before approved evidence is
 * deleted, and legal holds suspend deletion entirely, so the destructive step is
 * an operator-run command, not this job.
 */
export async function applyRetention(_job: JobRow, ctx: WorkerContext): Promise<void> {
  const now = ctx.app.clock.now();

  const [abandonedDrafts, purgedWebhooks, expiredSessions, expiredIdempotency] = await Promise.all([
    ctx.repos.changeOrders.deleteAbandonedDrafts(ctx.db, 180, now),
    ctx.repos.webhooks.purgeOldRawPayloads(ctx.db, 90),
    ctx.repos.identity.purgeExpiredSessions(),
    ctx.repos.approvals.purgeExpiredPublicSessions(ctx.db, now),
  ]);

  const dueForReview = await ctx.repos.projects.findRetentionDue(ctx.db, now);
  for (const project of dueForReview) {
    const tenant = systemTenantContext(project.organizationId, 'job:retention');
    await ctx.app.uow.transaction(async (tx) => {
      await ctx.repos.audit.append(tx, tenant, [
        {
          aggregateType: 'project',
          aggregateId: project.projectId,
          projectId: project.projectId,
          eventType: DOMAIN_EVENTS.DATA_RETENTION_DUE,
          actorType: 'SYSTEM',
          actorId: null,
          occurredAt: now,
          payload: { retentionUntil: project.retentionUntil },
        },
      ]);
    });
  }

  ctx.logger.info(
    {
      abandonedDrafts,
      purgedWebhooks,
      expiredSessions,
      expiredIdempotency,
      retentionDue: dueForReview.length,
    },
    'retention pass complete',
  );
}

/**
 * Enqueues the recurring jobs. The dedupe key is derived from the current time
 * window, so N worker replicas racing the scheduler still produce exactly one
 * job per window (report §13.4).
 */
export async function scheduleRecurringJobs(ctx: WorkerContext): Promise<void> {
  const now = ctx.app.clock.now();
  const hourWindow = now.toISOString().slice(0, 13);
  const dayWindow = now.toISOString().slice(0, 10);

  await enqueueJob(
    { db: ctx.db },
    {
      kind: JOB_KINDS.EXPIRE_REQUESTS,
      organizationId: null,
      payload: {},
      dedupeKey: `expire:${hourWindow}`,
    },
  );
  await enqueueJob(
    { db: ctx.db },
    {
      kind: JOB_KINDS.CHECK_PROJECT_INTEGRITY,
      organizationId: null,
      payload: {},
      dedupeKey: `integrity:${dayWindow}`,
    },
  );
  await enqueueJob(
    { db: ctx.db },
    {
      kind: JOB_KINDS.APPLY_RETENTION,
      organizationId: null,
      payload: {},
      dedupeKey: `retention:${dayWindow}`,
    },
  );
}

/** Promotes due reminders from the schedule table into the job queue. */
export async function enqueueDueReminders(ctx: WorkerContext): Promise<number> {
  const due = await ctx.repos.reminders.findDue(ctx.db, 100);
  for (const reminder of due) {
    await enqueueJob(
      { db: ctx.db },
      {
        kind: JOB_KINDS.SEND_REMINDER,
        organizationId: reminder.organizationId,
        payload: {
          reminderId: reminder.id,
          versionId: reminder.versionId,
          organizationId: reminder.organizationId,
          policyStep: reminder.policyStep,
          channel: reminder.channel,
          dedupeKey: reminder.dedupeKey,
        },
        dedupeKey: `job:${reminder.dedupeKey}`,
      },
    );
  }
  return due.length;
}

import {
  APPROVAL_DECLARATION,
  AppError,
  DECLINE_DECLARATION,
  DOMAIN_EVENTS,
  JOB_KINDS,
  OUTBOX_TOPICS,
  REVISION_DECLARATION,
  TERMS_VERSION,
  assuranceCopy,
  signerNameMatches,
  type DecisionInput,
  type DecisionType,
} from '@extrawork/contracts';
import {
  beginIdempotent,
  completeIdempotent,
  enqueueJob,
  publishOutbox,
  type Repositories,
} from '@extrawork/db';
import {
  EVIDENCE_TEMPLATE_VERSION,
  affectsProjectTotals,
  assertAssuranceSatisfied,
  assertTokenUsable,
  assertTransition,
  decisionAction,
  generateReceiptToken,
  hashToken,
  isWellFormedToken,
  maskPhone,
  receiptDisplayId,
  systemTenantContext,
} from '@extrawork/domain';
import { metrics, METRIC } from '@extrawork/observability';
import type { AuditEventInput } from '@extrawork/domain';
import type { AppContext, PublicRequestContext } from '../context.js';
import { etagMatches, publicDecisionEtag } from '../change-orders/build-lines.js';

/**
 * The approval decision engine — report §8.4, implemented as the report's own
 * pseudocode with the concurrency guarantees from §4.6 and §7.8.
 *
 * Order inside the single transaction:
 *   1. claim the idempotency key (replay returns the stored response);
 *   2. lock the approval token row by hash;
 *   3. lock the version row and revalidate its state under that lock;
 *   4. check the ETag and the assurance level;
 *   5. insert the decision (UNIQUE(version_id) settles any residual race);
 *   6. mark the version terminal and revoke the token;
 *   7. on APPROVE, apply the delta to the project projection;
 *   8. append audit events and publish outbox events;
 *   9. complete the idempotency record.
 *
 * Only after COMMIT does the caller see success (report §4.5). The evidence PDF
 * and the receipt message are asynchronous, and their failure never reverses
 * the approval (report §7.6).
 */

export interface DecideCommand {
  plainToken: string;
  publicSessionToken: string;
  input: DecisionInput;
  idempotencyKey: string;
  ifMatch: string | undefined;
}

export interface DecisionReceipt {
  receiptId: string;
  decisionId: string;
  type: DecisionType;
  signerName: string;
  occurredAt: string;
  assuranceAchieved: string;
  assuranceLabel: string;
  assuranceLimitation: string;
  changeNumber: string;
  versionNumber: number;
  organizationName: string;
  projectTitle: string;
  currency: string;
  totalDeltaMinor: number;
  revisedContractTotalMinor: number;
  receiptToken: string | null;
  evidenceStatus: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
  evidenceUrl: string | null;
}

const DECLARATIONS: Record<DecisionType, string> = {
  APPROVE: APPROVAL_DECLARATION,
  DECLINE: DECLINE_DECLARATION,
  REQUEST_REVISION: REVISION_DECLARATION,
};

export class DecisionService {
  constructor(private readonly app: AppContext) {}

  private get repos(): Repositories {
    return this.app.repos;
  }

  async decide(command: DecideCommand, ctx: PublicRequestContext): Promise<DecisionReceipt> {
    const started = Date.now();
    metrics.counter(METRIC.DECISION_ATTEMPTS, 'Public decision attempts', {
      type: command.input.type,
    });

    try {
      const receipt = await this.execute(command, ctx);
      metrics.observe(
        METRIC.DECISION_DURATION,
        'Public decision transaction duration',
        Date.now() - started,
      );
      return receipt;
    } catch (error) {
      metrics.counter(METRIC.DECISION_FAILURES, 'Public decision failures', {
        code: AppError.is(error) ? error.code : 'UNKNOWN',
      });
      throw error;
    }
  }

  private async execute(
    command: DecideCommand,
    ctx: PublicRequestContext,
  ): Promise<DecisionReceipt> {
    if (!isWellFormedToken(command.plainToken)) {
      throw new AppError('TOKEN_INVALID');
    }

    const session = await this.repos.approvals.findPublicSession(command.publicSessionToken);
    if (!session) {
      throw new AppError('SESSION_EXPIRED', {
        message: 'Your review session has expired. Reload the page and try again.',
      });
    }

    const tokenHash = hashToken(command.plainToken);
    const now = this.app.clock.now();

    return this.app.uow.transaction(async (tx) => {
      // 1. Idempotency. A retried tap on a flaky connection replays the stored
      //    receipt instead of creating a second decision (report §7.6).
      const idempotency = await beginIdempotent(tx, {
        scope: 'public.decision',
        subjectId: session.id,
        key: command.idempotencyKey,
        payload: {
          type: command.input.type,
          signerName: command.input.signerName,
          comment: command.input.comment ?? null,
        },
      });
      if (idempotency.replay && idempotency.response) {
        return idempotency.response.body as DecisionReceipt;
      }

      // 2. Lock the token row.
      const token = await this.repos.approvals.lockByHash(tx, tokenHash);
      if (!token) throw new AppError('TOKEN_INVALID');
      if (token.id !== session.approvalTokenId) {
        // The session belongs to a different link.
        throw new AppError('TOKEN_INVALID');
      }
      assertTokenUsable(token, now);

      // 3. Lock the version and revalidate under the lock.
      const version = await this.repos.changeOrders.lockVersion(tx, token.versionId);
      if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      const tenant = systemTenantContext(version.organizationId, ctx.requestId);

      // Report §4.6: the first committed terminal decision wins; a second gets
      // 409 with the recorded state.
      const nextStatus = assertTransition(version.status, decisionAction(command.input.type));

      if (version.expiresAt && version.expiresAt.getTime() <= now.getTime()) {
        throw new AppError('REQUEST_EXPIRED', {
          details: { expiresAt: version.expiresAt.toISOString() },
        });
      }

      // 4. ETag and assurance.
      //
      // The tag is the frozen snapshot digest, not `lock_version`: it must
      // assert "this is the exact content I was shown" and must survive the
      // SENT -> VIEWED write that the customer's own page load performs.
      if (!etagMatches(command.ifMatch, publicDecisionEtag(version))) {
        throw new AppError('ETAG_MISMATCH', {
          message:
            'This request changed since you opened it. Reload the page to see the current version.',
          details: { currentVersion: version.versionNumber },
        });
      }
      assertAssuranceSatisfied(
        {
          achieved: session.assuranceAchieved,
          verifiedPhoneE164: session.verifiedPhoneE164,
          verifiedAt: session.verifiedAt,
        },
        version.assuranceRequired,
      );

      // 4b. The typed name is the signature (report §3.3). Under A0 the record
      // claims "the holder of a private link typed the name shown below and
      // confirmed the statement" — so a name that is not the recorded
      // approver's would make that claim untrue. Checked inside the transaction
      // and before the insert, so a mismatch records nothing at all.
      const approver = await this.repos.customers.findContact(tenant, version.approverContactId);
      if (approver && !signerNameMatches(command.input.signerName, approver.name)) {
        throw new AppError('SIGNER_NAME_MISMATCH', {
          // The expected name is already on the page the customer is looking
          // at, so echoing it here tells them nothing they cannot see.
          details: { expectedName: approver.name },
        });
      }

      // 5. Insert the decision.
      const receiptToken = generateReceiptToken();
      const project = await this.repos.projects.lockById(tx, tenant, version.projectId);
      const decision = await this.repos.approvals.insertDecision(tx, tenant, {
        projectId: version.projectId,
        versionId: version.id,
        type: command.input.type,
        signerName: command.input.signerName.trim(),
        comment: command.input.comment?.trim() ?? null,
        assuranceAchieved: session.assuranceAchieved,
        verifiedPhoneE164: session.verifiedPhoneE164,
        publicSessionId: session.id,
        ipHash: ctx.ipHash,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        declarationText: DECLARATIONS[command.input.type],
        termsVersion: version.termsVersion ?? TERMS_VERSION,
        occurredAt: now,
        receiptTokenHash: receiptToken.hash,
        receiptDisplayId: receiptDisplayId(`${version.id}:${now.toISOString()}`),
      });

      // 6. Terminal state and token revocation.
      await this.repos.changeOrders.setStatus(tx, version.id, nextStatus, now);
      await this.repos.approvals.revoke(tx, token.id, 'DECIDED');
      await this.repos.reminders.cancelForVersion(tx, version.id, 'DECIDED');

      // 7. Project projection, only on approve.
      let revisedTotalMinor = project.revisedTotalMinor;
      if (affectsProjectTotals(command.input.type)) {
        const applied = await this.repos.projects.applyApprovedDelta(
          tx,
          tenant,
          version.projectId,
          version.totalDeltaMinor,
          version.scheduleDeltaDays,
        );
        revisedTotalMinor = applied.revisedTotalMinor;

        const subscription = await this.repos.organizations.getSubscription(tenant);
        if (subscription) {
          await this.repos.organizations.incrementUsage(
            tx,
            tenant,
            subscription.currentPeriodStart,
            'completed_decisions',
          );
        }
      }

      // 8. Audit and outbox, in the same transaction.
      const auditEvents: AuditEventInput[] = [
        {
          aggregateType: 'change_order',
          aggregateId: version.changeOrderId,
          projectId: version.projectId,
          eventType: DOMAIN_EVENTS.APPROVAL_DECIDED,
          actorType: 'CUSTOMER' as const,
          // The actor is the approver contact, never a raw phone number.
          actorId: token.approverContactId,
          occurredAt: now,
          payload: {
            decisionId: decision.id,
            type: command.input.type,
            versionNumber: version.versionNumber,
            signerName: decision.signerName,
            assuranceAchieved: session.assuranceAchieved,
            verifiedPhoneMasked: maskPhone(session.verifiedPhoneE164),
            receiptId: decision.receiptDisplayId,
            termsVersion: version.termsVersion ?? TERMS_VERSION,
            totalDeltaMinor: version.totalDeltaMinor.toString(),
            revisedContractTotalMinor: revisedTotalMinor.toString(),
            declarationAccepted: true,
          },
        },
      ];

      if (command.input.type === 'REQUEST_REVISION') {
        auditEvents.push({
          aggregateType: 'change_order',
          aggregateId: version.changeOrderId,
          projectId: version.projectId,
          eventType: DOMAIN_EVENTS.CHANGE_ORDER_REVISION_REQUESTED,
          actorType: 'CUSTOMER' as const,
          actorId: token.approverContactId,
          occurredAt: now,
          payload: {
            versionNumber: version.versionNumber,
            // Append-only customer evidence (report §4.6).
            comment: command.input.comment?.trim() ?? null,
          },
        });
      }

      await this.repos.audit.append(tx, tenant, auditEvents);

      await publishOutbox(tx, {
        topic: OUTBOX_TOPICS.APPROVAL_DECIDED,
        aggregateId: decision.id,
        organizationId: version.organizationId,
        payload: {
          decisionId: decision.id,
          versionId: version.id,
          changeOrderId: version.changeOrderId,
          projectId: version.projectId,
          type: command.input.type,
        },
      });

      // Evidence generation is asynchronous; the decision is already durable
      // (report §13.1: "PDF worker unavailable → decision must still commit").
      const documentId = await this.repos.documents.requestEvidence(tx, tenant, {
        projectId: version.projectId,
        versionId: version.id,
        templateVersion: EVIDENCE_TEMPLATE_VERSION,
      });
      await enqueueJob(tx, {
        kind: JOB_KINDS.GENERATE_EVIDENCE,
        organizationId: version.organizationId,
        dedupeKey: `evidence:${version.id}:${decision.id}`,
        payload: { documentId, versionId: version.id, decisionId: decision.id },
      });
      await enqueueJob(tx, {
        kind: JOB_KINDS.SEND_DECISION_RECEIPT,
        organizationId: version.organizationId,
        dedupeKey: `receipt:${decision.id}`,
        payload: { decisionId: decision.id, versionId: version.id },
      });
      // Tell the contractor's own people. Enqueued in the same transaction as
      // the decision, so a customer's approval can never commit without the
      // notification being queued — the employee was told "I will message you
      // the moment they respond", and that promise is only true if this is
      // atomic with the thing being promised about.
      await enqueueJob(tx, {
        kind: JOB_KINDS.NOTIFY_TEAM_DECISION,
        organizationId: version.organizationId,
        dedupeKey: `team-decision:${decision.id}`,
        payload: { decisionId: decision.id, versionId: version.id },
      });

      // 9. Build and store the response for replay.
      const [organization, changeOrder] = await Promise.all([
        this.repos.organizations.findById(tenant),
        this.repos.changeOrders.requireChangeOrder(tx.db, tenant, version.changeOrderId),
      ]);

      const copy = assuranceCopy(session.assuranceAchieved);
      const receipt: DecisionReceipt = {
        receiptId: decision.receiptDisplayId,
        decisionId: decision.id,
        type: decision.type,
        signerName: decision.signerName,
        occurredAt: decision.occurredAt.toISOString(),
        assuranceAchieved: decision.assuranceAchieved,
        assuranceLabel: copy.label,
        assuranceLimitation: copy.limitation,
        changeNumber: changeOrder.number,
        versionNumber: version.versionNumber,
        organizationName: organization?.displayName ?? '',
        projectTitle: project.title,
        currency: version.currency,
        totalDeltaMinor: Number(version.totalDeltaMinor),
        revisedContractTotalMinor: Number(revisedTotalMinor),
        receiptToken: receiptToken.plaintext,
        evidenceStatus: 'PENDING',
        evidenceUrl: null,
      };

      await completeIdempotent(tx, idempotency.id, {
        status: 201,
        body: receipt,
        resourceId: decision.id,
      });

      return receipt;
    });
  }
}

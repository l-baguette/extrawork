import {
  APPROVAL_DECLARATION,
  AppError,
  DECLINE_DECLARATION,
  DOMAIN_EVENTS,
  EVIDENCE_DISCLAIMER,
  REVISION_DECLARATION,
  assuranceCopy,
  assuranceSatisfies,
  type PublicRequestDto,
} from '@extrawork/contracts';
import {
  assertTokenUsable,
  isWellFormedToken,
  maskedContactLabel,
  systemTenantContext,
} from '@extrawork/domain';
import type { AppContext, PublicRequestContext } from '../context.js';
import { publicDecisionEtag } from '../change-orders/build-lines.js';

/**
 * Public approval read — report §4.5 and §6.7.
 *
 * The projection is deliberately minimal (report §5.3): it carries only what a
 * customer needs to decide, with the approver's contact masked and no other
 * project, customer or team data. Nothing here echoes the token.
 */

export interface ResolvedPublicRequest {
  dto: PublicRequestDto;
  /** Set on the first resolution of a link so the API can issue the cookie. */
  session: { token: string; csrfToken: string; expiresAt: Date } | null;
}

export class PublicApprovalService {
  constructor(private readonly app: AppContext) {}

  async resolve(
    plainToken: string,
    ctx: PublicRequestContext,
    existingSessionToken: string | undefined,
  ): Promise<ResolvedPublicRequest> {
    if (!isWellFormedToken(plainToken)) {
      throw new AppError('TOKEN_INVALID');
    }

    const token = await this.app.repos.approvals.findByToken(plainToken);
    if (!token) throw new AppError('TOKEN_INVALID');

    const tenant = systemTenantContext(token.organizationId, ctx.requestId);
    const version = await this.app.repos.changeOrders.requireVersion(
      this.app.uow.db,
      tenant,
      token.versionId,
    );

    // A decided request must still render, as a receipt (report §6.7). Only an
    // unusable-for-a-new-decision token that is NOT decided is an error here.
    const decision = await this.app.repos.approvals.findDecisionByVersion(
      this.app.uow.db,
      tenant,
      version.id,
    );
    if (!decision) {
      try {
        assertTokenUsable(token, this.app.clock.now());
      } catch (error) {
        if (AppError.is(error) && error.code === 'VERSION_SUPERSEDED') {
          // Report §4.6: explain the replacement, and offer the current link
          // only when the same approver holds a live one.
          const successor = await this.app.repos.approvals.findSuccessorToken(
            version.id,
            token.approverContactId,
          );
          throw new AppError('VERSION_SUPERSEDED', {
            details: successor
              ? { currentVersionAvailable: true }
              : { currentVersionAvailable: false },
          });
        }
        throw error;
      }
    }

    const [organization, project, changeOrder, lineItems, attachments, approver] =
      await Promise.all([
        this.app.repos.organizations.findById(tenant),
        this.app.repos.projects.requireById(tenant, version.projectId),
        this.app.repos.changeOrders.requireChangeOrder(
          this.app.uow.db,
          tenant,
          version.changeOrderId,
        ),
        this.app.repos.changeOrders.listLineItems(this.app.uow.db, version.id),
        this.app.repos.changeOrders.listAttachments(this.app.uow.db, version.id),
        this.app.repos.customers.requireContact(tenant, version.approverContactId),
      ]);
    if (!organization) throw new AppError('NOT_FOUND');

    // First view is evidence; repeat views only move counters (report §4.5).
    // Assigned inside the transaction callback below. TypeScript's control-flow
    // analysis cannot see through the closure, so the type is pinned here
    // rather than being narrowed to `null` at the point of use.
    let session: ResolvedPublicRequest['session'] = null as ResolvedPublicRequest['session'];
    await this.app.uow.transaction(async (tx) => {
      const { firstView } = await this.app.repos.approvals.recordView(tx, token.id);

      if (firstView && !decision) {
        await this.app.repos.changeOrders.setStatus(
          tx,
          version.id,
          version.status === 'SENT' ? 'VIEWED' : version.status,
          this.app.clock.now(),
        );
        await this.app.repos.audit.append(tx, tenant, [
          {
            aggregateType: 'change_order',
            aggregateId: version.changeOrderId,
            projectId: version.projectId,
            eventType: DOMAIN_EVENTS.APPROVAL_REQUEST_VIEWED,
            actorType: 'CUSTOMER',
            actorId: token.approverContactId,
            occurredAt: this.app.clock.now(),
            payload: { versionNumber: version.versionNumber },
          },
        ]);
      }

      // A public session is created for the decision POST, so the decision is
      // not authenticated by the bearer link alone (report §6.5).
      const existing = existingSessionToken
        ? await this.app.repos.approvals.findPublicSession(existingSessionToken)
        : null;
      if (!existing || existing.approvalTokenId !== token.id) {
        const created = await this.app.repos.approvals.createPublicSession(tx, {
          organizationId: token.organizationId,
          approvalTokenId: token.id,
          versionId: version.id,
          ttlMinutes: this.app.env.PUBLIC_SESSION_TTL_MINUTES,
          ipHash: ctx.ipHash,
          userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        });
        session = {
          token: created.sessionToken,
          csrfToken: created.csrfToken,
          expiresAt: created.expiresAt,
        };
      }
    });

    const achieved = existingSessionToken
      ? ((await this.app.repos.approvals.findPublicSession(existingSessionToken))
          ?.assuranceAchieved ?? 'A0')
      : 'A0';
    const copy = assuranceCopy(version.assuranceRequired);

    const attachmentDtos = await Promise.all(
      attachments
        // Only a clean, scanned file is ever shown to a customer (report §9.7).
        .filter((a) => a.scanStatus === 'CLEAN')
        .map(async (a) => ({
          id: a.fileObjectId,
          caption: a.caption,
          mimeType: a.derivativeStorageKey ? 'image/webp' : a.mimeType,
          url: await this.app.objectStore.createDownload(
            a.derivativeStorageKey ?? a.promotedStorageKey ?? a.storageKey,
            this.app.env.SIGNED_URL_TTL_SECONDS,
            a.filename,
          ),
          width: a.imageWidth,
          height: a.imageHeight,
        })),
    );

    const dto: PublicRequestDto = {
      requestRef: version.id.slice(0, 8),
      status: version.status,
      decided: Boolean(decision),
      organization: {
        displayName: organization.displayName,
        legalName: organization.legalName,
        contactPhone: organization.contactPhone,
        contactEmail: organization.contactEmail,
        brandPrimaryColor: organization.brandPrimaryColor,
      },
      project: {
        title: project.title,
        projectNumber: project.projectNumber,
        siteSummary: summariseAddress(project.siteAddressJson),
      },
      change: {
        number: changeOrder.number,
        versionNumber: version.versionNumber,
        type: version.type,
        title: version.title,
        scope: version.scopeDescription,
        reason: version.reason,
      },
      commercial: {
        currency: version.currency,
        lineItems: lineItems.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPriceMinor: Number(l.unitPriceMinor),
          taxRateBps: l.taxRateBps,
          totalMinor: Number(l.totalMinor),
        })),
        subtotalDeltaMinor: Number(version.subtotalDeltaMinor),
        taxDeltaMinor: Number(version.taxDeltaMinor),
        totalDeltaMinor: Number(version.totalDeltaMinor),
        baselineTotalMinor: Number(version.baselineTotalMinor ?? project.baselineTotalMinor),
        priorApprovedDeltaMinor: Number(version.priorApprovedDeltaMinor ?? 0n),
        revisedContractTotalMinor: Number(
          version.revisedContractTotalMinor ?? project.revisedTotalMinor,
        ),
      },
      schedule: {
        deltaDays: version.scheduleDeltaDays,
        revisedCompletionDate: version.revisedCompletionDate,
      },
      attachments: attachmentDtos,
      approver: {
        name: approver.name,
        maskedContact: maskedContactLabel(approver.phoneE164, approver.emailNormalized),
      },
      assurance: {
        required: version.assuranceRequired,
        achieved,
        label: copy.label,
        summary: copy.summary,
        limitation: copy.limitation,
        verificationRequired: !assuranceSatisfies(achieved, version.assuranceRequired),
      },
      declarations: {
        approve: APPROVAL_DECLARATION,
        decline: DECLINE_DECLARATION,
        requestRevision: REVISION_DECLARATION,
        disclaimer: EVIDENCE_DISCLAIMER,
      },
      expiresAt: token.expiresAt.toISOString(),
      sentAt: (version.sentAt ?? version.createdAt).toISOString(),
      etag: publicDecisionEtag(version),
      // The browser cannot read the session cookies (they are scoped to
      // `/public` on the API host), so the double-submit value travels in the
      // body. CORS is what keeps it out of an attacker's reach.
      csrfToken: session?.csrfToken ?? null,
      receipt: decision
        ? {
            receiptId: decision.receiptDisplayId,
            type: decision.type,
            signerName: decision.signerName,
            occurredAt: decision.occurredAt.toISOString(),
            assuranceAchieved: decision.assuranceAchieved,
          }
        : null,
    };

    return { dto, session };
  }
}

/**
 * Report §6.7: the public page shows the project and site summary "without
 * unnecessary personal details", so only city and state are exposed.
 */
function summariseAddress(address: Record<string, unknown> | null): string | null {
  if (!address) return null;
  const city = typeof address.city === 'string' ? address.city : null;
  const state = typeof address.state === 'string' ? address.state : null;
  const parts = [city, state].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AppError,
  CancelChangeOrderSchema,
  CreateChangeOrderSchema,
  CreateRevisionSchema,
  ListChangeOrdersQuerySchema,
  RegisterAttachmentSchema,
  RemindSchema,
  SendChangeOrderSchema,
  ShareIntentSchema,
  UpdateDraftSchema,
} from '@extrawork/contracts';
import type { AppContext } from '@extrawork/application';
import { versionEtag } from '@extrawork/application';
import { readChain, verifyAggregateChain } from '@extrawork/db';
import { STATUS_LABEL, authorize, maskedContactLabel } from '@extrawork/domain';
import { authenticatedSubject, rateLimit } from '../plugins/rate-limit.js';
import { parseLockVersion } from './customers.js';
import { summaryDto } from './projects.js';

const IdParams = z.object({ id: z.string().uuid() });
const ProjectIdParams = z.object({ projectId: z.string().uuid() });

export async function registerChangeOrderRoutes(
  app: FastifyInstance,
  appContext: AppContext,
): Promise<void> {
  const limiter = app.repos.rateLimiter;
  const read = rateLimit(limiter, { name: 'AUTHENTICATED_READ', subject: authenticatedSubject });
  const write = rateLimit(limiter, {
    name: 'AUTHENTICATED_MUTATION',
    subject: authenticatedSubject,
  });

  app.get('/v1/change-orders', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    authorize(auth.actor, 'change_order:read', { organizationId: auth.actor.organizationId });

    const query = ListChangeOrdersQuerySchema.parse(request.query);
    const orgWide =
      auth.actor.role === 'OWNER' || auth.actor.role === 'ADMIN' || auth.actor.role === 'FINANCE';

    const result = await app.repos.changeOrders.listSummaries(auth.tenant, {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.bucket ? { bucket: query.bucket } : {}),
      ...(query.query ? { query: query.query } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
      projectGrants: orgWide ? null : [...auth.actor.projectGrants],
    });

    return reply.send({
      items: result.items.map(summaryDto),
      nextCursor: result.nextCursor,
    });
  });

  app.post(
    '/v1/projects/:projectId/change-orders',
    { preHandler: write },
    async (request, reply) => {
      const auth = await app.requireAuth(request, reply);
      app.requireWrite(request, 'change_order:create');
      const { projectId } = ProjectIdParams.parse(request.params);
      const input = CreateChangeOrderSchema.parse(request.body);

      const created = await app.services.changeOrders.create(auth, projectId, input);

      return reply
        .status(201)
        .header('etag', versionEtag(created.version.id, created.version.lockVersion))
        .send({
          id: created.changeOrderId,
          number: created.number,
          version: created.version.versionNumber,
          status: created.version.status,
          lockVersion: created.version.lockVersion,
          totals: {
            subtotalDeltaMinor: Number(created.version.subtotalDeltaMinor),
            taxDeltaMinor: Number(created.version.taxDeltaMinor),
            totalDeltaMinor: Number(created.version.totalDeltaMinor),
            currency: created.version.currency,
          },
        });
    },
  );

  app.get('/v1/change-orders/:id', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);

    const changeOrder = await app.repos.changeOrders.requireChangeOrder(
      appContext.uow.db,
      auth.tenant,
      id,
    );
    authorize(auth.actor, 'change_order:read', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const version = await app.repos.changeOrders.getCurrentVersion(auth.tenant, id);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');

    const [lineItems, attachments, approver, versions, decision, project] = await Promise.all([
      app.repos.changeOrders.listLineItems(appContext.uow.db, version.id),
      app.repos.changeOrders.listAttachments(appContext.uow.db, version.id),
      app.repos.customers.requireContact(auth.tenant, version.approverContactId),
      app.repos.changeOrders.listVersions(auth.tenant, id),
      app.repos.approvals.findDecisionByVersion(appContext.uow.db, auth.tenant, version.id),
      app.repos.projects.requireById(auth.tenant, changeOrder.projectId),
    ]);

    return reply.header('etag', versionEtag(version.id, version.lockVersion)).send({
      id: changeOrder.id,
      projectId: changeOrder.projectId,
      projectTitle: project.title,
      number: changeOrder.number,
      type: changeOrder.type,
      createdByUserId: changeOrder.createdByUserId,
      createdAt: changeOrder.createdAt.toISOString(),
      versionCount: versions.length,
      reversalOfChangeOrderId: changeOrder.reversalOfChangeOrderId,
      currentVersion: {
        id: version.id,
        changeOrderId: version.changeOrderId,
        projectId: version.projectId,
        versionNumber: version.versionNumber,
        status: version.status,
        statusLabel: STATUS_LABEL[version.status],
        title: version.title,
        scopeDescription: version.scopeDescription,
        reason: version.reason,
        type: version.type,
        currency: version.currency,
        totals: {
          subtotalDeltaMinor: Number(version.subtotalDeltaMinor),
          taxDeltaMinor: Number(version.taxDeltaMinor),
          totalDeltaMinor: Number(version.totalDeltaMinor),
          revisedContractTotalMinor:
            version.revisedContractTotalMinor === null
              ? null
              : Number(version.revisedContractTotalMinor),
          baselineTotalMinor: Number(version.baselineTotalMinor ?? project.baselineTotalMinor),
          priorApprovedDeltaMinor: Number(version.priorApprovedDeltaMinor ?? 0n),
          currency: version.currency,
        },
        lineItems: lineItems.map((l) => ({
          id: l.id,
          position: l.position,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          direction: l.direction,
          unitPriceMinor: Number(l.unitPriceMinor),
          taxRateBps: l.taxRateBps,
          subtotalMinor: Number(l.subtotalMinor),
          taxMinor: Number(l.taxMinor),
          totalMinor: Number(l.totalMinor),
        })),
        attachments: attachments.map((a) => ({
          id: a.fileObjectId,
          fileObjectId: a.fileObjectId,
          filename: a.filename,
          mimeType: a.mimeType,
          byteSize: Number(a.byteSize),
          sha256: a.sha256?.toString('hex') ?? null,
          scanStatus: a.scanStatus,
          caption: a.caption,
          position: a.position,
        })),
        schedule: {
          deltaDays: version.scheduleDeltaDays,
          revisedCompletionDate: version.revisedCompletionDate,
        },
        approver: {
          contactId: approver.id,
          name: approver.name,
          maskedPhone: maskedContactLabel(approver.phoneE164, null),
          maskedEmail: approver.emailNormalized
            ? maskedContactLabel(null, approver.emailNormalized)
            : null,
          authorityNote: approver.authorityNote,
        },
        assuranceRequired: version.assuranceRequired,
        canonicalSha256: version.canonicalSha256?.toString('hex') ?? null,
        canonicalizerVersion: version.canonicalizerVersion,
        termsVersion: version.termsVersion,
        sentAt: version.sentAt?.toISOString() ?? null,
        viewedAt: version.viewedAt?.toISOString() ?? null,
        decidedAt: version.decidedAt?.toISOString() ?? null,
        expiresAt: version.expiresAt?.toISOString() ?? null,
        createdAt: version.createdAt.toISOString(),
        updatedAt: version.updatedAt.toISOString(),
        lockVersion: version.lockVersion,
        etag: versionEtag(version.id, version.lockVersion),
      },
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        status: v.status,
        totalDeltaMinor: Number(v.totalDeltaMinor),
        scheduleDeltaDays: v.scheduleDeltaDays,
        sentAt: v.sentAt?.toISOString() ?? null,
        decidedAt: v.decidedAt?.toISOString() ?? null,
        canonicalSha256: v.canonicalSha256?.toString('hex') ?? null,
      })),
      decision: decision
        ? {
            id: decision.id,
            type: decision.type,
            signerName: decision.signerName,
            signerComment: decision.signerComment,
            assuranceAchieved: decision.assuranceAchieved,
            verifiedPhoneMasked: maskedContactLabel(decision.verifiedPhoneE164, null),
            occurredAt: decision.occurredAt.toISOString(),
            receiptId: decision.receiptDisplayId,
          }
        : null,
    });
  });

  /** Draft autosave. Requires `If-Match` (report §7.2). */
  app.patch('/v1/change-orders/:id/draft', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'change_order:update_draft');
    const { id } = IdParams.parse(request.params);

    const expectedLock = parseLockVersion(request.headers['if-match']);
    if (expectedLock === undefined) throw new AppError('MISSING_IF_MATCH');

    const input = UpdateDraftSchema.parse(request.body);
    const version = await app.services.changeOrders.updateDraft(auth, id, expectedLock, input);

    return reply.header('etag', versionEtag(version.id, version.lockVersion)).send({
      id,
      versionId: version.id,
      lockVersion: version.lockVersion,
      totals: {
        subtotalDeltaMinor: Number(version.subtotalDeltaMinor),
        taxDeltaMinor: Number(version.taxDeltaMinor),
        totalDeltaMinor: Number(version.totalDeltaMinor),
        currency: version.currency,
      },
    });
  });

  /** Server-calculated preview; the UI gates the send button on this (§6.3). */
  app.post('/v1/change-orders/:id/preview', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const preview = await app.services.changeOrders.preview(auth, id);
    const changeOrder = await app.repos.changeOrders.requireChangeOrder(
      appContext.uow.db,
      auth.tenant,
      id,
    );
    const lineItems = await app.repos.changeOrders.listLineItems(
      appContext.uow.db,
      preview.version.id,
    );

    return reply.send({
      totals: {
        subtotalDeltaMinor: Number(preview.totals.subtotalDeltaMinor),
        taxDeltaMinor: Number(preview.totals.taxDeltaMinor),
        totalDeltaMinor: Number(preview.totals.totalDeltaMinor),
        revisedContractTotalMinor: Number(preview.totals.revisedContractTotalMinor),
        baselineTotalMinor: Number(preview.totals.baselineTotalMinor),
        priorApprovedDeltaMinor: Number(preview.totals.priorApprovedDeltaMinor),
        currency: preview.totals.currency,
      },
      revisedCompletionDate: preview.revisedCompletionDate,
      customerView: {
        organizationName: preview.organizationName,
        projectTitle: preview.projectTitle,
        changeNumber: changeOrder.number,
        versionNumber: preview.version.versionNumber,
        title: preview.version.title,
        scope: preview.version.scopeDescription,
        lineItems: lineItems.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPriceMinor: Number(l.unitPriceMinor),
          taxRateBps: l.taxRateBps,
          totalMinor: Number(l.totalMinor),
        })),
        attachmentCount: preview.attachmentCount,
        scheduleDeltaDays: preview.version.scheduleDeltaDays,
        assuranceRequired: preview.version.assuranceRequired,
        approverName: preview.approverName,
        approverMaskedContact: preview.approverMaskedContact,
      },
      blockers: preview.blockers,
    });
  });

  /**
   * Send. The approval URL is returned exactly once, here, and is never logged
   * or stored in plaintext (report §3.4).
   */
  app.post('/v1/change-orders/:id/send', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'change_order:send');
    const { id } = IdParams.parse(request.params);
    const input = SendChangeOrderSchema.parse(request.body ?? {});

    const result = await app.services.send.send(auth, id, input);

    return reply.status(201).send({
      changeOrderId: result.changeOrderId,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
      status: 'SENT',
      approvalUrl: result.approvalUrl,
      expiresAt: result.expiresAt.toISOString(),
      canonicalSha256: result.canonicalSha256,
      share: {
        whatsappUrl: result.whatsappUrl,
        smsUrl: result.smsUrl,
        mailtoUrl: result.mailtoUrl,
        messageText: result.messageText,
      },
    });
  });

  app.post('/v1/change-orders/:id/share-intent', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const { channel } = ShareIntentSchema.parse(request.body ?? {});
    await app.services.send.recordShareIntent(auth, id, channel);
    return reply.status(204).send();
  });

  app.post('/v1/change-orders/:id/revisions', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'change_order:create_revision');
    const { id } = IdParams.parse(request.params);
    CreateRevisionSchema.parse(request.body ?? {});

    const version = await app.services.changeOrders.createRevision(auth, id);
    return reply.status(201).header('etag', versionEtag(version.id, version.lockVersion)).send({
      versionId: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      lockVersion: version.lockVersion,
    });
  });

  app.post('/v1/change-orders/:id/cancel', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'change_order:cancel');
    const { id } = IdParams.parse(request.params);
    const { reason } = CancelChangeOrderSchema.parse(request.body);
    await app.services.changeOrders.cancel(auth, id, reason);
    return reply.status(204).send();
  });

  app.post('/v1/change-orders/:id/reminders', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'change_order:remind');
    const { id } = IdParams.parse(request.params);
    const { channel } = RemindSchema.parse(request.body ?? {});
    const result = await app.services.send.remind(auth, id, channel);
    return reply.send({
      messageText: result.messageText,
      whatsappUrl: result.whatsappUrl,
      mailtoUrl: result.mailtoUrl,
      approvalUrl: null,
      cooldownUntil: result.cooldownUntil?.toISOString() ?? null,
    });
  });

  app.post('/v1/change-orders/:id/attachments', { preHandler: write }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    app.requireWrite(request, 'change_order:update_draft');
    const { id } = IdParams.parse(request.params);
    const input = RegisterAttachmentSchema.parse(request.body);
    await app.services.changeOrders.addAttachment(
      auth,
      id,
      input.fileObjectId,
      input.caption ?? null,
    );
    return reply.status(201).send({ fileObjectId: input.fileObjectId });
  });

  app.delete(
    '/v1/change-orders/:id/attachments/:attachmentId',
    { preHandler: write },
    async (request, reply) => {
      const auth = await app.requireAuth(request, reply);
      app.requireWrite(request, 'change_order:update_draft');
      const { id, attachmentId } = z
        .object({ id: z.string().uuid(), attachmentId: z.string().uuid() })
        .parse(request.params);
      await app.services.changeOrders.removeAttachment(auth, id, attachmentId);
      return reply.status(204).send();
    },
  );

  /** Version and decision history with a live chain verification (§8.5). */
  app.get('/v1/change-orders/:id/events', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);
    const changeOrder = await app.repos.changeOrders.requireChangeOrder(
      appContext.uow.db,
      auth.tenant,
      id,
    );
    authorize(auth.actor, 'change_order:read', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const [events, verification] = await Promise.all([
      readChain(appContext.uow.db, auth.tenant, 'change_order', id),
      verifyAggregateChain(appContext.uow.db, auth.tenant, 'change_order', id),
    ]);

    return reply.send({
      chainValid: verification.valid,
      events: events.map((e) => ({
        id: e.id,
        sequence: e.sequence,
        eventType: e.eventType,
        actorType: e.actorType,
        actorLabel: e.actorType === 'USER' ? 'Team member' : e.actorType,
        occurredAt: e.occurredAt.toISOString(),
        summary: summariseEvent(e.eventType, e.payload),
        eventHash: e.eventHash.toString('hex'),
        previousHash: e.previousHash?.toString('hex') ?? null,
      })),
    });
  });

  /** Evidence PDF status plus a short-lived signed link once READY. */
  app.get('/v1/change-orders/:id/evidence', { preHandler: read }, async (request, reply) => {
    const auth = await app.requireAuth(request, reply);
    const { id } = IdParams.parse(request.params);

    const changeOrder = await app.repos.changeOrders.requireChangeOrder(
      appContext.uow.db,
      auth.tenant,
      id,
    );
    authorize(auth.actor, 'change_order:read_evidence', {
      organizationId: changeOrder.organizationId,
      projectId: changeOrder.projectId,
    });

    const version = await app.repos.changeOrders.getCurrentVersion(auth.tenant, id);
    if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');

    const document = await app.repos.documents.findLatestForVersion(auth.tenant, version.id);
    if (!document) {
      return reply.send({
        id: null,
        versionId: version.id,
        status: 'PENDING',
        templateVersion: null,
        rendererVersion: null,
        fileSha256: null,
        generatedAt: null,
        downloadUrl: null,
        manifestSha256: null,
      });
    }

    const downloadUrl =
      document.status === 'READY' && document.storageKey
        ? await appContext.objectStore.createDownload(
            document.storageKey,
            app.env.SIGNED_URL_TTL_SECONDS,
            `${changeOrder.number}-v${version.versionNumber}-evidence.pdf`,
          )
        : null;

    return reply.send({
      id: document.id,
      versionId: version.id,
      status: document.status,
      templateVersion: document.templateVersion,
      rendererVersion: document.rendererVersion,
      fileSha256: document.fileSha256?.toString('hex') ?? null,
      generatedAt: document.generatedAt?.toISOString() ?? null,
      downloadUrl,
      manifestSha256: document.manifestSha256?.toString('hex') ?? null,
    });
  });
}

/** Human summary for the timeline; never echoes scope text or a token. */
function summariseEvent(eventType: string, payload: Record<string, unknown>): string {
  const version = payload.versionNumber ? ` (v${String(payload.versionNumber)})` : '';
  switch (eventType) {
    case 'change_order.created.v1':
      return `Change request created${version}`;
    case 'change_order.draft_updated.v1':
      return `Draft updated${version}`;
    case 'change_order.version_frozen.v1':
      return `Version frozen and hashed${version}`;
    case 'change_order.sent.v1':
      return `Sent for approval${version}`;
    case 'change_order.share_intent_opened.v1':
      return `Share sheet opened (${String(payload.channel ?? 'unknown')})`;
    case 'approval.request_viewed.v1':
      return `Customer opened the request${version}`;
    case 'approval.otp_sent.v1':
      return 'Verification code sent to the approver';
    case 'approval.phone_verified.v1':
      return 'Approver phone verified';
    case 'approval.decided.v1':
      return `Customer decision: ${String(payload.type ?? 'recorded')}`;
    case 'change_order.revision_requested.v1':
      return 'Customer asked for a revision';
    case 'change_order.superseded.v1':
      return 'Replaced by a newer version';
    case 'change_order.expired.v1':
      return 'Request expired';
    case 'change_order.cancelled.v1':
      return 'Request cancelled';
    case 'document.evidence_generated.v1':
      return 'Evidence pack generated';
    default:
      return eventType;
  }
}

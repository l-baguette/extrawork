import { AppError } from '@extrawork/contracts';
import type { InboundMessageRow, InboundStatus, VersionRow } from '@extrawork/db';
import {
  helpReply,
  incompleteReply,
  matchProject,
  notAuthorizedForProjectReply,
  overCeilingReply,
  parseIntakeMessage,
  projectClosedReply,
  sentToCustomerReply,
  unknownSenderReply,
  type Actor,
  type MatchCandidate,
  type ParsedIntake,
  type TenantContext,
} from '@extrawork/domain';
import type { AppContext, RequestContext } from '../context.js';
import type { ChangeOrderService } from '../change-orders/service.js';
import type { SendService } from '../change-orders/send.js';

/**
 * Turns one WhatsApp message into a change request sent to the customer.
 *
 * This is the whole employee-facing product: a person on site types a few lines
 * and everything else happens here. What it does NOT do is any domain work of
 * its own — pricing, canonical freezing, token minting, the audit chain and the
 * outbox all belong to `ChangeOrderService` and `SendService`, which the API
 * already uses. Duplicating any of that would let the WhatsApp path and the web
 * path disagree about money, which is the one divergence this system cannot
 * tolerate.
 *
 * Every branch writes to `inbound_messages` before returning, including the
 * ones that reject. An operator asked "my guy says he sent it and nothing
 * happened" needs to see the message, the reason, and the exact reply that went
 * back.
 */

export interface InboundWhatsAppMessage {
  provider?: string;
  providerAccountId?: string | null;
  /** Provider message id. Redelivery of the same id must not create a second request. */
  providerMessageId: string;
  fromPhoneE164: string;
  body: string;
  mediaCount?: number;
}

export interface IntakeOutcome {
  status: InboundStatus;
  /** What the employee is told. Always present — silence is never the answer. */
  reply: string;
  inboundMessageId: string;
  changeOrderId: string | null;
  approvalUrl: string | null;
  /** True when this exact provider message had already been processed. */
  duplicate: boolean;
  /**
   * The tenant the sender resolved to, or null when the number matched no
   * employee.
   *
   * Exposed because a caller holding attachments cannot safely act on them
   * until this is known: fetching media for an unrecognised number would let
   * anyone with the business number make the worker download and store
   * arbitrary bytes. Null means discard, not "look it up another way".
   */
  organizationId: string | null;
}

export class IntakeService {
  /**
   * The change-order services are injected rather than reached through
   * `AppContext`, which deliberately holds only repositories and gateways. That
   * keeps the dependency direction from report §14.2 intact and makes it
   * obvious that intake is a caller of the existing use cases, not a peer
   * reimplementation of them.
   */
  constructor(
    private readonly app: AppContext,
    private readonly changeOrders: ChangeOrderService,
    private readonly sender: SendService,
  ) {}

  async handleInbound(message: InboundWhatsAppMessage): Promise<IntakeOutcome> {
    // Logged first, before the sender is known. An unattributed message is
    // still evidence, and a crash later must not lose the fact it arrived.
    const { row, alreadySeen } = await this.app.uow.transaction((tx) =>
      this.app.repos.inboundMessages.record(tx, {
        providerMessageId: message.providerMessageId,
        provider: message.provider,
        providerAccountId: message.providerAccountId,
        fromPhoneE164: message.fromPhoneE164,
        body: message.body,
        mediaCount: message.mediaCount ?? 0,
      }),
    );

    if (alreadySeen && row.status !== 'RECEIVED') {
      // WhatsApp redelivers. Replaying would bill the customer twice for one
      // message, so the stored outcome is returned as-is.
      return {
        status: row.status,
        reply: row.replyText ?? '',
        inboundMessageId: row.id,
        changeOrderId: row.changeOrderId,
        approvalUrl: null,
        duplicate: true,
        organizationId: row.organizationId,
      };
    }

    const claimed = await this.app.uow.transaction((tx) =>
      this.app.repos.inboundMessages.claimForProcessing(tx, row.id),
    );
    if (!claimed) {
      throw new AppError('IDEMPOTENCY_IN_PROGRESS', {
        message: 'This inbound message is already being processed.',
      });
    }

    try {
      return await this.process(row, message);
    } catch (error) {
      // Infrastructure and provider failures are retryable. Keep the durable
      // checkpoint at RECEIVED and release its processing lease so the webhook
      // retry resumes instead of permanently rejecting or duplicating it.
      this.app.logger.error({ err: error, inboundMessageId: row.id }, 'intake failed unexpectedly');
      await this.app.uow.transaction((tx) =>
        this.app.repos.inboundMessages.recordRetryableError(
          tx,
          row.id,
          error instanceof Error ? error.message : 'unknown error',
        ),
      );
      throw error;
    }
  }

  private async process(
    inbound: InboundMessageRow,
    message: InboundWhatsAppMessage,
  ): Promise<IntakeOutcome> {
    const inboundId = inbound.id;
    // 1. Who is this? The phone number is the entire credential, and the global
    //    unique index guarantees it resolves to at most one active employee.
    const employee = await this.app.repos.employees.findByPhoneGlobal(message.fromPhoneE164);
    if (!employee || employee.status !== 'ACTIVE') {
      const reply = unknownSenderReply();
      await this.finish(inboundId, 'REJECTED_UNKNOWN_SENDER', reply, {
        rejectionReason: employee
          ? `employee is ${employee.status}`
          : 'no employee for this number',
      });
      return this.outcome('REJECTED_UNKNOWN_SENDER', reply, inboundId, null);
    }

    // From here the tenant is known and every read is scoped to it.
    const tenant = this.systemTenant(employee.organizationId, inboundId);
    const organization = await this.app.repos.organizations.findById(tenant);
    if (!organization) throw new AppError('ORGANIZATION_REQUIRED');
    const currency = organization.defaultCurrency;

    const parsed = parseIntakeMessage(message.body);

    // A bare "help" gets the format rather than a complaint about it.
    const candidates = await this.visibleProjects(
      tenant,
      employee.allProjects,
      employee.projectIds,
    );
    if (/^\s*(help|\?|format|how)\s*$/i.test(message.body)) {
      const reply = helpReply(
        employee.name,
        candidates.map((c) => c.title),
      );
      await this.finish(inboundId, 'REJECTED_UNPARSEABLE', reply, {
        employeeId: employee.id,
        organizationId: employee.organizationId,
        parsed: describe(parsed),
        rejectionReason: 'help requested',
      });
      return this.outcome('REJECTED_UNPARSEABLE', reply, inboundId, employee.organizationId);
    }

    // 2. Which project? Never guessed between two plausible ones.
    const match = matchProject(parsed.project, candidates);
    if (match.kind === 'AMBIGUOUS' || match.kind === 'NONE') {
      const reply = notAuthorizedForProjectReply(
        parsed.project,
        (match.kind === 'AMBIGUOUS' ? match.candidates : candidates).map((c) => c.title),
      );
      await this.finish(inboundId, 'REJECTED_NOT_AUTHORIZED', reply, {
        employeeId: employee.id,
        organizationId: employee.organizationId,
        parsed: describe(parsed),
        rejectionReason: match.kind === 'AMBIGUOUS' ? 'ambiguous project' : 'no project available',
      });
      return this.outcome('REJECTED_NOT_AUTHORIZED', reply, inboundId, employee.organizationId);
    }
    const project = match.project;

    // 3. Is the message complete enough to price? `requiresProject` is false
    //    because the match above already resolved it.
    const validation = validate(parsed);
    if (!validation.ok) {
      const reply = incompleteReply(parsed, validation.missing, validation.problems, currency);
      await this.finish(inboundId, 'REJECTED_UNPARSEABLE', reply, {
        employeeId: employee.id,
        organizationId: employee.organizationId,
        projectId: project.id,
        parsed: describe(parsed),
        rejectionReason: `missing: ${validation.missing.join(',') || 'none'}`,
      });
      return this.outcome('REJECTED_UNPARSEABLE', reply, inboundId, employee.organizationId);
    }

    const amountMinor = parsed.amountMinor ?? 0n;
    const days = parsed.days ?? 0;

    // 4. Policy. The ceiling is the owner's principal control, so it is checked
    //    before anything is written and the employee is told the real number.
    if (employee.maxRequestMinor !== null && amountMinor > employee.maxRequestMinor) {
      const reply = overCeilingReply(amountMinor, employee.maxRequestMinor, currency);
      await this.finish(inboundId, 'REJECTED_POLICY', reply, {
        employeeId: employee.id,
        organizationId: employee.organizationId,
        projectId: project.id,
        parsed: describe(parsed),
        rejectionReason: `over ceiling ${employee.maxRequestMinor}`,
      });
      return this.outcome('REJECTED_POLICY', reply, inboundId, employee.organizationId);
    }

    const projectRow = await this.app.repos.projects.requireById(tenant, project.id);
    if (projectRow.status !== 'ACTIVE') {
      const reply = projectClosedReply(projectRow.title);
      await this.finish(inboundId, 'REJECTED_POLICY', reply, {
        employeeId: employee.id,
        organizationId: employee.organizationId,
        projectId: project.id,
        parsed: describe(parsed),
        rejectionReason: `project is ${projectRow.status}`,
      });
      return this.outcome('REJECTED_POLICY', reply, inboundId, employee.organizationId);
    }
    if (!projectRow.defaultApproverContactId) {
      const reply =
        `"${projectRow.title}" has no approver recorded, so I cannot send this to anyone. ` +
        'Ask your site manager to add the client contact.';
      await this.finish(inboundId, 'REJECTED_POLICY', reply, {
        employeeId: employee.id,
        organizationId: employee.organizationId,
        projectId: project.id,
        parsed: describe(parsed),
        rejectionReason: 'no default approver',
      });
      return this.outcome('REJECTED_POLICY', reply, inboundId, employee.organizationId);
    }

    // 5. Create and send through the same services the web composer uses.
    const ctx = this.intakeContext(tenant, project.id);
    let created: {
      changeOrderId: string;
      number: string;
      version: VersionRow;
    };

    if (inbound.changeOrderId) {
      const existing = await this.app.repos.changeOrders.requireChangeOrder(
        this.app.uow.db,
        tenant,
        inbound.changeOrderId,
      );
      if (existing.projectId !== project.id) {
        throw new AppError('INTERNAL_ERROR', {
          message: 'Inbound checkpoint is linked to the wrong project.',
        });
      }
      const version = await this.app.repos.changeOrders.getCurrentVersion(
        tenant,
        inbound.changeOrderId,
      );
      if (!version) throw new AppError('CHANGE_ORDER_NOT_FOUND');
      created = { changeOrderId: existing.id, number: existing.number, version };
    } else {
      created = await this.changeOrders.create(
        ctx,
        project.id,
        {
          type: amountMinor === 0n ? 'TIME_ONLY' : 'ADDITION',
          title: titleFrom(parsed),
          scope: parsed.description ?? '',
          ...(parsed.reason ? { reason: parsed.reason } : {}),
          // One line item priced at the figure the employee gave. The money engine
          // computes the totals; nothing here does arithmetic.
          lineItems:
            amountMinor === 0n
              ? []
              : [
                  {
                    description: titleFrom(parsed),
                    quantity: '1',
                    unit: 'item',
                    unitPriceMinor: Number(amountMinor),
                    // The employee quotes one all-in figure, not a pre-tax rate, so
                    // adding tax here would inflate what they were told it costs.
                    taxRateBps: 0,
                    direction: 1 as const,
                  },
                ],
          scheduleDeltaDays: days,
          approverContactId: projectRow.defaultApproverContactId,
          assuranceRequired: 'A0' as const,
        },
        {
          afterCreate: (tx, checkpoint) =>
            this.app.repos.inboundMessages.markProgress(tx, inboundId, {
              organizationId: employee.organizationId,
              employeeId: employee.id,
              projectId: project.id,
              changeOrderId: checkpoint.changeOrderId,
              parsed: describe(parsed),
            }),
        },
      );
    }

    let approvalUrl: string | null = null;
    let versionId = created.version.id;
    if (created.version.status === 'DRAFT') {
      const sent = await this.sender.send(ctx, created.changeOrderId, {
        channel: 'WHATSAPP' as const,
      });
      approvalUrl = sent.approvalUrl;
      versionId = sent.versionId;
    }

    await this.app.uow.transaction((tx) =>
      this.app.repos.changeOrders.markIntakeOrigin(tx, tenant, versionId, employee.id),
    );

    const customer = await this.app.repos.customers.requireById(tenant, projectRow.customerId);
    const reply = sentToCustomerReply({
      changeNumber: created.number,
      projectTitle: projectRow.title,
      customerName: customer.displayName,
      amountMinor,
      days,
      currency,
    });

    await this.finish(inboundId, 'ACCEPTED', reply, {
      employeeId: employee.id,
      organizationId: employee.organizationId,
      projectId: project.id,
      changeOrderId: created.changeOrderId,
      parsed: describe(parsed),
    });

    return {
      status: 'ACCEPTED',
      reply,
      inboundMessageId: inboundId,
      changeOrderId: created.changeOrderId,
      approvalUrl,
      duplicate: false,
      organizationId: employee.organizationId,
    };
  }

  /** Projects this employee may raise against, as match candidates. */
  private async visibleProjects(
    tenant: TenantContext,
    allProjects: boolean,
    assignedIds: string[],
  ): Promise<MatchCandidate[]> {
    const page = await this.app.repos.projects.list(tenant, { limit: 100 });
    const visible = allProjects ? page.items : page.items.filter((p) => assignedIds.includes(p.id));
    return visible
      .filter((p) => p.status === 'ACTIVE')
      .map((p) => ({
        id: p.id,
        projectNumber: p.projectNumber,
        title: p.title,
        customerName: p.customerName,
      }));
  }

  private systemTenant(organizationId: string, inboundId: string): TenantContext {
    return {
      organizationId,
      userId: null,
      role: 'SYSTEM',
      requestId: `intake:${inboundId}`,
    };
  }

  /**
   * The context the change-order services run under.
   *
   * `userId` is null and `actorType` will be SYSTEM: the employee has no user
   * account, and naming one who did not act would falsify an append-only
   * record. The person who actually raised it is stored as
   * `change_order_versions.raised_by_employee_id`.
   *
   * PROJECT_MANAGER is the narrowest existing role that may create and send a
   * change request. The grant contains only the resolved project, so this
   * machine context cannot use broader owner powers or reach another project.
   */
  private intakeContext(tenant: TenantContext, projectId: string): RequestContext {
    const actor: Actor = {
      userId: null,
      organizationId: tenant.organizationId,
      role: 'PROJECT_MANAGER',
      projectGrants: new Set([projectId]),
      authenticatedAt: Date.now(),
    };
    return {
      actor,
      tenant,
      requestId: tenant.requestId,
      sessionId: null,
      ipHash: null,
      userAgent: 'extrawork-whatsapp-intake',
      readOnly: false,
    };
  }

  private async finish(
    inboundId: string,
    status: InboundStatus,
    reply: string,
    extra: {
      organizationId?: string;
      employeeId?: string;
      projectId?: string;
      changeOrderId?: string;
      parsed?: Record<string, unknown>;
      rejectionReason?: string;
    } = {},
  ): Promise<void> {
    await this.app.uow.transaction((tx) =>
      this.app.repos.inboundMessages.markProcessed(tx, inboundId, {
        status,
        replyText: reply,
        ...extra,
      }),
    );
  }

  private outcome(
    status: InboundStatus,
    reply: string,
    inboundMessageId: string,
    organizationId: string | null,
  ): IntakeOutcome {
    return {
      status,
      reply,
      inboundMessageId,
      changeOrderId: null,
      approvalUrl: null,
      duplicate: false,
      organizationId,
    };
  }
}

/**
 * Validation for an intake whose project has already been resolved. The parser
 * exposes `validateIntake`, but it asks about the project too; by this point the
 * match step has settled that, so re-asking would confuse the employee.
 */
function validate(parsed: ParsedIntake): { ok: boolean; missing: never[]; problems: string[] } {
  const problems: string[] = [];
  const missing: never[] = [];

  if (!parsed.description || parsed.description.trim().length < 10) {
    problems.push(
      'Tell me what the work is, in a few words. For example:  Two extra power points in the kitchen',
    );
  }
  if (parsed.amountAmbiguous) {
    problems.push(
      `I could not read the amount "${parsed.amountRaw ?? ''}" as a single figure. ` +
        'Send one exact number, for example:  Cost: 15800',
    );
  } else if (parsed.amountMinor === null && (parsed.days ?? 0) === 0) {
    // Zero cost AND zero schedule impact is not a change at all; the domain
    // would reject it as EMPTY_CHANGE, so it is caught here with a readable
    // sentence instead of an error code.
    problems.push('How much extra will this cost? For example:  Cost: 15800');
  }

  return { ok: problems.length === 0, missing, problems };
}

function titleFrom(parsed: ParsedIntake): string {
  const text = (parsed.description ?? 'Extra work').replace(/\s+/g, ' ').trim();
  return text.length <= 120 ? text : `${text.slice(0, 117)}…`;
}

/** The parser's understanding, as JSON for the inbound log. */
function describe(parsed: ParsedIntake): Record<string, unknown> {
  return {
    project: parsed.project,
    description: parsed.description,
    reason: parsed.reason,
    amountMinor: parsed.amountMinor === null ? null : parsed.amountMinor.toString(),
    amountRaw: parsed.amountRaw,
    amountAmbiguous: parsed.amountAmbiguous,
    days: parsed.days,
    unrecognized: parsed.unrecognized,
  };
}

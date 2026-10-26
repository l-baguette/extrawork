import { createHash } from 'node:crypto';
import {
  AppError,
  CHANGE_ATTACHMENT_MIME_TYPES,
  DOMAIN_EVENTS,
  JOB_KINDS,
  type ProposalInput,
} from '@extrawork/contracts';
import {
  enqueueJob,
  isAwaitingReview,
  newId,
  runInScope,
  SYSTEM_SCOPE,
  type ContactRow,
  type ConversationCandidate,
  type ConversationRow,
  type EmployeeWithAssignments,
  type InboundMessageRow,
  type InboundStatus,
  type LastItem,
  type PendingChoice,
  type StoredMediaRef,
  type TransactionContext,
  type VersionRow,
} from '@extrawork/db';
import {
  aboveLimitNote,
  alreadyConvertedReply,
  cannotConvertReply,
  channelHelpReply,
  chooseProjectReply,
  choiceExpiredReply,
  choiceOutOfRangeReply,
  classifyMessage,
  defaultNoteTitle,
  explicitProjectHint,
  heldNoteForDesigners,
  normalizeForSearch,
  nothingToConvertReply,
  notAuthorizedForProjectReply,
  openRequestsReply,
  parseChoice,
  parseIntakeMessage,
  parserSignals,
  portalLinksReply,
  projectLabel,
  projectsReply,
  proposedReply,
  routeProject,
  savedReply,
  sentToCustomerReply,
  unknownSenderReply,
  unreadableAmountNote,
  type IntakeCommand,
  type ParsedIntake,
  type TenantContext,
} from '@extrawork/domain';
import { StorageKeys, sanitizeFilename } from '@extrawork/files';
import type { AppContext } from '../context.js';
import type { ChangeOrderService } from '../change-orders/service.js';
import type { SendService } from '../change-orders/send.js';
import { NotificationService } from '../notifications/service.js';
import type { PortalService } from '../portal/service.js';
import { channelRequestContext } from './system-context.js';

/**
 * WhatsApp as a project channel — spec 2026-10-12, D6/D7 and the "WhatsApp
 * conversation rules".
 *
 * A message from a site-team number or a homeowner's number is identified
 * across every workspace, attached to one project (asking once when that is not
 * certain), classified as a request or as content, and acted on: a request
 * becomes a proposal for the designer, content is filed in the project's
 * "From WhatsApp" folder. Every reply says what happened and offers the
 * one-word correction.
 *
 * What it still does NOT do is any domain work of its own. Pricing, canonical
 * freezing, token minting, the audit chain and the outbox belong to
 * `ChangeOrderService` and `SendService`, which the web app uses too.
 * Duplicating any of that would let the WhatsApp path and the web path
 * disagree about money, which is the one divergence this system cannot
 * tolerate.
 *
 * Every branch writes to `inbound_messages` before returning, including the
 * ones that reject. An operator asked "my guy says he sent it and nothing
 * happened" needs to see the message, the reason, and the exact reply that went
 * back.
 *
 * Everything runs under the system scope. The sender's phone number is what
 * establishes the tenant (there is none to set beforehand), the conversation
 * table is cross-tenant routing state that RLS admits only to the system
 * scope, and the API's simulator route has no default scope to fall back on.
 * Tenant isolation inside is the repositories' explicit `organization_id`
 * scoping, with each tenant derived from the sender's own roster or contact
 * entries.
 */

export interface InboundWhatsAppMessage {
  provider?: string;
  providerAccountId?: string | null;
  /** Provider message id. Redelivery of the same id must not create a second request. */
  providerMessageId: string;
  fromPhoneE164: string;
  body: string;
  mediaCount?: number;
  /**
   * Provider attachment handles, recorded with the message so a message held
   * for a project choice can still have its media fetched once answered.
   */
  media?: StoredMediaRef[];
}

export interface IntakeOutcome {
  status: InboundStatus;
  /** What the sender is told. Always present — silence is never the answer. */
  reply: string;
  inboundMessageId: string;
  changeOrderId: string | null;
  approvalUrl: string | null;
  /** True when this exact provider message had already been processed. */
  duplicate: boolean;
  /**
   * The tenant the message was filed into, or null when it was not filed
   * anywhere (unknown sender, held for a choice, rejected across workspaces).
   *
   * Callers must not fetch media on the strength of this alone — `storeMedia`
   * makes that decision from the stored row — but null always means "do not
   * fetch": downloading for an unrecognised number would let anyone with the
   * business number make the worker store arbitrary bytes.
   */
  organizationId: string | null;
}

/** A reply sent outside any inbound message, by the hourly expiry sweep. */
export interface ExpiredChoiceReply {
  phoneE164: string;
  reply: string;
}

/** A project the sender may be talking about, with what routing needs. */
interface Candidate extends ConversationCandidate {
  /** `projectId`, under the name `matchProject` expects. */
  id: string;
  customerName: string;
}

/** One roster or contact entry the phone number resolved to. */
interface SenderEntry {
  kind: 'EMPLOYEE' | 'CONTACT';
  id: string;
  organizationId: string;
  name: string;
  /** Site team only: the owner's per-request ceiling. Null means none. */
  maxRequestMinor: bigint | null;
}

interface Identity {
  phoneE164: string;
  candidates: Candidate[];
  entries: SenderEntry[];
  /** For the greeting; the first entry's name. */
  name: string;
}

interface ActResult {
  status: InboundStatus;
  reply: string;
  changeOrderId: string | null;
  approvalUrl: string | null;
  documentId: string | null;
  organizationId: string | null;
}

const PENDING_MINUTES = 30;
const STICKY_HOURS = 2;
const USER_AGENT = 'extrawork-whatsapp-intake';
const DISMISS_REASON = 'The sender said on WhatsApp that this was just for the record.';

export class IntakeService {
  /**
   * The change-order and portal services are injected rather than reached
   * through `AppContext`, which deliberately holds only repositories and
   * gateways. That keeps the dependency direction from report §14.2 intact and
   * makes it obvious that intake is a caller of the existing use cases, not a
   * peer reimplementation of them.
   */
  constructor(
    private readonly app: AppContext,
    private readonly changeOrders: ChangeOrderService,
    private readonly sender: SendService,
    private readonly portal: PortalService,
  ) {}

  async handleInbound(message: InboundWhatsAppMessage): Promise<IntakeOutcome> {
    return runInScope(SYSTEM_SCOPE, () => this.handleInScope(message));
  }

  private async handleInScope(message: InboundWhatsAppMessage): Promise<IntakeOutcome> {
    // Logged first, before the sender is known. An unattributed message is
    // still evidence, and a crash later must not lose the fact it arrived.
    const { row, alreadySeen } = await this.app.uow.transaction((tx) =>
      this.app.repos.inboundMessages.record(tx, {
        providerMessageId: message.providerMessageId,
        provider: message.provider,
        providerAccountId: message.providerAccountId,
        fromPhoneE164: message.fromPhoneE164,
        body: message.body,
        mediaCount: message.mediaCount ?? message.media?.length ?? 0,
        mediaRefs: message.media ?? [],
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
        organizationId: row.status === 'AWAITING_CHOICE' ? null : row.organizationId,
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
      return await this.process(row);
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

  private async process(inbound: InboundMessageRow): Promise<IntakeOutcome> {
    const body = inbound.body ?? '';

    // 1. Identify: every roster entry and contact with this number, in every
    //    workspace. The phone number is the entire credential.
    const identity = await this.identify(inbound.fromPhoneE164);
    if (identity.entries.length === 0) {
      const status = await this.app.repos.employees.inactiveStatusForPhone(inbound.fromPhoneE164);
      const reply = unknownSenderReply();
      await this.finish(inbound.id, 'REJECTED_UNKNOWN_SENDER', reply, {
        rejectionReason: status
          ? `employee is ${status}`
          : 'no site-team member or contact for this number',
      });
      return this.outcome('REJECTED_UNKNOWN_SENDER', reply, inbound.id, null);
    }
    if (identity.candidates.length === 0) {
      const reply = identity.entries.some((e) => e.kind === 'EMPLOYEE')
        ? notAuthorizedForProjectReply(null, [])
        : portalLinksReply([]);
      const only = singleEntry(identity.entries);
      await this.finish(inbound.id, 'REJECTED_NOT_AUTHORIZED', reply, {
        ...(only ? senderColumns(only) : {}),
        rejectionReason: 'no active project for this sender',
      });
      return this.outcome('REJECTED_NOT_AUTHORIZED', reply, inbound.id, only?.organizationId ?? null);
    }

    // A retry of an answer whose held messages were already pointed at a
    // project: finish filing them rather than reading "2" as a new message.
    const resolved = await this.app.repos.inboundMessages.listResolvedBy(
      this.app.uow.db,
      inbound.id,
    );
    if (resolved.length > 0) return this.fileHeld(inbound, resolved, identity);

    const now = this.app.clock.now();
    let conversation = await this.app.repos.conversations.findByPhone(inbound.fromPhoneE164);
    let prefix: string | null = null;

    // 2. A question nobody answered in time is closed before anything else,
    //    so a late "2" cannot file a message the designers were told was lost.
    if (conversation?.pending && isExpired(conversation, now)) {
      const expired = await this.expireChoice(inbound.fromPhoneE164);
      conversation = await this.app.repos.conversations.findByPhone(inbound.fromPhoneE164);
      if (expired) {
        prefix = expired;
        if (parseChoice(body) && inbound.mediaCount === 0) {
          await this.finish(inbound.id, 'ANSWERED', expired, {
            rejectionReason: 'answer arrived after the choice expired',
          });
          return this.outcome('ANSWERED', expired, inbound.id, null);
        }
      }
    }

    // 3. An answer to "which project?".
    if (conversation?.pending && inbound.mediaCount === 0) {
      const choice = parseChoice(body);
      if (choice) return this.answerChoice(inbound, choice, identity);
    }

    // 4. Commands, then the project, then the kind.
    const parsed = parseIntakeMessage(body);
    const intent = classifyMessage(body, inbound.mediaCount, parserSignals(parsed));
    if (intent.kind === 'COMMAND') {
      return this.command(inbound, intent, identity, conversation, prefix);
    }

    const sticky =
      conversation?.stickyProjectId &&
      conversation.stickyOrganizationId &&
      conversation.stickyUntil &&
      conversation.stickyUntil > now
        ? {
            organizationId: conversation.stickyOrganizationId,
            projectId: conversation.stickyProjectId,
          }
        : null;
    const route = routeProject({
      hint: explicitProjectHint(body, parsed.project),
      candidates: identity.candidates,
      sticky,
    });
    if (route.kind === 'ASK') return this.hold(inbound, route.candidates, parsed, prefix);

    const result = await this.actSafely(inbound, route.candidate, identity, {
      prefix,
      notifyKey: `whatsapp-saved:${inbound.id}`,
    });
    return {
      status: result.status,
      reply: result.reply,
      inboundMessageId: inbound.id,
      changeOrderId: result.changeOrderId,
      approvalUrl: result.approvalUrl,
      duplicate: false,
      organizationId: result.organizationId,
    };
  }

  // --- Identify ---------------------------------------------------------------

  private async identify(phoneE164: string): Promise<Identity> {
    const employees = await this.app.repos.employees.findAllByPhone(phoneE164);
    const contacts = await this.app.repos.customers.findContactsByPhoneGlobal(phoneE164);

    const entries: SenderEntry[] = [
      ...employees.map(employeeEntry),
      ...contacts.map(contactEntry),
    ];
    const byProject = new Map<string, Candidate>();
    const organizationNames = new Map<string, string>();

    const nameOf = async (tenant: TenantContext): Promise<string> => {
      const known = organizationNames.get(tenant.organizationId);
      if (known !== undefined) return known;
      const organization = await this.app.repos.organizations.findById(tenant);
      const name = organization?.displayName ?? '';
      organizationNames.set(tenant.organizationId, name);
      return name;
    };

    // Site-team entries first, so a person who is both on a project's site
    // team and a contact of its customer is treated as site team there: that
    // is the role with a ceiling and a roster the designer manages.
    for (const employee of employees) {
      const tenant = this.systemTenant(employee.organizationId, `intake:${phoneE164}`);
      const page = await this.app.repos.projects.list(tenant, { status: 'ACTIVE', limit: 100 });
      const organizationName = await nameOf(tenant);
      for (const project of page.items) {
        if (!employee.allProjects && !employee.projectIds.includes(project.id)) continue;
        if (byProject.has(project.id)) continue;
        byProject.set(project.id, {
          id: project.id,
          organizationId: employee.organizationId,
          projectId: project.id,
          projectNumber: project.projectNumber,
          title: project.title,
          customerName: project.customerName,
          organizationName,
          sender: { kind: 'EMPLOYEE', id: employee.id },
        });
      }
    }
    for (const contact of contacts) {
      const tenant = this.systemTenant(contact.organizationId, `intake:${phoneE164}`);
      const page = await this.app.repos.projects.list(tenant, {
        status: 'ACTIVE',
        customerId: contact.customerId,
        limit: 100,
      });
      const organizationName = await nameOf(tenant);
      for (const project of page.items) {
        if (byProject.has(project.id)) continue;
        byProject.set(project.id, {
          id: project.id,
          organizationId: contact.organizationId,
          projectId: project.id,
          projectNumber: project.projectNumber,
          title: project.title,
          customerName: project.customerName,
          organizationName,
          sender: { kind: 'CONTACT', id: contact.id },
        });
      }
    }

    return {
      phoneE164,
      candidates: [...byProject.values()],
      entries,
      name: entries[0]?.name ?? 'there',
    };
  }

  // --- Asking, answering, expiring --------------------------------------------

  /** Holds the message and asks once which project it is for. */
  private async hold(
    inbound: InboundMessageRow,
    listed: Candidate[],
    parsed: ParsedIntake,
    prefix: string | null,
  ): Promise<IntakeOutcome> {
    const now = this.app.clock.now();
    const reply = await this.app.uow.transaction(async (tx) => {
      const conversation = await this.app.repos.conversations.lockForPhone(
        tx,
        inbound.fromPhoneE164,
      );
      // A second message while the question is open — the next photo of an
      // album, usually — joins the held batch under the list already shown,
      // so the one answer means the same project for all of them.
      const open =
        conversation.pending && !isExpired(conversation, now) ? conversation.pending : null;
      const pending: PendingChoice = open
        ? {
            inboundMessageIds: [...new Set([...open.inboundMessageIds, inbound.id])],
            candidates: open.candidates,
          }
        : { inboundMessageIds: [inbound.id], candidates: listed.map(toConversationCandidate) };
      await this.app.repos.conversations.setPending(
        tx,
        inbound.fromPhoneE164,
        pending,
        new Date(now.getTime() + PENDING_MINUTES * 60_000),
      );
      const text = withPrefix(prefix, chooseProjectReply(labelsFor(pending.candidates)));
      await this.app.repos.inboundMessages.markProcessed(tx, inbound.id, {
        status: 'AWAITING_CHOICE',
        parsed: describe(parsed),
        replyText: text,
      });
      return text;
    });
    // Not filed anywhere yet, so no tenant: media stays unfetched until the
    // answer says where it belongs.
    return this.outcome('AWAITING_CHOICE', reply, inbound.id, null);
  }

  private async answerChoice(
    answer: InboundMessageRow,
    choice: IntakeCommand,
    identity: Identity,
  ): Promise<IntakeOutcome> {
    const resolution = await this.app.uow.transaction(async (tx) => {
      const conversation = await this.app.repos.conversations.lockForPhone(
        tx,
        answer.fromPhoneE164,
      );
      const pending = conversation.pending;
      if (!pending) return { kind: 'GONE' as const };
      const picked = pickListed(pending.candidates, choice);
      // Re-resolved against who the sender is now: someone taken off a project
      // since the question was asked cannot file into it by answering.
      const chosen =
        picked &&
        identity.candidates.find(
          (c) => c.projectId === picked.projectId && c.organizationId === picked.organizationId,
        );
      if (!chosen) return { kind: 'OUT_OF_RANGE' as const, count: pending.candidates.length };

      for (const heldId of pending.inboundMessageIds) {
        await this.app.repos.inboundMessages.markResolvedBy(tx, heldId, answer.id, {
          organizationId: chosen.organizationId,
          projectId: chosen.projectId,
          employeeId: chosen.sender.kind === 'EMPLOYEE' ? chosen.sender.id : null,
          contactId: chosen.sender.kind === 'CONTACT' ? chosen.sender.id : null,
        });
      }
      await this.app.repos.conversations.clearPending(tx, answer.fromPhoneE164);
      return { kind: 'CHOSEN' as const, heldIds: pending.inboundMessageIds };
    });

    if (resolution.kind === 'CHOSEN') return this.fileHeld(answer, resolution.heldIds, identity);

    // Another message answered it a moment ago, or the number is not on the
    // list: either way, nothing is filed on a guess.
    const reply =
      resolution.kind === 'OUT_OF_RANGE'
        ? choiceOutOfRangeReply(resolution.count)
        : nothingToConvertReply();
    await this.finish(answer.id, 'ANSWERED', reply, { rejectionReason: 'choice not understood' });
    return this.outcome('ANSWERED', reply, answer.id, null);
  }

  /** Files every held message an answer resolved, in the order they arrived. */
  private async fileHeld(
    answer: InboundMessageRow,
    heldIds: string[],
    identity: Identity,
  ): Promise<IntakeOutcome> {
    const results: ActResult[] = [];
    let chosen: Candidate | null = null;

    for (const heldId of heldIds) {
      const held = await this.app.repos.inboundMessages.findForIntake(this.app.uow.db, heldId);
      if (!held) continue;
      const candidate =
        identity.candidates.find(
          (c) => c.projectId === held.projectId && c.organizationId === held.organizationId,
        ) ?? null;
      if (held.status !== 'AWAITING_CHOICE') {
        // Filed on an earlier attempt of this answer.
        results.push(storedResult(held));
        chosen ??= candidate;
        continue;
      }
      if (!candidate) {
        const reply = notAuthorizedForProjectReply(null, []);
        await this.finish(held.id, 'REJECTED_NOT_AUTHORIZED', reply, {
          rejectionReason: 'sender no longer on the chosen project',
        });
        results.push({ ...emptyResult('REJECTED_NOT_AUTHORIZED', reply) });
        continue;
      }
      chosen ??= candidate;
      results.push(
        await this.actSafely(held, candidate, identity, {
          prefix: null,
          // One notification for the whole held batch, not one per photo.
          notifyKey: `whatsapp-saved:${answer.id}`,
        }),
      );
    }

    const reply = combineReplies(results, chosen);
    const changeOrderId = results.find((r) => r.changeOrderId)?.changeOrderId ?? null;
    const sender = chosen ? senderOf(chosen) : null;
    await this.finish(answer.id, 'ANSWERED', reply, {
      ...(chosen && sender
        ? { ...senderColumns(sender), projectId: chosen.projectId, changeOrderId }
        : {}),
    });
    return {
      status: 'ANSWERED',
      reply,
      inboundMessageId: answer.id,
      changeOrderId,
      approvalUrl: results.find((r) => r.approvalUrl)?.approvalUrl ?? null,
      duplicate: false,
      organizationId: chosen?.organizationId ?? null,
    };
  }

  /**
   * The hourly sweep's half of the 30-minute rule: every question that ran out
   * is closed, the held messages are marked, the candidate projects' designers
   * are told, and the sender gets one polite reply each (returned for the
   * worker to send, because no provider call happens in here).
   */
  async expireStaleChoices(): Promise<ExpiredChoiceReply[]> {
    return runInScope(SYSTEM_SCOPE, async () => {
      const stale = await this.app.repos.conversations.listExpiredPending(this.app.clock.now());
      const replies: ExpiredChoiceReply[] = [];
      for (const conversation of stale) {
        const reply = await this.expireChoice(conversation.phoneE164);
        if (reply) replies.push({ phoneE164: conversation.phoneE164, reply });
      }
      return replies;
    });
  }

  /**
   * Closes the phone's pending question if it has run out. Returns the reply
   * to send, or null when there was nothing to expire (answered meanwhile, or
   * not yet due). Shared by the sweep and by the next inbound message, so a
   * late answer and the sweep cannot both act on one question.
   */
  private async expireChoice(phoneE164: string): Promise<string | null> {
    const now = this.app.clock.now();
    return this.app.uow.transaction(async (tx) => {
      const conversation = await this.app.repos.conversations.lockForPhone(tx, phoneE164);
      const pending = conversation.pending;
      if (!pending || !isExpired(conversation, now)) return null;

      // Attributed to the workspace only when there was just one to choose
      // from; across firms, nobody may see a message meant for another.
      const organizations = new Set(pending.candidates.map((c) => c.organizationId));
      const onlyOrganization = organizations.size === 1 ? pending.candidates[0] : undefined;

      let excerpt: string | null = null;
      for (const heldId of pending.inboundMessageIds) {
        const held = await this.app.repos.inboundMessages.findForIntake(tx.db, heldId);
        if (!held || held.status !== 'AWAITING_CHOICE') continue;
        excerpt ??=
          held.body?.trim() ||
          (held.mediaCount > 0
            ? `${held.mediaCount} attachment${held.mediaCount === 1 ? '' : 's'}`
            : null);
        await this.app.repos.inboundMessages.markProcessed(tx, held.id, {
          status: 'REJECTED_NOT_AUTHORIZED',
          ...(onlyOrganization
            ? {
                organizationId: onlyOrganization.organizationId,
                employeeId:
                  onlyOrganization.sender.kind === 'EMPLOYEE' ? onlyOrganization.sender.id : null,
                contactId:
                  onlyOrganization.sender.kind === 'CONTACT' ? onlyOrganization.sender.id : null,
              }
            : {}),
          parsed: held.parsed,
          rejectionReason: 'project choice expired',
          replyText: held.replyText,
        });
      }

      const notifications = new NotificationService(this.app);
      const first = pending.inboundMessageIds[0] ?? 'none';
      for (const candidate of pending.candidates) {
        const tenant = this.systemTenant(candidate.organizationId, `intake-expiry:${first}`);
        await notifications.notifyProject(tx, tenant, {
          projectId: candidate.projectId,
          audience: 'DESIGNERS',
          kind: 'WHATSAPP_ATTENTION',
          title: 'A WhatsApp message needs a project',
          body: heldNoteForDesigners(onlyOrganization ? excerpt : null),
          linkPath: `/app/projects/${candidate.projectId}`,
          dedupeKey: `whatsapp-expired:${first}:${candidate.projectId}`,
        });
      }

      await this.app.repos.conversations.clearPending(tx, phoneE164);
      return choiceExpiredReply();
    });
  }

  // --- Commands ---------------------------------------------------------------

  private async command(
    inbound: InboundMessageRow,
    command: IntakeCommand,
    identity: Identity,
    conversation: ConversationRow | null,
    prefix: string | null,
  ): Promise<IntakeOutcome> {
    if (command.command === 'CONVERT_TO_REQUEST' || command.command === 'CONVERT_TO_CONTENT') {
      return this.convert(inbound, command.command, identity, conversation);
    }

    const labels = labelsFor(identity.candidates);
    let text: string;
    switch (command.command) {
      case 'HELP':
        text = channelHelpReply(identity.name, labels);
        break;
      case 'PROJECTS':
        text = projectsReply(labels);
        break;
      case 'STATUS': {
        const sticky = identity.candidates.find(
          (c) =>
            c.projectId === conversation?.stickyProjectId &&
            conversation.stickyUntil !== null &&
            conversation.stickyUntil > this.app.clock.now(),
        );
        text = await this.openRequestsText(sticky ? [sticky] : identity.candidates);
        break;
      }
      case 'CONTRACTS':
        text = await this.contractsText(identity);
        break;
      default:
        // CHOOSE outside a pending question: nothing to answer.
        text = channelHelpReply(identity.name, labels);
    }

    const reply = withPrefix(prefix, text);
    const only = singleOrganizationEntry(identity);
    await this.finish(inbound.id, 'ANSWERED', reply, {
      ...(only ? senderColumns(only) : {}),
      parsed: { command: command.command },
    });
    return this.outcome('ANSWERED', reply, inbound.id, only?.organizationId ?? null);
  }

  private async openRequestsText(candidates: Candidate[]): Promise<string> {
    const showOrganization = spansOrganizations(candidates);
    const groups = [];
    for (const candidate of candidates.slice(0, 6)) {
      const tenant = this.systemTenant(candidate.organizationId, `intake-status:${candidate.id}`);
      groups.push({
        label: projectLabel(candidate, showOrganization),
        requests: await this.app.repos.conversations.openRequests(tenant, candidate.projectId),
      });
    }
    return openRequestsReply(groups);
  }

  /**
   * "Contracts": a homeowner gets a fresh portal link per project (spec D5 —
   * approval tokens are stored as hashes, so old receipt links cannot be
   * regenerated, but a new portal link can); site team get their open
   * requests, because the record is the designer's to share, not theirs.
   */
  private async contractsText(identity: Identity): Promise<string> {
    const asContact = identity.candidates.filter((c) => c.sender.kind === 'CONTACT');
    const asSiteTeam = identity.candidates.filter((c) => c.sender.kind === 'EMPLOYEE');
    const parts: string[] = [];

    if (asContact.length > 0) {
      const showOrganization = spansOrganizations(asContact);
      const links = await this.app.uow.transaction(async (tx) => {
        const minted: Array<{ label: string; url: string }> = [];
        for (const candidate of asContact.slice(0, 6)) {
          const tenant = this.systemTenant(candidate.organizationId, `intake-portal:${candidate.id}`);
          const created = await this.portal.mintForWhatsApp(
            tx,
            tenant,
            candidate.projectId,
            candidate.sender.id,
          );
          minted.push({ label: projectLabel(candidate, showOrganization), url: created.portalUrl });
        }
        return minted;
      });
      parts.push(portalLinksReply(links));
    }
    if (asSiteTeam.length > 0) parts.push(await this.openRequestsText(asSiteTeam));
    return parts.join('\n\n');
  }

  // --- Act --------------------------------------------------------------------

  /**
   * Files one message against the chosen project. A refusal the sender can do
   * something about (no approver on the project, a closed project, a draft the
   * domain will not accept) finishes the message with that explanation; it is
   * not retried, because retrying a refusal would loop forever.
   */
  private async actSafely(
    inbound: InboundMessageRow,
    candidate: Candidate,
    identity: Identity,
    options: { prefix: string | null; notifyKey: string },
  ): Promise<ActResult> {
    try {
      return await this.act(inbound, candidate, identity, options);
    } catch (error) {
      if (!isRefusal(error)) throw error;
      const reply = withPrefix(options.prefix, error.message);
      await this.finish(inbound.id, 'REJECTED_POLICY', reply, {
        ...senderColumns(senderOf(candidate)),
        projectId: candidate.projectId,
        rejectionReason: `${error.code}: ${error.message}`.slice(0, 500),
      });
      return emptyResult('REJECTED_POLICY', reply, candidate.organizationId);
    }
  }

  private async act(
    inbound: InboundMessageRow,
    candidate: Candidate,
    identity: Identity,
    options: { prefix: string | null; notifyKey: string },
  ): Promise<ActResult> {
    const body = inbound.body ?? '';
    const parsed = parseIntakeMessage(body);
    const intent = classifyMessage(body, inbound.mediaCount, parserSignals(parsed));
    const entry =
      identity.entries.find(
        (e) => e.kind === candidate.sender.kind && e.id === candidate.sender.id,
      ) ?? senderOf(candidate);
    if (intent.kind === 'REQUEST') {
      return this.actRequest(inbound, candidate, entry, parsed, options.prefix);
    }
    return this.actContent(inbound, candidate, entry, parsed, options);
  }

  private async actRequest(
    inbound: InboundMessageRow,
    candidate: Candidate,
    entry: SenderEntry,
    parsed: ParsedIntake,
    prefix: string | null,
  ): Promise<ActResult> {
    const tenant = this.systemTenant(candidate.organizationId, inbound.id);
    const organization = await this.app.repos.organizations.findById(tenant);
    if (!organization) throw new AppError('ORGANIZATION_REQUIRED');
    const project = await this.app.repos.projects.requireById(tenant, candidate.projectId);
    const currency = project.currency;

    if (!project.defaultApproverContactId) {
      throw new AppError('VALIDATION_FAILED', {
        message:
          `"${project.title}" has no homeowner approver recorded, so I cannot raise this yet. ` +
          'Ask your designer to add the client contact.',
      });
    }

    const amountMinor = parsed.amountAmbiguous ? null : parsed.amountMinor;
    const ceiling = entry.kind === 'EMPLOYEE' ? entry.maxRequestMinor : null;
    const aboveCeiling = ceiling !== null && amountMinor !== null && amountMinor > ceiling;

    // D3: under AUTO_SEND a complete request from the site team, within the
    // ceiling the owner set, keeps the old direct path to the homeowner.
    // Anything else goes to the designer, who can price or complete it.
    if (
      organization.requestRouting === 'AUTO_SEND' &&
      entry.kind === 'EMPLOYEE' &&
      isComplete(parsed) &&
      !aboveCeiling
    ) {
      return this.autoSend(inbound, candidate, entry, parsed, prefix);
    }

    const ctx = channelRequestContext(tenant, project.id, USER_AGENT);
    let created: { changeOrderId: string; number: string };
    if (inbound.changeOrderId) {
      // Checkpointed on an earlier attempt: the proposal exists, only the
      // reply and the terminal status are missing.
      const existing = await this.app.repos.changeOrders.requireChangeOrder(
        this.app.uow.db,
        tenant,
        inbound.changeOrderId,
      );
      created = { changeOrderId: existing.id, number: existing.number };
    } else {
      created = await this.changeOrders.createProposal(
        ctx,
        project.id,
        proposalInput(parsed, textOf(inbound), []),
        {
          origin: 'WHATSAPP',
          raisedByEmployeeId: entry.kind === 'EMPLOYEE' ? entry.id : null,
          submittedByContactId: entry.kind === 'CONTACT' ? entry.id : null,
        },
        {
          // Same transaction as the proposal: a webhook retry after this
          // commits finds the checkpoint and never raises a second one.
          afterCreate: async (tx, made) => {
            await this.app.repos.inboundMessages.markProgress(tx, inbound.id, {
              organizationId: candidate.organizationId,
              employeeId: entry.kind === 'EMPLOYEE' ? entry.id : null,
              contactId: entry.kind === 'CONTACT' ? entry.id : null,
              projectId: project.id,
              changeOrderId: made.changeOrderId,
              parsed: describe(parsed),
            });
            await this.remember(tx, inbound, candidate, 'REQUEST', made.changeOrderId);
          },
        },
      );
    }

    const note =
      parsed.amountAmbiguous && parsed.amountRaw
        ? unreadableAmountNote(parsed.amountRaw)
        : aboveCeiling && amountMinor !== null && ceiling !== null
          ? aboveLimitNote(amountMinor, ceiling, currency)
          : null;
    const reply = withPrefix(
      prefix,
      proposedReply({ changeNumber: created.number, projectTitle: project.title, note }),
    );
    await this.finish(inbound.id, 'ACCEPTED', reply, {
      ...senderColumns(entry),
      projectId: project.id,
      changeOrderId: created.changeOrderId,
      parsed: describe(parsed),
    });
    return {
      status: 'ACCEPTED',
      reply,
      changeOrderId: created.changeOrderId,
      approvalUrl: null,
      documentId: null,
      organizationId: candidate.organizationId,
    };
  }

  /**
   * The pre-pivot path, unchanged in substance: create and send through the
   * same services the web composer uses. A sent record belongs to the
   * designer and the homeowner, so its reply offers no FILE correction.
   */
  private async autoSend(
    inbound: InboundMessageRow,
    candidate: Candidate,
    entry: SenderEntry,
    parsed: ParsedIntake,
    prefix: string | null,
  ): Promise<ActResult> {
    const tenant = this.systemTenant(candidate.organizationId, inbound.id);
    const projectRow = await this.app.repos.projects.requireById(tenant, candidate.projectId);
    const approverContactId = projectRow.defaultApproverContactId;
    if (!approverContactId) throw new AppError('VALIDATION_FAILED');
    const ctx = channelRequestContext(tenant, projectRow.id, USER_AGENT);
    const amountMinor = parsed.amountMinor ?? 0n;
    const days = parsed.days ?? 0;

    let created: { changeOrderId: string; number: string; version: VersionRow };
    if (inbound.changeOrderId) {
      const existing = await this.app.repos.changeOrders.requireChangeOrder(
        this.app.uow.db,
        tenant,
        inbound.changeOrderId,
      );
      if (existing.projectId !== projectRow.id) {
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
        projectRow.id,
        {
          type: amountMinor === 0n ? 'TIME_ONLY' : 'ADDITION',
          title: titleFrom(parsed),
          scope: parsed.description ?? '',
          ...(parsed.reason ? { reason: parsed.reason } : {}),
          // One line item priced at the figure the employee gave. The money
          // engine computes the totals; nothing here does arithmetic.
          lineItems:
            amountMinor === 0n
              ? []
              : [
                  {
                    description: titleFrom(parsed),
                    quantity: '1',
                    unit: 'item',
                    unitPriceMinor: Number(amountMinor),
                    // The employee quotes one all-in figure, not a pre-tax rate,
                    // so adding tax here would inflate what they were told.
                    taxRateBps: 0,
                    direction: 1 as const,
                  },
                ],
          scheduleDeltaDays: days,
          approverContactId,
          assuranceRequired: 'A0' as const,
        },
        {
          afterCreate: async (tx, checkpoint) => {
            await this.app.repos.inboundMessages.markProgress(tx, inbound.id, {
              organizationId: candidate.organizationId,
              employeeId: entry.id,
              projectId: projectRow.id,
              changeOrderId: checkpoint.changeOrderId,
              parsed: describe(parsed),
            });
            await this.remember(tx, inbound, candidate, 'REQUEST', checkpoint.changeOrderId);
          },
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
      this.app.repos.changeOrders.markIntakeOrigin(tx, tenant, versionId, entry.id),
    );

    const customer = await this.app.repos.customers.requireById(tenant, projectRow.customerId);
    const reply = withPrefix(
      prefix,
      sentToCustomerReply({
        changeNumber: created.number,
        projectTitle: projectRow.title,
        customerName: customer.displayName,
        amountMinor,
        days,
        currency: projectRow.currency,
      }),
    );
    await this.finish(inbound.id, 'ACCEPTED', reply, {
      ...senderColumns(entry),
      projectId: projectRow.id,
      changeOrderId: created.changeOrderId,
      parsed: describe(parsed),
    });
    return {
      status: 'ACCEPTED',
      reply,
      changeOrderId: created.changeOrderId,
      approvalUrl,
      documentId: null,
      organizationId: candidate.organizationId,
    };
  }

  /**
   * Files content in "From WhatsApp": text becomes a note now; photos and
   * files become documents when `storeMedia` has fetched them, which happens
   * only after this has attributed the message to a project.
   */
  private async actContent(
    inbound: InboundMessageRow,
    candidate: Candidate,
    entry: SenderEntry,
    parsed: ParsedIntake,
    options: { prefix: string | null; notifyKey: string },
  ): Promise<ActResult> {
    const tenant = this.systemTenant(candidate.organizationId, inbound.id);
    const project = await this.app.repos.projects.requireById(tenant, candidate.projectId);
    const text = textOf(inbound);

    if (!text && inbound.mediaCount === 0) {
      // A sticker, a reaction, an unsupported message type: nothing to file.
      const reply = withPrefix(options.prefix, channelHelpReply(entry.name, []));
      await this.finish(inbound.id, 'REJECTED_UNPARSEABLE', reply, {
        ...senderColumns(entry),
        projectId: project.id,
        rejectionReason: 'nothing to file',
      });
      return emptyResult('REJECTED_UNPARSEABLE', reply, candidate.organizationId);
    }

    const what =
      inbound.mediaCount === 0 ? 'note' : inbound.mediaCount === 1 ? 'file' : ('files' as const);
    const reply = withPrefix(options.prefix, savedReply({ what, projectTitle: project.title }));

    const documentId = await this.app.uow.transaction(async (tx) => {
      let noteId: string | null = null;
      if (inbound.mediaCount === 0) {
        noteId = await this.fileNote(tx, tenant, project.id, inbound, entry, text);
      }
      await this.notifyFiled(tx, tenant, {
        projectId: project.id,
        projectTitle: project.title,
        entry,
        isNote: inbound.mediaCount === 0,
        title: inbound.mediaCount === 0 ? defaultNoteTitle(text) : `${inbound.mediaCount} ${what}`,
        dedupeKey: options.notifyKey,
      });
      await this.app.repos.inboundMessages.markProcessed(tx, inbound.id, {
        status: 'SAVED',
        ...senderColumns(entry),
        projectId: project.id,
        documentId: noteId,
        parsed: describe(parsed),
        replyText: reply,
      });
      await this.remember(tx, inbound, candidate, 'CONTENT', null);
      return noteId;
    });

    return {
      status: 'SAVED',
      reply,
      changeOrderId: null,
      approvalUrl: null,
      documentId,
      organizationId: candidate.organizationId,
    };
  }

  // --- Convert (the one-word correction) --------------------------------------

  private async convert(
    inbound: InboundMessageRow,
    command: 'CONVERT_TO_REQUEST' | 'CONVERT_TO_CONTENT',
    identity: Identity,
    conversation: ConversationRow | null,
  ): Promise<IntakeOutcome> {
    const target = command === 'CONVERT_TO_REQUEST' ? 'REQUEST' : 'CONTENT';
    const last = conversation?.lastItem ?? null;
    const candidate =
      last &&
      identity.candidates.find(
        (c) => c.projectId === last.projectId && c.organizationId === last.organizationId,
      );
    const held =
      last && candidate
        ? await this.app.repos.inboundMessages.findForIntake(
            this.app.uow.db,
            last.inboundMessageId,
          )
        : null;

    const answer = async (reply: string, extra: Partial<FinishExtra> = {}) => {
      await this.finish(inbound.id, 'ANSWERED', reply, {
        ...(candidate ? { ...senderColumns(senderOf(candidate)), projectId: candidate.projectId } : {}),
        parsed: { command },
        ...extra,
      });
      return this.outcome('ANSWERED', reply, inbound.id, candidate?.organizationId ?? null, extra);
    };

    if (!last || !candidate || !held) return answer(nothingToConvertReply());
    if (last.kind === target) return answer(alreadyConvertedReply(target));

    try {
      if (target === 'REQUEST') {
        const changeOrderId = await this.contentToRequest(inbound, held, candidate, identity);
        const number = await this.requestNumber(candidate, changeOrderId);
        const project = await this.app.repos.projects.requireById(
          this.systemTenant(candidate.organizationId, inbound.id),
          candidate.projectId,
        );
        return answer(proposedReply({ changeNumber: number, projectTitle: project.title }), {
          changeOrderId,
        });
      }
      return answer(await this.requestToContent(inbound, held, candidate, identity, last));
    } catch (error) {
      if (!isRefusal(error)) throw error;
      return answer(error.message);
    }
  }

  /**
   * "REQUEST": the filed note and files are withdrawn and the same message is
   * raised as a proposal, its photos attached. One transaction with the
   * proposal, so a retry cannot leave both or neither.
   */
  private async contentToRequest(
    inbound: InboundMessageRow,
    held: InboundMessageRow,
    candidate: Candidate,
    identity: Identity,
  ): Promise<string> {
    if (inbound.changeOrderId) return inbound.changeOrderId;
    const tenant = this.systemTenant(candidate.organizationId, inbound.id);
    const project = await this.app.repos.projects.requireById(tenant, candidate.projectId);
    if (!project.defaultApproverContactId) {
      throw new AppError('VALIDATION_FAILED', {
        message:
          `"${project.title}" has no homeowner approver recorded, so I cannot raise this yet. ` +
          'Ask your designer to add the client contact.',
      });
    }
    const entry = entryFor(identity, candidate);
    const documents = await this.app.repos.conversations.documentsForInbound(
      this.app.uow.db,
      tenant,
      held.id,
    );
    // Only evidence-shaped files can ride on a request (D10); a drawing or a
    // sheet stays in the folder where it was filed.
    const attachable = documents
      .filter(
        (d) => d.fileObjectId !== null && d.mimeType !== null && isAttachableType(d.mimeType),
      )
      .slice(0, this.app.env.MAX_ATTACHMENTS_PER_VERSION);
    const withdrawn = documents.filter((d) => d.fileObjectId === null || attachable.includes(d));
    const parsed = parseIntakeMessage(held.body ?? '');
    const ctx = channelRequestContext(tenant, project.id, USER_AGENT);

    const created = await this.changeOrders.createProposal(
      ctx,
      project.id,
      proposalInput(
        parsed,
        textOf(held),
        attachable.map((d) => d.fileObjectId as string),
      ),
      {
        origin: 'WHATSAPP',
        raisedByEmployeeId: entry.kind === 'EMPLOYEE' ? entry.id : null,
        submittedByContactId: entry.kind === 'CONTACT' ? entry.id : null,
      },
      {
        afterCreate: async (tx, made) => {
          for (const document of withdrawn) {
            await this.withdrawDocument(tx, tenant, project.id, document.id);
          }
          await this.app.repos.inboundMessages.markProgress(tx, inbound.id, {
            organizationId: candidate.organizationId,
            employeeId: entry.kind === 'EMPLOYEE' ? entry.id : null,
            contactId: entry.kind === 'CONTACT' ? entry.id : null,
            projectId: project.id,
            changeOrderId: made.changeOrderId,
            parsed: { command: 'CONVERT_TO_REQUEST', convertedInboundMessageId: held.id },
          });
          await this.app.repos.inboundMessages.refile(tx, tenant, held.id, {
            status: 'ACCEPTED',
            changeOrderId: made.changeOrderId,
            documentId: null,
          });
          await this.remember(tx, held, candidate, 'REQUEST', made.changeOrderId);
        },
      },
    );
    return created.changeOrderId;
  }

  /**
   * "FILE": a proposal still with the designer is dismissed (the record keeps
   * it), and the message is filed as a note plus its photos instead. Only
   * while the designer has not acted: once a request has been reviewed or
   * sent it is theirs and the homeowner's, not the sender's to withdraw.
   */
  private async requestToContent(
    inbound: InboundMessageRow,
    held: InboundMessageRow,
    candidate: Candidate,
    identity: Identity,
    last: LastItem,
  ): Promise<string> {
    if (!last.changeOrderId) return nothingToConvertReply();
    const tenant = this.systemTenant(candidate.organizationId, inbound.id);
    const project = await this.app.repos.projects.requireById(tenant, candidate.projectId);
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      tenant,
      last.changeOrderId,
    );
    const current = await this.app.repos.changeOrders.getCurrentVersion(tenant, changeOrder.id);
    if (!current) throw new AppError('CHANGE_ORDER_NOT_FOUND');

    // A retry after the dismissal committed but before the filing did.
    const dismissedAlready =
      current.status === 'CANCELLED' &&
      current.submittedForReviewAt !== null &&
      current.reviewedAt !== null;
    if (!isAwaitingReview(current) && !dismissedAlready) {
      return cannotConvertReply(changeOrder.number);
    }
    if (isAwaitingReview(current)) {
      const ctx = channelRequestContext(tenant, project.id, USER_AGENT);
      await this.changeOrders.dismissProposal(ctx, changeOrder.id, DISMISS_REASON);
    }

    const entry = entryFor(identity, candidate);
    const attachments = await this.app.repos.changeOrders.listAttachments(
      this.app.uow.db,
      tenant,
      current.id,
    );
    const text = textOf(held);
    const what = attachments.length === 0 ? 'note' : attachments.length === 1 ? 'file' : 'files';
    const reply = savedReply({ what, projectTitle: project.title });

    await this.app.uow.transaction(async (tx) => {
      let firstDocumentId: string | null = null;
      if (text) {
        firstDocumentId = await this.fileNote(tx, tenant, project.id, held, entry, text);
      }
      const folderId = await this.app.repos.workspace.systemFolderId(
        tx,
        tenant,
        project.id,
        'WHATSAPP',
      );
      for (const attachment of attachments) {
        const document = await this.app.repos.workspace.insertDocument(tx, tenant, {
          projectId: project.id,
          folderId,
          kind: 'FILE',
          title: attachment.filename,
          notes: attachment.caption,
          fileObjectId: attachment.fileObjectId,
          source: 'WHATSAPP',
          ...addedBy(entry),
          inboundMessageId: held.id,
        });
        await this.auditDocument(tx, tenant, project.id, document.id, 'FILE', document.title);
        firstDocumentId ??= document.id;
      }
      await this.notifyFiled(tx, tenant, {
        projectId: project.id,
        projectTitle: project.title,
        entry,
        isNote: attachments.length === 0,
        title: text ? defaultNoteTitle(text) : `${attachments.length} ${what}`,
        dedupeKey: `whatsapp-saved:${inbound.id}`,
      });
      await this.app.repos.inboundMessages.refile(tx, tenant, held.id, {
        status: 'SAVED',
        changeOrderId: null,
        documentId: firstDocumentId,
      });
      await this.remember(tx, held, candidate, 'CONTENT', null);
    });
    return reply;
  }

  // --- Media ------------------------------------------------------------------

  /**
   * Pulls a message's attachments into the quarantine pipeline, once it has
   * been filed. Also covers the messages an answer released from a held
   * choice, which is why this lives here rather than in the worker: the
   * simulator route needs the same path.
   *
   * Never fetches for a message that is not attributed to a workspace AND a
   * project (an unknown sender, a held message, a rejected one): downloading
   * for an unrecognised number would let anyone with the business number make
   * the worker store whatever they like. Nothing bespoke happens to the bytes
   * either — the same quarantine prefix and the same `SCAN_FILE` job as a web
   * upload — because a second path for "files from WhatsApp" is how one of the
   * two ends up without a scan.
   */
  async storeMedia(inboundMessageId: string): Promise<{ stored: number }> {
    return runInScope(SYSTEM_SCOPE, async () => {
      const ids = [
        inboundMessageId,
        ...(await this.app.repos.inboundMessages.listResolvedBy(this.app.uow.db, inboundMessageId)),
      ];
      let stored = 0;
      for (const id of ids) stored += await this.storeMediaFor(id);
      return { stored };
    });
  }

  private async storeMediaFor(inboundMessageId: string): Promise<number> {
    const row = await this.app.repos.inboundMessages.findForIntake(
      this.app.uow.db,
      inboundMessageId,
    );
    if (!row || row.mediaRefs.length === 0) return 0;
    if (!row.organizationId || !row.projectId) return 0;
    if (row.status !== 'ACCEPTED' && row.status !== 'SAVED') return 0;

    const gateway = this.app.integrations.whatsapp;
    if (typeof gateway.fetchMedia !== 'function') {
      this.app.logger.debug({ channel: gateway.channel }, 'gateway cannot fetch media');
      return 0;
    }

    const organizationId = row.organizationId;
    const projectId = row.projectId;
    const tenant = this.systemTenant(organizationId, `intake-media:${row.id}`);
    const alreadyFetched = await this.app.repos.inboundMessages.linkedMediaIds(
      this.app.uow.db,
      row.id,
    );

    // A proposal still with the designer takes the photos as its evidence;
    // anything else (a filed message, an auto-sent request whose version is
    // frozen) gets them as files in "From WhatsApp".
    let draft: VersionRow | null = null;
    if (row.changeOrderId) {
      const version = await this.app.repos.changeOrders.getCurrentVersion(
        tenant,
        row.changeOrderId,
      );
      if (version && version.status === 'DRAFT') draft = version;
    }
    const entry: Pick<SenderEntry, 'kind' | 'id'> | null = row.employeeId
      ? { kind: 'EMPLOYEE', id: row.employeeId }
      : row.contactId
        ? { kind: 'CONTACT', id: row.contactId }
        : null;

    let stored = 0;
    for (const ref of row.mediaRefs) {
      if (alreadyFetched.has(ref.mediaId)) continue;

      // Outside any transaction: no provider call holds a database lock.
      const fetched = await gateway.fetchMedia(ref.mediaId, {
        maxBytes: this.app.env.MAX_UPLOAD_BYTES,
      });
      // The provider caps its own uploads, but this is the boundary that
      // protects our storage, so it is enforced here rather than assumed.
      if (fetched.byteSize > this.app.env.MAX_UPLOAD_BYTES) {
        this.app.logger.warn(
          { byteSize: fetched.byteSize, limit: this.app.env.MAX_UPLOAD_BYTES },
          'inbound attachment exceeds the upload limit; not stored',
        );
        continue;
      }

      const fileObjectId = newId();
      const filename = sanitizeFilename(
        ref.filename ?? `whatsapp-${ref.mediaId}${extensionFor(fetched.mimeType)}`,
      );
      const quarantineKey = StorageKeys.quarantine(organizationId, fileObjectId, filename);
      // Bytes first: a registered row pointing at an object that does not
      // exist would fail the scan for a reason unrelated to the file.
      await this.app.objectStore.put(quarantineKey, fetched.bytes, fetched.mimeType);

      const attachTo =
        draft &&
        isAttachableType(fetched.mimeType) &&
        (await this.app.repos.changeOrders.listAttachments(this.app.uow.db, tenant, draft.id))
          .length < this.app.env.MAX_ATTACHMENTS_PER_VERSION
          ? draft
          : null;

      await this.app.uow.transaction(async (tx) => {
        await this.app.repos.files.register(tx, tenant, {
          id: fileObjectId,
          projectId,
          storageKey: quarantineKey,
          filename,
          declaredMimeType: fetched.mimeType,
          byteSize: BigInt(fetched.byteSize),
          purpose: attachTo ? 'CHANGE_ATTACHMENT' : 'PROJECT_DOCUMENT',
          // Our own digest of the bytes we received, never the provider's claim.
          sha256: createHash('sha256').update(fetched.bytes).digest(),
        });
        await this.app.repos.files.markUploaded(tx, tenant, fileObjectId);
        const linked = await this.app.repos.inboundMessages.linkMedia(tx, {
          inboundMessageId: row.id,
          fileObjectId,
          organizationId,
          providerMediaId: ref.mediaId,
        });
        if (!linked) return;

        if (attachTo) {
          await this.app.repos.changeOrders.addAttachment(
            tx,
            tenant,
            attachTo.id,
            fileObjectId,
            ref.caption,
            this.app.env.MAX_ATTACHMENTS_PER_VERSION,
          );
        } else {
          const folderId = await this.app.repos.workspace.systemFolderId(
            tx,
            tenant,
            projectId,
            'WHATSAPP',
          );
          const document = await this.app.repos.workspace.insertDocument(tx, tenant, {
            projectId,
            folderId,
            kind: 'FILE',
            title: filename,
            notes: ref.caption?.trim() || row.body?.trim() || null,
            fileObjectId,
            source: 'WHATSAPP',
            ...(entry ? addedBy(entry) : {}),
            inboundMessageId: row.id,
          });
          await this.auditDocument(tx, tenant, projectId, document.id, 'FILE', document.title);
          await this.app.repos.inboundMessages.setDocumentIfEmpty(tx, tenant, row.id, document.id);
        }
        await enqueueJob(tx, {
          kind: JOB_KINDS.SCAN_FILE,
          organizationId,
          dedupeKey: `scan:${fileObjectId}`,
          payload: { fileObjectId, organizationId },
        });
      });
      stored += 1;
      this.app.logger.info(
        { fileObjectId, byteSize: fetched.byteSize, attached: Boolean(attachTo) },
        'inbound attachment quarantined and queued for scanning',
      );
    }
    return stored;
  }

  // --- Shared pieces ----------------------------------------------------------

  private async fileNote(
    tx: TransactionContext,
    tenant: TenantContext,
    projectId: string,
    inbound: InboundMessageRow,
    entry: Pick<SenderEntry, 'kind' | 'id'>,
    text: string,
  ): Promise<string> {
    const folderId = await this.app.repos.workspace.systemFolderId(
      tx,
      tenant,
      projectId,
      'WHATSAPP',
    );
    const document = await this.app.repos.workspace.insertDocument(tx, tenant, {
      projectId,
      folderId,
      kind: 'NOTE',
      title: defaultNoteTitle(text),
      body: text,
      source: 'WHATSAPP',
      ...addedBy(entry),
      inboundMessageId: inbound.id,
    });
    await this.auditDocument(tx, tenant, projectId, document.id, 'NOTE', document.title);
    return document.id;
  }

  private async auditDocument(
    tx: TransactionContext,
    tenant: TenantContext,
    projectId: string,
    documentId: string,
    kind: 'NOTE' | 'FILE',
    title: string,
  ): Promise<void> {
    await this.app.repos.audit.append(tx, tenant, [
      {
        aggregateType: 'project',
        aggregateId: projectId,
        projectId,
        eventType: DOMAIN_EVENTS.PROJECT_DOCUMENT_ADDED,
        // Nobody signed in; the sender is named on the document itself.
        actorType: 'SYSTEM',
        actorId: null,
        occurredAt: this.app.clock.now(),
        payload: { documentId, kind, folder: 'WHATSAPP', title, source: 'WHATSAPP' },
      },
    ]);
  }

  private async withdrawDocument(
    tx: TransactionContext,
    tenant: TenantContext,
    projectId: string,
    documentId: string,
  ): Promise<void> {
    const removed = await this.app.repos.workspace.softDeleteDocument(tx, tenant, documentId);
    if (!removed) return;
    await this.app.repos.audit.append(tx, tenant, [
      {
        aggregateType: 'project',
        aggregateId: projectId,
        projectId,
        eventType: DOMAIN_EVENTS.PROJECT_DOCUMENT_REMOVED,
        actorType: 'SYSTEM',
        actorId: null,
        occurredAt: this.app.clock.now(),
        payload: { documentId, reason: 'refiled as a request by the WhatsApp sender' },
      },
    ]);
  }

  /** The designers hear about content once; requests notify through createProposal. */
  private async notifyFiled(
    tx: TransactionContext,
    tenant: TenantContext,
    input: {
      projectId: string;
      projectTitle: string;
      entry: SenderEntry;
      isNote: boolean;
      title: string;
      dedupeKey: string;
    },
  ): Promise<void> {
    await new NotificationService(this.app).notifyProject(tx, tenant, {
      projectId: input.projectId,
      audience: 'DESIGNERS',
      kind: input.isNote ? 'NOTE_ADDED' : 'DOCUMENT_ADDED',
      title: `${input.entry.name} sent ${input.isNote ? 'a note' : 'files'} on WhatsApp`,
      body: `${input.title} · ${input.projectTitle}`,
      linkPath: `/app/projects/${input.projectId}/files`,
      actorLabel: input.entry.name,
      dedupeKey: input.dedupeKey,
    });
  }

  /**
   * Where the sender's last message went: the sticky project for the next two
   * hours, and the item a REQUEST / FILE reply would correct. Written in the
   * same transaction as the filing it describes.
   */
  private async remember(
    tx: TransactionContext,
    inbound: InboundMessageRow,
    candidate: Candidate,
    kind: 'REQUEST' | 'CONTENT',
    changeOrderId: string | null,
  ): Promise<void> {
    const now = this.app.clock.now();
    await this.app.repos.conversations.lockForPhone(tx, inbound.fromPhoneE164);
    await this.app.repos.conversations.recordItem(
      tx,
      inbound.fromPhoneE164,
      {
        inboundMessageId: inbound.id,
        organizationId: candidate.organizationId,
        projectId: candidate.projectId,
        kind,
        changeOrderId,
        sender: candidate.sender,
        at: now.toISOString(),
      },
      new Date(now.getTime() + STICKY_HOURS * 3_600_000),
    );
  }

  private async requestNumber(candidate: Candidate, changeOrderId: string): Promise<string> {
    const changeOrder = await this.app.repos.changeOrders.requireChangeOrder(
      this.app.uow.db,
      this.systemTenant(candidate.organizationId, changeOrderId),
      changeOrderId,
    );
    return changeOrder.number;
  }

  private systemTenant(organizationId: string, requestId: string): TenantContext {
    return {
      organizationId,
      userId: null,
      role: 'SYSTEM',
      requestId: requestId.startsWith('intake') ? requestId : `intake:${requestId}`,
    };
  }

  private async finish(
    inboundId: string,
    status: InboundStatus,
    reply: string,
    extra: Partial<FinishExtra> = {},
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
    extra: { changeOrderId?: string | null } = {},
  ): IntakeOutcome {
    return {
      status,
      reply,
      inboundMessageId,
      changeOrderId: extra.changeOrderId ?? null,
      approvalUrl: null,
      duplicate: false,
      organizationId,
    };
  }
}

interface FinishExtra {
  organizationId: string | null;
  employeeId: string | null;
  contactId: string | null;
  projectId: string | null;
  changeOrderId: string | null;
  documentId: string | null;
  parsed: Record<string, unknown> | null;
  rejectionReason: string | null;
}

/** A refusal to explain to the sender, as opposed to a failure to retry. */
function isRefusal(error: unknown): error is AppError {
  return (
    AppError.is(error) &&
    error.status < 500 &&
    // A concurrent processor is not a refusal: the webhook retry must resume.
    error.code !== 'IDEMPOTENCY_IN_PROGRESS'
  );
}

/** Request attachments stay evidence-shaped (D10); other files go to the folder. */
function isAttachableType(mimeType: string): boolean {
  const bare = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return (CHANGE_ATTACHMENT_MIME_TYPES as ReadonlySet<string>).has(bare);
}

function isExpired(conversation: ConversationRow, now: Date): boolean {
  return conversation.pendingExpiresAt !== null && conversation.pendingExpiresAt <= now;
}

function employeeEntry(employee: EmployeeWithAssignments): SenderEntry {
  return {
    kind: 'EMPLOYEE',
    id: employee.id,
    organizationId: employee.organizationId,
    name: employee.name,
    maxRequestMinor: employee.maxRequestMinor,
  };
}

function contactEntry(contact: ContactRow): SenderEntry {
  return {
    kind: 'CONTACT',
    id: contact.id,
    organizationId: contact.organizationId,
    name: contact.name,
    maxRequestMinor: null,
  };
}

function entryFor(identity: Identity, candidate: Candidate): SenderEntry {
  return (
    identity.entries.find(
      (e) => e.kind === candidate.sender.kind && e.id === candidate.sender.id,
    ) ?? senderOf(candidate)
  );
}

/** A minimal entry for a candidate, when the full roster row is not at hand. */
function senderOf(candidate: Candidate): SenderEntry {
  return {
    kind: candidate.sender.kind,
    id: candidate.sender.id,
    organizationId: candidate.organizationId,
    name: 'Someone',
    maxRequestMinor: null,
  };
}

function senderColumns(entry: Pick<SenderEntry, 'kind' | 'id' | 'organizationId'>): {
  organizationId: string;
  employeeId: string | null;
  contactId: string | null;
} {
  return {
    organizationId: entry.organizationId,
    employeeId: entry.kind === 'EMPLOYEE' ? entry.id : null,
    contactId: entry.kind === 'CONTACT' ? entry.id : null,
  };
}

function addedBy(entry: Pick<SenderEntry, 'kind' | 'id'>): {
  addedByEmployeeId?: string;
  addedByContactId?: string;
} {
  return entry.kind === 'EMPLOYEE' ? { addedByEmployeeId: entry.id } : { addedByContactId: entry.id };
}

/** The one entry when the number is known in exactly one way; else none. */
function singleEntry(entries: SenderEntry[]): SenderEntry | null {
  return entries.length === 1 ? (entries[0] ?? null) : null;
}

/** The sender's entry when every candidate project is in one workspace. */
function singleOrganizationEntry(identity: Identity): SenderEntry | null {
  if (spansOrganizations(identity.candidates)) return null;
  const first = identity.candidates[0];
  return first ? entryFor(identity, first) : singleEntry(identity.entries);
}

function spansOrganizations(candidates: ReadonlyArray<{ organizationId: string }>): boolean {
  return new Set(candidates.map((c) => c.organizationId)).size > 1;
}

function labelsFor(
  candidates: ReadonlyArray<{ projectNumber: string; title: string; organizationName: string; organizationId: string }>,
): string[] {
  const showOrganization = spansOrganizations(candidates);
  return candidates.map((c) => projectLabel(c, showOrganization));
}

function toConversationCandidate(candidate: Candidate): ConversationCandidate {
  return {
    organizationId: candidate.organizationId,
    projectId: candidate.projectId,
    projectNumber: candidate.projectNumber,
    title: candidate.title,
    organizationName: candidate.organizationName,
    sender: candidate.sender,
  };
}

/**
 * The listed project an answer names. A project number that appears twice in
 * the list (two firms both have a P-0004) names neither: the sender is asked
 * for the list position instead.
 */
function pickListed(
  listed: ConversationCandidate[],
  choice: IntakeCommand,
): ConversationCandidate | null {
  if (choice.command === 'CHOOSE') return listed[choice.index - 1] ?? null;
  if (choice.command === 'CHOOSE_PROJECT') {
    const wanted = normalizeForSearch(choice.projectNumber);
    const matches = listed.filter((c) => normalizeForSearch(c.projectNumber) === wanted);
    return matches.length === 1 ? (matches[0] ?? null) : null;
  }
  return null;
}

function withPrefix(prefix: string | null, reply: string): string {
  return prefix ? `${prefix}\n\n${reply}` : reply;
}

function emptyResult(
  status: InboundStatus,
  reply: string,
  organizationId: string | null = null,
): ActResult {
  return { status, reply, changeOrderId: null, approvalUrl: null, documentId: null, organizationId };
}

function storedResult(row: InboundMessageRow): ActResult {
  return {
    status: row.status,
    reply: row.replyText ?? '',
    changeOrderId: row.changeOrderId,
    approvalUrl: null,
    documentId: row.documentId,
    organizationId: row.organizationId,
  };
}

/**
 * One reply for a released batch. An album filed as content reads as one
 * "saved your files"; anything mixed lists each outcome once.
 */
function combineReplies(results: ActResult[], chosen: Candidate | null): string {
  if (results.length === 0) return nothingToConvertReply();
  if (results.length > 1 && chosen && results.every((r) => r.status === 'SAVED')) {
    return savedReply({ what: 'files', projectTitle: chosen.title });
  }
  return [...new Set(results.map((r) => r.reply).filter(Boolean))].join('\n\n');
}

function textOf(inbound: InboundMessageRow): string {
  return (inbound.body ?? '').trim();
}

/**
 * A proposal from what the parser understood. Incomplete is fine (D4): the
 * designer prices and completes it. An amount that could not be read as one
 * figure is left out rather than guessed.
 */
function proposalInput(
  parsed: ParsedIntake,
  text: string,
  attachmentIds: string[],
): ProposalInput {
  const description =
    parsed.description?.trim() ||
    text ||
    (attachmentIds.length > 0 ? 'Request from WhatsApp (see the attached photos)' : 'Request from WhatsApp');
  const amountMinor = parsed.amountAmbiguous ? null : parsed.amountMinor;
  return {
    description: description.slice(0, 4_000),
    ...(parsed.reason ? { reason: parsed.reason.slice(0, 1_000) } : {}),
    ...(parsed.room ? { room: parsed.room } : {}),
    ...(parsed.workCategory ? { workCategory: parsed.workCategory } : {}),
    ...(amountMinor !== null && amountMinor > 0n ? { amountMinor: Number(amountMinor) } : {}),
    ...(parsed.days ? { scheduleDeltaDays: parsed.days } : {}),
    attachmentIds,
  };
}

/**
 * Whether a request is complete enough to send without the designer, under
 * AUTO_SEND: a real description and one readable figure (or a time impact).
 */
function isComplete(parsed: ParsedIntake): boolean {
  if (!parsed.description || parsed.description.trim().length < 10) return false;
  if (parsed.amountAmbiguous) return false;
  // Zero cost AND zero schedule impact is not a change at all.
  return parsed.amountMinor !== null || (parsed.days ?? 0) !== 0;
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
    room: parsed.room,
    workCategory: parsed.workCategory,
    unrecognized: parsed.unrecognized,
  };
}

/** A best-effort extension so a downloaded file has a usable name. */
function extensionFor(mimeType: string): string {
  const known: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'video/mp4': '.mp4',
    'audio/ogg': '.ogg',
  };
  return known[mimeType.split(';')[0]?.trim() ?? ''] ?? '';
}

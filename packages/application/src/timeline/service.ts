import {
  AppError,
  MILESTONE_KIND_LABELS,
  type CalendarEventDto,
  type CreateMilestoneInput,
  type UpdateMilestoneInput,
} from '@extrawork/contracts';
import {
  runInScope,
  SYSTEM_SCOPE,
  tenantScope,
  type CalendarSourceRow,
  type DueItem,
  type MilestoneRow,
} from '@extrawork/db';
import {
  authorize,
  calendarDateIn,
  generateApprovalToken,
  hasProjectAccess,
  hashToken,
  isWellFormedToken,
  projectAccessFilter,
  serializeIcs,
  systemTenantContext,
  type Actor,
  type IcsEvent,
} from '@extrawork/domain';
import type { AppContext, RequestContext } from '../context.js';
import { NotificationService } from '../notifications/service.js';

/**
 * Milestones, the collated calendar, the private ICS feed and due reminders —
 * spec 2026-10-12, D14.
 *
 * "Sends notifications if enabled, reminding of completion dates": in-app
 * and email through the notification core, and on the phone through the
 * user's own calendar app subscribed to a private feed — no push service.
 */

/** The longest window one calendar request may ask for. */
const MAX_RANGE_DAYS = 400;
/** The feed covers recent history and the foreseeable future (D14). */
const FEED_DAYS_BACK = 60;
const FEED_MONTHS_AHEAD = 18;
/** The furthest any recipient's lead time reaches (`reminder_lead_days` ≤ 30). */
const REMINDER_HORIZON_DAYS = 30;

export class TimelineService {
  private readonly notifications: NotificationService;

  constructor(readonly app: AppContext) {
    this.notifications = new NotificationService(app);
  }

  // --- Milestones ---------------------------------------------------------------

  async listMilestones(ctx: RequestContext, projectId: string): Promise<MilestoneRow[]> {
    authorize(ctx.actor, 'milestone:read', {
      organizationId: ctx.tenant.organizationId,
      projectId,
    });
    await this.app.repos.projects.requireById(ctx.tenant, projectId);
    return this.app.repos.milestones.listForProject(this.app.uow.db, ctx.tenant, projectId);
  }

  async createMilestone(
    ctx: RequestContext,
    projectId: string,
    input: CreateMilestoneInput,
  ): Promise<MilestoneRow> {
    authorize(ctx.actor, 'milestone:manage', {
      organizationId: ctx.tenant.organizationId,
      projectId,
    });
    await this.app.repos.projects.requireById(ctx.tenant, projectId);
    return this.app.uow.transaction((tx) =>
      this.app.repos.milestones.insert(tx, ctx.tenant, {
        projectId,
        title: input.title,
        kind: input.kind,
        dueDate: input.dueDate,
        notes: input.notes ?? null,
        clientVisible: input.clientVisible,
      }),
    );
  }

  async updateMilestone(
    ctx: RequestContext,
    milestoneId: string,
    patch: UpdateMilestoneInput,
  ): Promise<MilestoneRow> {
    const milestone = await this.visibleMilestone(ctx, milestoneId);
    authorize(ctx.actor, 'milestone:manage', {
      organizationId: milestone.organizationId,
      projectId: milestone.projectId,
    });
    return this.app.uow.transaction((tx) =>
      this.app.repos.milestones.update(tx, ctx.tenant, milestone.id, {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.clientVisible !== undefined ? { clientVisible: patch.clientVisible } : {}),
        ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
      }),
    );
  }

  async deleteMilestone(ctx: RequestContext, milestoneId: string): Promise<void> {
    const milestone = await this.visibleMilestone(ctx, milestoneId);
    authorize(ctx.actor, 'milestone:manage', {
      organizationId: milestone.organizationId,
      projectId: milestone.projectId,
    });
    await this.app.uow.transaction((tx) =>
      this.app.repos.milestones.delete(tx, ctx.tenant, milestone.id),
    );
  }

  /** A milestone on a project the actor cannot see is a 404, not a 403. */
  private async visibleMilestone(ctx: RequestContext, milestoneId: string): Promise<MilestoneRow> {
    const milestone = await this.app.repos.milestones.requireById(
      this.app.uow.db,
      ctx.tenant,
      milestoneId,
    );
    if (!hasProjectAccess(ctx.actor, milestone.projectId)) {
      throw new AppError('MILESTONE_NOT_FOUND');
    }
    return milestone;
  }

  // --- The collated calendar -------------------------------------------------------

  async calendar(
    ctx: RequestContext,
    query: { from: string; to: string; projectId?: string | undefined },
  ): Promise<CalendarEventDto[]> {
    authorize(ctx.actor, 'calendar:read', {
      organizationId: ctx.tenant.organizationId,
      projectId: query.projectId ?? null,
    });
    const span = daysBetween(query.from, query.to);
    if (span < 0 || span > MAX_RANGE_DAYS) {
      throw new AppError('VALIDATION_FAILED', {
        message: `Ask for at most ${MAX_RANGE_DAYS} days, with "from" on or before "to".`,
      });
    }
    return this.eventsFor(ctx.actor, ctx.tenant.organizationId, query);
  }

  private async eventsFor(
    actor: Actor,
    organizationId: string,
    query: { from: string; to: string; projectId?: string | undefined },
  ): Promise<CalendarEventDto[]> {
    const tenant = systemTenantContext(organizationId, 'calendar');
    const rows = await this.app.repos.calendar.events(this.app.uow.db, tenant, {
      from: query.from,
      to: query.to,
      // The same project filter every list read uses: org-wide roles see
      // all, a designer or collaborator only their granted projects.
      projectIds: projectAccessFilter(actor),
      projectId: query.projectId ?? null,
    });
    return rows.map(toCalendarEvent);
  }

  // --- The private ICS feed --------------------------------------------------------

  async getFeed(ctx: RequestContext): Promise<{ active: boolean; createdAt: Date | null }> {
    const userId = requireUser(ctx);
    authorize(ctx.actor, 'calendar:read', { organizationId: ctx.tenant.organizationId });
    const feed = await this.app.repos.calendar.activeFeed(this.app.uow.db, ctx.tenant, userId);
    return { active: Boolean(feed), createdAt: feed?.createdAt ?? null };
  }

  /**
   * Creates the feed, or replaces it: the old URL stops working at once. The
   * plaintext is returned exactly once; only its SHA-256 is stored, so a lost
   * URL is rotated, never recovered.
   */
  async createFeed(ctx: RequestContext): Promise<{ feedUrl: string; createdAt: Date }> {
    const userId = requireUser(ctx);
    authorize(ctx.actor, 'calendar:read', { organizationId: ctx.tenant.organizationId });
    // Same token discipline as approval links: 32 random bytes, hash only.
    const token = generateApprovalToken();
    const created = await this.app.uow.transaction((tx) =>
      this.app.repos.calendar.rotateFeed(tx, ctx.tenant, userId, token.hash),
    );
    return {
      feedUrl: feedUrl(this.app.env.API_PUBLIC_URL, token.plaintext),
      createdAt: created.createdAt,
    };
  }

  async revokeFeed(ctx: RequestContext): Promise<void> {
    const userId = requireUser(ctx);
    authorize(ctx.actor, 'calendar:read', { organizationId: ctx.tenant.organizationId });
    await this.app.uow.transaction((tx) =>
      this.app.repos.calendar.revokeFeed(tx, ctx.tenant, userId),
    );
  }

  /**
   * The feed body for a token, computed for the owner's *current* grants —
   * a project they were removed from disappears on the next refresh.
   * Returns null for anything that is not a live feed; the route answers 404
   * without saying which.
   */
  async feedIcs(plainToken: string): Promise<string | null> {
    if (!isWellFormedToken(plainToken)) return null;
    const owner = await this.app.repos.calendar.findFeedOwner(hashToken(plainToken));
    if (!owner) return null;

    // The token named the tenant; from here everything runs under it, so the
    // feed is subject to the same row-level security as a signed-in read.
    return runInScope(tenantScope(owner.organizationId), async () => {
      const tenant = systemTenantContext(owner.organizationId, `calendar-feed:${owner.tokenId}`);
      const organization = await this.app.repos.organizations.findById(tenant);
      const today = calendarDateIn(this.app.clock.now(), organization?.timezone ?? 'Asia/Kolkata');
      const actor: Actor = {
        userId: owner.userId,
        organizationId: owner.organizationId,
        role: owner.role,
        projectGrants: new Set(owner.projectGrants),
        authenticatedAt: 0,
      };
      const events = await this.eventsFor(actor, owner.organizationId, {
        from: addDays(today, -FEED_DAYS_BACK),
        to: addMonths(today, FEED_MONTHS_AHEAD),
      });
      await this.app.repos.calendar.markFeedFetched(tenant, owner.tokenId);
      return serializeIcs({
        name: `ExtraWork · ${organization?.displayName ?? 'Projects'}`,
        refreshMinutes: 60,
        now: this.app.clock.now(),
        events: events.map((event) => toIcsEvent(event, this.app.env.WEB_PUBLIC_URL)),
      });
    });
  }

  // --- Due reminders (worker) --------------------------------------------------------

  /**
   * The daily sweep: for every open milestone and completion date inside a
   * recipient's lead time, one notification per person per item per due
   * date. The dedupe key makes a re-run — another replica, a retried job, a
   * second sweep the same day — write nothing new. Moving the date makes a new
   * key, so a rescheduled handover is reminded again.
   */
  async sendDueReminders(now: Date = this.app.clock.now()): Promise<number> {
    // A deliberate cross-tenant read: the sweep is what finds which workspaces
    // have anything due. Each workspace's writes then run under its own scope.
    const items = await runInScope(SYSTEM_SCOPE, () =>
      this.app.repos.calendar.dueItems(this.app.uow.db, now, REMINDER_HORIZON_DAYS),
    );
    const byOrganization = new Map<string, DueItem[]>();
    for (const item of items) {
      const list = byOrganization.get(item.organizationId) ?? [];
      list.push(item);
      byOrganization.set(item.organizationId, list);
    }

    let written = 0;
    for (const [organizationId, orgItems] of byOrganization) {
      written += await runInScope(tenantScope(organizationId), () =>
        this.remindOrganization(organizationId, orgItems),
      );
    }
    return written;
  }

  private async remindOrganization(organizationId: string, items: DueItem[]): Promise<number> {
    const tenant = systemTenantContext(organizationId, 'due-reminders');
    return this.app.uow.transaction(async (tx) => {
      let written = 0;
      const preferences = new Map<string, { on: boolean; lead: number }>();
      for (const item of items) {
        const audience = await this.notifications.audience(tx, tenant, item.projectId, 'EVERYONE');
        const recipients: string[] = [];
        for (const member of audience) {
          let pref = preferences.get(member.userId);
          if (!pref) {
            const stored = await this.app.repos.notifications.getPreferences(
              tx.db,
              tenant,
              member.userId,
            );
            pref = { on: stored.completionReminders, lead: stored.reminderLeadDays };
            preferences.set(member.userId, pref);
          }
          if (pref.on && item.daysUntil <= pref.lead) recipients.push(member.userId);
        }
        if (recipients.length === 0) continue;
        const rows = await this.notifications.notifyUsers(tx, tenant, recipients, {
          kind: item.kind === 'MILESTONE' ? 'MILESTONE_DUE' : 'COMPLETION_DUE',
          projectId: item.projectId,
          title: dueTitle(item),
          body: `${item.projectNumber} · ${item.projectTitle} · due ${item.dueDate}`,
          linkPath: `/app/projects/${item.projectId}/timeline`,
          dedupeKey: `due:${item.kind.toLowerCase()}:${item.refId}:${item.dueDate}`,
        });
        written += rows.length;
      }
      return written;
    });
  }
}

// --- Wording -----------------------------------------------------------------------

function whenFrom(daysUntil: number, date: string): string {
  if (daysUntil <= 0) return 'today';
  if (daysUntil === 1) return 'tomorrow';
  return `in ${daysUntil} days (${date})`;
}

function dueTitle(item: DueItem): string {
  const when = whenFrom(item.daysUntil, item.dueDate);
  return item.kind === 'MILESTONE'
    ? `${item.title} is due ${when}`
    : `${item.projectTitle} is due for completion ${when}`;
}

const DECISION_WORDS: Record<string, string> = {
  APPROVE: 'approved',
  DECLINE: 'declined',
  REQUEST_REVISION: 'sent back for changes',
};

function plural(days: number): string {
  const abs = Math.abs(days);
  return `${abs} day${abs === 1 ? '' : 's'}`;
}

/** Words a dated fact for a person; ids are stable across requests and feeds. */
export function toCalendarEvent(row: CalendarSourceRow): CalendarEventDto {
  const project = {
    projectId: row.projectId,
    projectNumber: row.projectNumber,
    projectTitle: row.projectTitle,
  };
  const projectPath = `/app/projects/${row.projectId}`;
  switch (row.kind) {
    case 'PROJECT_START':
      return {
        id: `project-start:${row.refId}`,
        kind: row.kind,
        date: row.date,
        title: `Work starts · ${row.projectTitle}`,
        detail: null,
        ...project,
        linkPath: projectPath,
        completed: false,
      };
    case 'PROJECT_COMPLETION':
      return {
        id: `project-completion:${row.refId}`,
        kind: row.kind,
        date: row.date,
        title: `Expected completion · ${row.projectTitle}`,
        detail:
          row.scheduleDeltaDays !== 0
            ? `Approved changes moved this by ${row.scheduleDeltaDays > 0 ? '+' : '−'}${plural(row.scheduleDeltaDays)}.`
            : null,
        ...project,
        linkPath: `${projectPath}/timeline`,
        completed: row.completed,
      };
    case 'PROJECT_REVISED_COMPLETION':
      return {
        id: `project-revised-completion:${row.refId}`,
        kind: row.kind,
        date: row.date,
        title: `Revised completion · ${row.projectTitle}`,
        detail: `Originally ${row.expectedCompletionDate ?? 'unset'}; ${row.scheduleDeltaDays > 0 ? '+' : '−'}${plural(row.scheduleDeltaDays)} from approved changes.`,
        ...project,
        linkPath: `${projectPath}/timeline`,
        completed: row.completed,
      };
    case 'MILESTONE':
      return {
        id: `milestone:${row.refId}`,
        kind: row.kind,
        date: row.date,
        title: row.label ?? 'Milestone',
        detail: row.milestoneKind ? MILESTONE_KIND_LABELS[row.milestoneKind] : null,
        ...project,
        linkPath: `${projectPath}/timeline`,
        completed: row.completed,
      };
    case 'APPROVAL_EXPIRES':
      return {
        id: `approval-expires:${row.refId}`,
        kind: row.kind,
        date: row.date,
        title: `Approval link expires · ${row.changeOrderNumber ?? ''} ${row.label ?? ''}`.trim(),
        detail: 'Waiting on the client. Send a reminder or a fresh link before it lapses.',
        ...project,
        linkPath: row.changeOrderId ? `/app/changes/${row.changeOrderId}` : projectPath,
        completed: false,
      };
    case 'DECISION':
      return {
        id: `decision:${row.refId}`,
        kind: row.kind,
        date: row.date,
        title:
          `${row.changeOrderNumber ?? 'Request'} ${DECISION_WORDS[row.decisionType ?? ''] ?? 'decided'} · ${row.label ?? ''}`.trim(),
        detail: null,
        ...project,
        linkPath: row.changeOrderId ? `/app/changes/${row.changeOrderId}` : projectPath,
        completed: true,
      };
  }
}

function toIcsEvent(event: CalendarEventDto, webBaseUrl: string): IcsEvent {
  const detail = [event.detail, `${event.projectNumber} · ${event.projectTitle}`]
    .filter(Boolean)
    .join('\n');
  return {
    // Stable per fact, so a calendar app updates an event rather than adding one.
    uid: `${event.id}@extrawork`,
    date: event.date,
    summary: event.title,
    description: detail,
    url: `${webBaseUrl.replace(/\/+$/, '')}${event.linkPath}`,
    completed: event.completed,
    categories: [event.kind],
  };
}

// --- Dates ---------------------------------------------------------------------------

export function feedUrl(apiPublicUrl: string, token: string): string {
  return `${apiPublicUrl.replace(/\/+$/, '')}/public/v1/calendar/${token}.ics`;
}

function requireUser(ctx: RequestContext): string {
  if (!ctx.actor.userId) throw new AppError('UNAUTHENTICATED');
  return ctx.actor.userId;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = parseDate(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return (parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000;
}

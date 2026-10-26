import { JOB_KINDS, type NotificationKind } from '@extrawork/contracts';
import {
  enqueueJob,
  type AudienceMember,
  type NotificationPreferencesRow,
  type NotificationRow,
  type ProjectAudience,
  type TransactionContext,
} from '@extrawork/db';
import { authorize, type TenantContext } from '@extrawork/domain';
import type { AppContext, RequestContext } from '../context.js';

/**
 * In-app notifications, with an email copy when the recipient wants one —
 * spec 2026-10-12, D14.
 *
 * Every write happens inside the caller's transaction: the notification about
 * a request exists if and only if the request does. The email is a job, so a
 * mail outage never rolls back the event it describes (report §7.6).
 */

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** In-app path, e.g. `/app/changes/{id}`. Never an absolute URL. */
  linkPath?: string | null;
  projectId: string | null;
  actorLabel?: string | null;
  dedupeKey?: string | null;
}

export class NotificationService {
  constructor(private readonly app: AppContext) {}

  /** Notifies explicit users. Duplicate user ids collapse to one row each. */
  async notifyUsers(
    tx: TransactionContext,
    tenant: TenantContext,
    userIds: readonly string[],
    input: NotifyInput,
  ): Promise<NotificationRow[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const written = await this.app.repos.notifications.insertMany(
      tx,
      tenant,
      unique.map((userId) => ({
        userId,
        projectId: input.projectId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        linkPath: input.linkPath ?? null,
        actorLabel: input.actorLabel ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })),
    );
    for (const row of written) {
      await enqueueJob(tx, {
        kind: JOB_KINDS.SEND_NOTIFICATION_EMAIL,
        organizationId: tenant.organizationId,
        payload: { organizationId: tenant.organizationId, notificationId: row.id },
        dedupeKey: `notification-email:${row.id}`,
      });
    }
    return written;
  }

  /**
   * Notifies the people on a project. `excludeUserIds` keeps the person who
   * caused the event from being told about their own action.
   */
  async notifyProject(
    tx: TransactionContext,
    tenant: TenantContext,
    input: NotifyInput & {
      projectId: string;
      audience: ProjectAudience;
      excludeUserIds?: readonly (string | null | undefined)[];
    },
  ): Promise<NotificationRow[]> {
    const audience = await this.audience(tx, tenant, input.projectId, input.audience);
    const excluded = new Set((input.excludeUserIds ?? []).filter(Boolean));
    return this.notifyUsers(
      tx,
      tenant,
      audience.filter((m) => !excluded.has(m.userId)).map((m) => m.userId),
      input,
    );
  }

  async audience(
    tx: TransactionContext,
    tenant: TenantContext,
    projectId: string,
    audience: ProjectAudience,
  ): Promise<AudienceMember[]> {
    return this.app.repos.notifications.projectAudience(tx.db, tenant, projectId, audience);
  }

  // --- The signed-in user's own inbox ----------------------------------------

  async list(
    ctx: RequestContext,
    options: { unreadOnly?: boolean; cursor?: string; limit: number },
  ) {
    const userId = this.requireUser(ctx);
    authorize(ctx.actor, 'notification:read', { organizationId: ctx.actor.organizationId });
    return this.app.repos.notifications.listForUser(ctx.tenant, userId, options);
  }

  async markRead(
    ctx: RequestContext,
    target: { ids: readonly string[] } | { all: true },
  ): Promise<number> {
    const userId = this.requireUser(ctx);
    authorize(ctx.actor, 'notification:read', { organizationId: ctx.actor.organizationId });
    return this.app.uow.transaction((tx) =>
      this.app.repos.notifications.markRead(tx, ctx.tenant, userId, target),
    );
  }

  async summary(ctx: RequestContext) {
    const userId = this.requireUser(ctx);
    return this.app.repos.notifications.unreadSummaryForUser(userId);
  }

  async getPreferences(ctx: RequestContext): Promise<NotificationPreferencesRow> {
    const userId = this.requireUser(ctx);
    authorize(ctx.actor, 'notification:read', { organizationId: ctx.actor.organizationId });
    return this.app.repos.notifications.getPreferences(this.app.uow.db, ctx.tenant, userId);
  }

  async updatePreferences(
    ctx: RequestContext,
    prefs: NotificationPreferencesRow,
  ): Promise<NotificationPreferencesRow> {
    const userId = this.requireUser(ctx);
    // Preferences are personal: reading your own inbox is the only right needed,
    // and a lapsed subscription must not stop someone turning email off.
    authorize(ctx.actor, 'notification:read', { organizationId: ctx.actor.organizationId });
    return this.app.uow.transaction((tx) =>
      this.app.repos.notifications.upsertPreferences(tx, ctx.tenant, userId, prefs),
    );
  }

  private requireUser(ctx: RequestContext): string {
    if (!ctx.actor.userId) {
      throw new Error('notifications require a signed-in user');
    }
    return ctx.actor.userId;
  }
}

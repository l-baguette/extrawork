import type { JobRow } from '@extrawork/db';
import { systemTenantContext } from '@extrawork/domain';
import type { WorkerContext } from '../context.js';
import { PermanentJobError, requirePayloadUuid, requireTenant } from '../runner.js';

/**
 * The email copy of an in-app notification — spec 2026-10-12, D14.
 *
 * Idempotent on the notification id: the job is deduplicated at enqueue time,
 * and the provider idempotency key repeats the id, so a retry after a crash
 * between "sent" and "job completed" is collapsed by the email gateway.
 *
 * The recipient's preference is read here, at send time, not when the
 * notification was written: someone who turns email off should stop getting
 * it immediately, including for anything already queued.
 */
export async function sendNotificationEmail(job: JobRow, ctx: WorkerContext): Promise<void> {
  const notificationId = requirePayloadUuid(job, 'notificationId');
  const organizationId = requireTenant(job);
  const tenant = systemTenantContext(organizationId, `job:${job.id}`);
  const log = ctx.logger.child({ notificationId, step: 'notification-email' });

  const notification = await ctx.repos.notifications.findById(ctx.db, tenant, notificationId);
  if (!notification) {
    // Deleted with its project or organization since it was queued.
    log.debug('notification no longer exists; nothing to email');
    return;
  }
  if (notification.readAt) {
    log.debug('notification already read in the app; email skipped');
    return;
  }

  const prefs = await ctx.repos.notifications.getPreferences(ctx.db, tenant, notification.userId);
  if (!prefs.emailEnabled) return;

  const gateway = ctx.app.integrations.email;
  if (!gateway.canDeliver) {
    log.debug({ channel: gateway.channel }, 'email gateway cannot deliver');
    return;
  }

  const [user, organization] = await Promise.all([
    ctx.repos.identity.findUserById(notification.userId),
    ctx.repos.organizations.findById(tenant),
  ]);
  if (!user || !user.emailNormalized) {
    throw new PermanentJobError('RECIPIENT_MISSING', 'Notification recipient has no email');
  }

  const base = ctx.env.WEB_PUBLIC_URL.replace(/\/+$/, '');
  const link = notification.linkPath ? `${base}${notification.linkPath}` : `${base}/app/inbox`;
  const workspace = organization?.displayName ?? 'ExtraWork';

  await gateway.send({
    to: { email: user.emailNormalized, name: user.displayName },
    subject: `${notification.title} · ${workspace}`,
    body: [
      `Hello ${user.displayName},`,
      '',
      notification.title,
      ...(notification.body ? ['', notification.body] : []),
      '',
      `Open it: ${link}`,
      '',
      `You are receiving this because you are on a project in ${workspace}.`,
      `Turn these emails off in Settings → Notifications: ${base}/app/settings/notifications`,
    ].join('\n'),
    purpose: 'NOTIFICATION',
    idempotencyKey: `notification:${notification.id}`,
    organizationName: workspace,
  });
}

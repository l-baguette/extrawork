import type { VersionStatus } from '@extrawork/contracts';
import { isOpenForDecision } from '../change-orders/state-machine.js';

/**
 * Reminder engine — report §8.6.
 *
 * A reminder is suppressed if the request is decided, revoked, the contact has
 * opted out, it falls outside allowed local hours, or it is rate limited. The
 * worker re-checks state immediately before send, so this module is a pure
 * decision function that both the scheduler and the sender call.
 *
 * In the native-share MVP a "reminder" produces a prefilled message for the
 * contractor to send. The system never claims automated delivery (report §10.3).
 */

export interface ReminderPolicy {
  /** Hours after send at which reminder steps fire, ascending. */
  stepsHoursAfterSend: readonly number[];
  localHourStart: number;
  localHourEnd: number;
  /** Minimum gap between any two reminders for one version. */
  cooldownHours: number;
}

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  stepsHoursAfterSend: [24, 72],
  localHourStart: 9,
  localHourEnd: 20,
  cooldownHours: 12,
};

export type ReminderChannel = 'WHATSAPP_NATIVE_SHARE' | 'EMAIL';

/** Report §8.6: `reminder:{version_id}:{policy_step}:{channel}`. */
export function reminderDedupeKey(
  versionId: string,
  policyStep: number,
  channel: ReminderChannel,
): string {
  return `reminder:${versionId}:${policyStep}:${channel}`;
}

export type SuppressionReason =
  | 'DECIDED'
  | 'NOT_OPEN'
  | 'REVOKED'
  | 'EXPIRED'
  | 'OPTED_OUT'
  | 'OUTSIDE_LOCAL_HOURS'
  | 'COOLDOWN'
  | 'ALREADY_SENT'
  | 'NO_CHANNEL';

export interface ReminderContext {
  versionStatus: VersionStatus;
  tokenRevoked: boolean;
  expiresAt: Date;
  optedOut: boolean;
  lastReminderAt: Date | null;
  alreadySentSteps: ReadonlySet<string>;
  dedupeKey: string;
  hasChannel: boolean;
  /** IANA zone of the organization, e.g. Asia/Kolkata. */
  timezone: string;
  now: Date;
  policy: ReminderPolicy;
}

export interface ReminderDecision {
  send: boolean;
  reason: SuppressionReason | null;
  /** When suppressed only by local hours or cooldown, when to try again. */
  retryAt: Date | null;
}

export function localHourIn(timezone: string, at: Date): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).format(at);
  return Number.parseInt(formatted, 10);
}

export function shouldSendReminder(ctx: ReminderContext): ReminderDecision {
  if (!ctx.hasChannel) return { send: false, reason: 'NO_CHANNEL', retryAt: null };
  if (!isOpenForDecision(ctx.versionStatus)) {
    const reason: SuppressionReason =
      ctx.versionStatus === 'APPROVED' ||
      ctx.versionStatus === 'DECLINED' ||
      ctx.versionStatus === 'REVISION_REQUESTED'
        ? 'DECIDED'
        : 'NOT_OPEN';
    return { send: false, reason, retryAt: null };
  }
  if (ctx.tokenRevoked) return { send: false, reason: 'REVOKED', retryAt: null };
  if (ctx.expiresAt.getTime() <= ctx.now.getTime()) {
    return { send: false, reason: 'EXPIRED', retryAt: null };
  }
  if (ctx.optedOut) return { send: false, reason: 'OPTED_OUT', retryAt: null };
  if (ctx.alreadySentSteps.has(ctx.dedupeKey)) {
    return { send: false, reason: 'ALREADY_SENT', retryAt: null };
  }

  if (ctx.lastReminderAt) {
    const nextAllowed = new Date(
      ctx.lastReminderAt.getTime() + ctx.policy.cooldownHours * 3_600_000,
    );
    if (nextAllowed > ctx.now) {
      return { send: false, reason: 'COOLDOWN', retryAt: nextAllowed };
    }
  }

  const hour = localHourIn(ctx.timezone, ctx.now);
  if (hour < ctx.policy.localHourStart || hour >= ctx.policy.localHourEnd) {
    return { send: false, reason: 'OUTSIDE_LOCAL_HOURS', retryAt: nextLocalWindow(ctx) };
  }

  return { send: true, reason: null, retryAt: null };
}

/** Next instant at which the organization's local send window opens. */
export function nextLocalWindow(ctx: Pick<ReminderContext, 'timezone' | 'now' | 'policy'>): Date {
  const candidate = new Date(ctx.now.getTime());
  for (let i = 0; i < 48; i += 1) {
    candidate.setTime(candidate.getTime() + 3_600_000);
    const hour = localHourIn(ctx.timezone, candidate);
    if (hour >= ctx.policy.localHourStart && hour < ctx.policy.localHourEnd) {
      return candidate;
    }
  }
  return new Date(ctx.now.getTime() + 86_400_000);
}

export interface ScheduledReminder {
  policyStep: number;
  dueAt: Date;
  dedupeKey: string;
}

/**
 * Builds the schedule at send time. Steps that would land after the expiry are
 * dropped rather than clamped, so a reminder never arrives about a dead link.
 */
export function buildReminderSchedule(
  versionId: string,
  sentAt: Date,
  expiresAt: Date,
  channel: ReminderChannel,
  policy: ReminderPolicy = DEFAULT_REMINDER_POLICY,
): ScheduledReminder[] {
  return policy.stepsHoursAfterSend
    .map((hours) => ({
      policyStep: hours,
      dueAt: new Date(sentAt.getTime() + hours * 3_600_000),
      dedupeKey: reminderDedupeKey(versionId, hours, channel),
    }))
    .filter((step) => step.dueAt < expiresAt);
}

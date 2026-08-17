import { AppError } from '@extrawork/contracts';

/**
 * Entitlement engine — report §8.7.
 *
 * The critical rule, stated plainly in the report: "Do not delete or hide
 * historical evidence when a subscription lapses. Move the organization to
 * read/export mode, stop new sends after grace, and preserve access according
 * to retention policy."
 *
 * So `readOnly` gates writes only. Nothing here can hide or delete a record.
 */

export interface Entitlements {
  activeProjects: number;
  completedDecisionsPerPeriod: number;
  teamMembers: number;
  automatedWhatsApp: boolean;
  otpApprovals: boolean;
  customBranding: boolean;
  retentionMonths: number;
}

export type PlanCode = 'TRIAL' | 'STARTER_MONTHLY' | 'PROJECT_PASS' | 'PRO_MONTHLY';
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'GRACE' | 'LAPSED' | 'CANCELLED';

const UNLIMITED = Number.MAX_SAFE_INTEGER;

/**
 * Report §16.1 recommends offering both INR 499/month and INR 399/project while
 * field evidence decides between them, so both shapes exist from day one.
 */
export const PLANS: Record<
  PlanCode,
  { name: string; priceMinor: number; entitlements: Entitlements }
> = {
  TRIAL: {
    name: 'Trial',
    priceMinor: 0,
    entitlements: {
      activeProjects: 2,
      completedDecisionsPerPeriod: 10,
      teamMembers: 2,
      automatedWhatsApp: false,
      otpApprovals: false,
      customBranding: false,
      retentionMonths: 36,
    },
  },
  STARTER_MONTHLY: {
    name: 'Starter',
    priceMinor: 49_900,
    entitlements: {
      activeProjects: 10,
      completedDecisionsPerPeriod: 100,
      teamMembers: 5,
      automatedWhatsApp: false,
      otpApprovals: false,
      customBranding: true,
      retentionMonths: 36,
    },
  },
  PROJECT_PASS: {
    name: 'Project pass',
    priceMinor: 39_900,
    entitlements: {
      activeProjects: 1,
      completedDecisionsPerPeriod: 50,
      teamMembers: 3,
      automatedWhatsApp: false,
      otpApprovals: false,
      customBranding: false,
      retentionMonths: 36,
    },
  },
  PRO_MONTHLY: {
    name: 'Pro',
    priceMinor: 149_900,
    entitlements: {
      activeProjects: UNLIMITED,
      completedDecisionsPerPeriod: UNLIMITED,
      teamMembers: 25,
      automatedWhatsApp: true,
      otpApprovals: true,
      customBranding: true,
      retentionMonths: 60,
    },
  },
};

export interface SubscriptionState {
  planCode: PlanCode;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  graceEndsAt: Date | null;
}

export interface UsageCounters {
  activeProjects: number;
  completedDecisionsThisPeriod: number;
  teamMembers: number;
}

export function entitlementsFor(subscription: SubscriptionState): Entitlements {
  return PLANS[subscription.planCode].entitlements;
}

/**
 * An organization is read-only once the subscription has lapsed or been
 * cancelled and any grace period has passed.
 */
export function isReadOnly(subscription: SubscriptionState, now: Date = new Date()): boolean {
  if (subscription.status === 'ACTIVE' || subscription.status === 'TRIALING') return false;
  if (subscription.status === 'GRACE') {
    return subscription.graceEndsAt ? now.getTime() > subscription.graceEndsAt.getTime() : false;
  }
  return true;
}

export type QuotaKey = 'activeProjects' | 'completedDecisionsPerPeriod' | 'teamMembers';

export interface QuotaCheck {
  allowed: boolean;
  limit: number;
  used: number;
}

export function checkQuota(
  entitlements: Entitlements,
  usage: UsageCounters,
  key: QuotaKey,
): QuotaCheck {
  const limit = entitlements[key];
  const used =
    key === 'activeProjects'
      ? usage.activeProjects
      : key === 'teamMembers'
        ? usage.teamMembers
        : usage.completedDecisionsThisPeriod;
  return { allowed: used < limit, limit, used };
}

export function assertQuota(entitlements: Entitlements, usage: UsageCounters, key: QuotaKey): void {
  const result = checkQuota(entitlements, usage, key);
  if (!result.allowed) {
    throw new AppError('ENTITLEMENT_EXCEEDED', {
      message: quotaMessage(key, result.limit),
      details: { quota: key, limit: result.limit, used: result.used },
    });
  }
}

function quotaMessage(key: QuotaKey, limit: number): string {
  switch (key) {
    case 'activeProjects':
      return `Your plan allows ${limit} active projects. Close a project or upgrade to add another.`;
    case 'teamMembers':
      return `Your plan allows ${limit} team members.`;
    case 'completedDecisionsPerPeriod':
      return `Your plan allows ${limit} completed decisions per billing period.`;
    default:
      return 'Your plan limit for this action has been reached.';
  }
}

export type FeatureKey = 'automatedWhatsApp' | 'otpApprovals' | 'customBranding';

export function assertFeature(entitlements: Entitlements, feature: FeatureKey): void {
  if (!entitlements[feature]) {
    throw new AppError('FEATURE_NOT_ENTITLED', { details: { feature } });
  }
}

/**
 * A decision counts against the period quota only when it completes. A
 * customer's decision must never be refused because the *contractor's* plan
 * ran out — the quota is checked at send time instead (report §13.1 puts the
 * decision write path above everything else).
 */
export function quotaCheckedAtSend(): QuotaKey {
  return 'completedDecisionsPerPeriod';
}

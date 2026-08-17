import { describe, expect, it } from 'vitest';
import { AppError, type MembershipRole } from '@extrawork/contracts';
import {
  ACTIONS,
  REAUTH_REQUIRED_ACTIONS,
  assertFreshAuthentication,
  assertWritableSubscription,
  authorize,
  isAllowed,
  roleAllows,
  type Action,
  type Actor,
} from '@extrawork/domain';

/**
 * Authorization matrix — report §3.1, §3.2 and §14.5.
 *
 * The report defines the rule as
 *   actor.organization_id == resource.organization_id
 *   AND role_allows(actor.role, action)
 *   AND (role in {OWNER, ADMIN} OR resource.project_id in actor.project_grants)
 */

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const PROJECT = 'project-1';
const OTHER_PROJECT = 'project-2';

function actor(role: MembershipRole, grants: string[] = []): Actor {
  return {
    userId: 'user-1',
    organizationId: ORG,
    role,
    projectGrants: new Set(grants),
    authenticatedAt: Date.now(),
  };
}

describe('role capabilities', () => {
  it('gives OWNER every action', () => {
    for (const action of ACTIONS) expect(roleAllows('OWNER', action)).toBe(true);
  });

  it('withholds only ownership transfer from ADMIN', () => {
    const denied = ACTIONS.filter((a) => !roleAllows('ADMIN', a));
    expect(denied).toEqual(['organization:transfer_ownership']);
  });

  it('lets FINANCE read and export but never change scope', () => {
    // Report §3.1: Finance "cannot change scope".
    expect(roleAllows('FINANCE', 'change_order:read')).toBe(true);
    expect(roleAllows('FINANCE', 'report:export')).toBe(true);
    expect(roleAllows('FINANCE', 'project:export')).toBe(true);
    for (const action of [
      'change_order:create',
      'change_order:update_draft',
      'change_order:send',
      'change_order:cancel',
      'change_order:create_revision',
      'project:create',
      'project:update',
      'project:amend_baseline',
      'customer:create',
      'file:upload',
    ] as Action[]) {
      expect(roleAllows('FINANCE', action)).toBe(false);
    }
  });

  it('makes VIEWER strictly read-only', () => {
    for (const action of ACTIONS) {
      if (roleAllows('VIEWER', action)) {
        expect(action.endsWith(':read') || action === 'change_order:read_evidence').toBe(true);
      }
    }
  });

  it('lets PROJECT_MANAGER run the change lifecycle but not manage the org', () => {
    expect(roleAllows('PROJECT_MANAGER', 'change_order:send')).toBe(true);
    expect(roleAllows('PROJECT_MANAGER', 'change_order:create_revision')).toBe(true);
    expect(roleAllows('PROJECT_MANAGER', 'member:invite')).toBe(false);
    expect(roleAllows('PROJECT_MANAGER', 'organization:update')).toBe(false);
    expect(roleAllows('PROJECT_MANAGER', 'organization:manage_billing')).toBe(false);
    expect(roleAllows('PROJECT_MANAGER', 'project:amend_baseline')).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('denies every action across organizations, for every role', () => {
    for (const role of [
      'OWNER',
      'ADMIN',
      'PROJECT_MANAGER',
      'FINANCE',
      'VIEWER',
    ] as MembershipRole[]) {
      for (const action of ACTIONS) {
        expect(isAllowed(actor(role), action, { organizationId: OTHER_ORG })).toBe(false);
      }
    }
  });

  it('reports a cross-tenant reference as NOT_FOUND, never FORBIDDEN', () => {
    // Report §12.2: a probe must not be able to confirm an id exists elsewhere.
    try {
      authorize(actor('OWNER'), 'project:read', { organizationId: OTHER_ORG, projectId: PROJECT });
      throw new Error('expected authorize to throw');
    } catch (error) {
      expect(AppError.is(error)).toBe(true);
      expect((error as AppError).code).toBe('NOT_FOUND');
    }
  });
});

describe('project grants', () => {
  it('lets OWNER, ADMIN and FINANCE see any project without a grant', () => {
    for (const role of ['OWNER', 'ADMIN', 'FINANCE'] as MembershipRole[]) {
      expect(
        isAllowed(actor(role), 'project:read', { organizationId: ORG, projectId: PROJECT }),
      ).toBe(true);
    }
  });

  it('restricts PROJECT_MANAGER and VIEWER to granted projects', () => {
    for (const role of ['PROJECT_MANAGER', 'VIEWER'] as MembershipRole[]) {
      const granted = actor(role, [PROJECT]);
      expect(isAllowed(granted, 'project:read', { organizationId: ORG, projectId: PROJECT })).toBe(
        true,
      );
      expect(
        isAllowed(granted, 'project:read', { organizationId: ORG, projectId: OTHER_PROJECT }),
      ).toBe(false);
    }
  });

  it('raises FORBIDDEN, not NOT_FOUND, for an in-tenant project without a grant', () => {
    // The resource is known to exist in the caller's own tenant, so hiding it
    // would be misleading rather than protective.
    try {
      authorize(actor('PROJECT_MANAGER', []), 'change_order:read', {
        organizationId: ORG,
        projectId: PROJECT,
      });
      throw new Error('expected authorize to throw');
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN');
    }
  });
});

describe('privileged re-authentication', () => {
  it('requires a fresh session for ownership, retention and support access', () => {
    // Report §12.1.
    expect([...REAUTH_REQUIRED_ACTIONS].sort()).toEqual(
      [
        'member:remove',
        'organization:grant_support_access',
        'organization:manage_retention',
        'organization:transfer_ownership',
      ].sort(),
    );
  });

  it('rejects a stale authentication for a privileged action', () => {
    const stale = { ...actor('OWNER'), authenticatedAt: Date.now() - 10 * 60_000 };
    expect(() => assertFreshAuthentication(stale, 'organization:transfer_ownership')).toThrowError(
      expect.objectContaining({ code: 'REAUTHENTICATION_REQUIRED' }),
    );
  });

  it('leaves ordinary actions alone', () => {
    const stale = { ...actor('OWNER'), authenticatedAt: Date.now() - 10 * 60_000 };
    expect(() => assertFreshAuthentication(stale, 'change_order:create')).not.toThrow();
  });
});

describe('read-only subscription', () => {
  it('still permits reads and exports when a subscription lapses', () => {
    // Report §8.7 and launch blocker §16.3: "A customer can export records even
    // after subscription lapse."
    for (const action of [
      'project:read',
      'project:export',
      'change_order:read',
      'change_order:read_evidence',
      'report:export',
      'organization:manage_billing',
    ] as Action[]) {
      expect(() => assertWritableSubscription(action, true)).not.toThrow();
    }
  });

  it('blocks new work when a subscription lapses', () => {
    for (const action of [
      'change_order:create',
      'change_order:send',
      'project:create',
      'customer:create',
    ] as Action[]) {
      expect(() => assertWritableSubscription(action, true)).toThrowError(
        expect.objectContaining({ code: 'SUBSCRIPTION_READ_ONLY' }),
      );
    }
  });

  it('does nothing when the subscription is active', () => {
    for (const action of ACTIONS) {
      expect(() => assertWritableSubscription(action, false)).not.toThrow();
    }
  });
});

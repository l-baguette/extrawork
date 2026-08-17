import { AppError, type MembershipRole } from '@extrawork/contracts';

/**
 * Central authorization — report §3.2:
 *
 *   allow(actor, action, resource) =
 *     actor.organization_id == resource.organization_id
 *     AND role_allows(actor.role, action)
 *     AND (actor.role in {OWNER, ADMIN} OR resource.project_id in actor.project_grants)
 *
 * Backend authorization is mandatory even when the UI hides the control
 * (report §3.2), so every route resolves an actor and calls `authorize`.
 */

export const ACTIONS = [
  // Organization
  'organization:read',
  'organization:update',
  'organization:transfer_ownership',
  'organization:manage_billing',
  'organization:manage_retention',
  'organization:grant_support_access',
  // Members
  'member:read',
  'member:invite',
  'member:update_role',
  'member:remove',
  // Customers
  'customer:read',
  'customer:create',
  'customer:update',
  'customer:merge',
  // Projects
  'project:read',
  'project:create',
  'project:update',
  'project:amend_baseline',
  'project:close',
  'project:export',
  // Change orders
  'change_order:read',
  'change_order:create',
  'change_order:update_draft',
  'change_order:send',
  'change_order:remind',
  'change_order:cancel',
  'change_order:create_revision',
  'change_order:read_evidence',
  // Files
  'file:upload',
  'file:read',
  // Employees (WhatsApp intake). Managing who may raise a request, and their
  // spending ceiling, is the owner's principal control — so writes are limited
  // to OWNER/ADMIN while every role may read.
  'employee:read',
  'employee:create',
  'employee:update',
  'employee:remove',
  // The customer-facing copy the owner controls. The assurance language is not
  // editable through any action here; it lives in code (report §3.3, §12.4).
  'request_template:read',
  'request_template:update',
  // The inbound message log, including messages that were rejected.
  'inbound_message:read',
  // Reporting
  'report:read',
  'report:export',
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * Role capabilities from report §3.1. FINANCE can read everything and export
 * but explicitly "cannot change scope". VIEWER is read-only.
 */
const ROLE_ACTIONS: Record<MembershipRole, ReadonlySet<Action>> = {
  OWNER: new Set(ACTIONS),
  ADMIN: new Set<Action>(ACTIONS.filter((a) => a !== 'organization:transfer_ownership')),
  PROJECT_MANAGER: new Set<Action>([
    'organization:read',
    'member:read',
    'customer:read',
    'customer:create',
    'customer:update',
    'project:read',
    'project:create',
    'project:update',
    'project:export',
    'change_order:read',
    'change_order:create',
    'change_order:update_draft',
    'change_order:send',
    'change_order:remind',
    'change_order:cancel',
    'change_order:create_revision',
    'change_order:read_evidence',
    'file:upload',
    'file:read',
    'employee:read',
    'request_template:read',
    'inbound_message:read',
    'report:read',
  ]),
  FINANCE: new Set<Action>([
    'organization:read',
    'member:read',
    'customer:read',
    'project:read',
    'project:export',
    'change_order:read',
    'change_order:read_evidence',
    'file:read',
    'employee:read',
    'request_template:read',
    'inbound_message:read',
    'report:read',
    'report:export',
  ]),
  VIEWER: new Set<Action>([
    'organization:read',
    'customer:read',
    'project:read',
    'change_order:read',
    'change_order:read_evidence',
    'file:read',
    'employee:read',
    'request_template:read',
    'inbound_message:read',
    'report:read',
  ]),
};

/** Roles that see every project without an explicit grant. */
const ORG_WIDE_ROLES: ReadonlySet<MembershipRole> = new Set<MembershipRole>([
  'OWNER',
  'ADMIN',
  'FINANCE',
]);

/**
 * Actions that require a fresh re-authentication regardless of role
 * (report §12.1: "privileged action reauthentication for ownership, retention,
 * or support access").
 */
export const REAUTH_REQUIRED_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'organization:transfer_ownership',
  'organization:manage_retention',
  'organization:grant_support_access',
  'member:remove',
]);

export interface Actor {
  /**
   * Null when no human is behind the action.
   *
   * A WhatsApp intake is the case that requires this: the employee who raised
   * the request has no user account by design — their phone number is their
   * whole identity — so there is no user id to attribute the write to. The
   * originator is recorded as `change_order_versions.raised_by_employee_id`
   * instead, and the audit event carries `actorType: 'SYSTEM'`.
   *
   * Naming a user here who did not act would put a false name on an
   * append-only evidence record, which is the one thing this system must not
   * do. `audit_events.actor_id` and `created_by_user_id` are both nullable in
   * the schema precisely for this.
   */
  userId: string | null;
  organizationId: string;
  role: MembershipRole;
  /** Project ids explicitly granted to a PROJECT_MANAGER/VIEWER. */
  projectGrants: ReadonlySet<string>;
  /** Epoch millis of the last strong authentication, for reauth checks. */
  authenticatedAt: number;
}

export interface ResourceRef {
  organizationId: string;
  /** Absent for organization-level resources. */
  projectId?: string | null;
}

export function roleAllows(role: MembershipRole, action: Action): boolean {
  return ROLE_ACTIONS[role].has(action);
}

export function hasProjectAccess(actor: Actor, projectId: string | null | undefined): boolean {
  if (!projectId) return true;
  if (ORG_WIDE_ROLES.has(actor.role)) return true;
  return actor.projectGrants.has(projectId);
}

export function isAllowed(actor: Actor, action: Action, resource: ResourceRef): boolean {
  if (actor.organizationId !== resource.organizationId) return false;
  if (!roleAllows(actor.role, action)) return false;
  return hasProjectAccess(actor, resource.projectId);
}

/**
 * Throws with the right code. A cross-tenant reference returns NOT_FOUND rather
 * than FORBIDDEN so that an attacker cannot use the error to confirm that an id
 * exists in another organization (report §12.2, cross-tenant IDOR).
 */
export function authorize(actor: Actor, action: Action, resource: ResourceRef): void {
  if (actor.organizationId !== resource.organizationId) {
    throw new AppError('NOT_FOUND');
  }
  if (!roleAllows(actor.role, action)) {
    throw new AppError('FORBIDDEN', { details: { action, role: actor.role } });
  }
  if (!hasProjectAccess(actor, resource.projectId)) {
    throw new AppError('FORBIDDEN', {
      message: 'You are not assigned to this project.',
      details: { action },
    });
  }
}

const REAUTH_WINDOW_MS = 5 * 60 * 1000;

export function assertFreshAuthentication(
  actor: Actor,
  action: Action,
  now: number = Date.now(),
): void {
  if (!REAUTH_REQUIRED_ACTIONS.has(action)) return;
  if (now - actor.authenticatedAt > REAUTH_WINDOW_MS) {
    throw new AppError('REAUTHENTICATION_REQUIRED', { details: { action } });
  }
}

/** Actions that mutate state, used to decide whether write-mode is required. */
export function isMutatingAction(action: Action): boolean {
  return !action.endsWith(':read') && action !== 'report:read';
}

/**
 * Report §8.7: a lapsed subscription moves the organization to read/export
 * mode. Reads and exports keep working; new sends and new work do not.
 */
const READ_ONLY_SAFE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'organization:read',
  'organization:manage_billing',
  'member:read',
  'customer:read',
  'project:read',
  'project:export',
  'change_order:read',
  'change_order:read_evidence',
  'file:read',
  'report:read',
  'report:export',
]);

export function assertWritableSubscription(action: Action, readOnly: boolean): void {
  if (!readOnly) return;
  if (READ_ONLY_SAFE_ACTIONS.has(action)) return;
  throw new AppError('SUBSCRIPTION_READ_ONLY', { details: { action } });
}

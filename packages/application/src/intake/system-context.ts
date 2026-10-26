import type { Actor, TenantContext } from '@extrawork/domain';
import type { RequestContext } from '../context.js';

/**
 * The context the change-order services run under when a request arrives from
 * someone with no account: a site-team member or homeowner on WhatsApp, or a
 * homeowner on the portal (spec 2026-10-12, D5/D6).
 *
 * `userId` is null and the audit actor will be SYSTEM: nobody signed in, and
 * naming a user who did not act would falsify an append-only record. Who
 * actually raised it is stored on the version (`raised_by_employee_id` or
 * `submitted_by_contact_id`).
 *
 * PROJECT_MANAGER is the narrowest existing role that may create, propose and
 * send a change request, and the grant holds only the one resolved project, so
 * this machine context cannot use broader owner powers or reach another
 * project.
 */
export function channelRequestContext(
  tenant: TenantContext,
  projectId: string,
  userAgent: string,
): RequestContext {
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
    userAgent,
    readOnly: false,
  };
}

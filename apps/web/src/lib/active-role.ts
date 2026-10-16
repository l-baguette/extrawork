import type { CurrentUserDto, MembershipRole } from '@extrawork/contracts';
import { serverGet } from './server-fetch';

/**
 * The signed-in person's role in the active workspace, for deciding which
 * controls a server-rendered page offers.
 *
 * Only ever a presentation hint: the API authorizes every action again
 * (report §3.2), so a stale or wrong answer here shows a button that fails
 * politely, never grants anything.
 */
export interface ActiveMembership {
  userId: string;
  role: MembershipRole;
}

export async function activeMembership(): Promise<ActiveMembership | null> {
  const me = await serverGet<CurrentUserDto>('/v1/auth/me');
  if (!me.ok) return null;
  const active =
    me.data.memberships.find((m) => m.organizationId === me.data.activeOrganizationId) ??
    me.data.memberships[0];
  if (!active) return null;
  return { userId: me.data.user.id, role: active.role };
}

export { canCloseProject, canInvoice, canPropose, isDesigner } from './role-hints';

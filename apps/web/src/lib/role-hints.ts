import type { MembershipRole } from '@extrawork/contracts';

/**
 * Which controls a page offers for a role. Presentation only: the API
 * authorizes every action again (report §3.2), so a wrong answer here shows a
 * button that fails politely, never grants anything. `tests/unit/role-hints.test.ts`
 * keeps each one equal to the domain policy it mirrors, because `apps/web`
 * may not import `@extrawork/domain`.
 *
 * Kept free of `@/` imports and Next.js APIs so the unit project can load it.
 */

/** Review, price, send and dismiss requests: the designer's firm (spec D4). */
export function isDesigner(role: MembershipRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'PROJECT_MANAGER';
}

/** Raise a request for review (`change_order:propose`). */
export function canPropose(role: MembershipRole | null | undefined): boolean {
  return isDesigner(role) || role === 'COLLABORATOR';
}

/** Tier 1 B: mark approved changes as billed (`change_order:invoice`). */
export function canInvoice(role: MembershipRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'FINANCE';
}

/** Close and reopen a project (`project:close`, which the policy gives owner and admin). */
export function canCloseProject(role: MembershipRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

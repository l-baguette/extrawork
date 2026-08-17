import { AppError, type MembershipRole } from '@extrawork/contracts';

/**
 * TenantContext — report §3.2 and §14.4: "No tenant-owned repository method
 * without TenantContext."
 *
 * Every repository method that touches a tenant-owned table takes this as its
 * first argument. It is not optional and it is not derived from the row being
 * read: the organization id always comes from the authenticated session, so a
 * caller cannot widen its own scope by passing an id from a request body.
 */
export interface TenantContext {
  organizationId: string;
  /** Null for system/worker contexts that act on behalf of the tenant. */
  userId: string | null;
  role: MembershipRole | 'SYSTEM' | 'SUPPORT';
  /** Correlates database work with the HTTP request or job run. */
  requestId: string;
}

export function systemTenantContext(organizationId: string, requestId: string): TenantContext {
  return { organizationId, userId: null, role: 'SYSTEM', requestId };
}

export function assertSameTenant(ctx: TenantContext, row: { organizationId: string }): void {
  if (row.organizationId !== ctx.organizationId) {
    // Deliberately NOT_FOUND: a cross-tenant probe must not learn that the id exists.
    throw new AppError('NOT_FOUND');
  }
}

/**
 * Guards a batch of rows loaded by id. Any foreign row aborts the whole
 * operation rather than being filtered out silently, because silent filtering
 * hides a bug that a test should catch.
 */
export function assertAllSameTenant(
  ctx: TenantContext,
  rows: ReadonlyArray<{ organizationId: string }>,
): void {
  for (const row of rows) assertSameTenant(ctx, row);
}

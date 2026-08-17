/**
 * TanStack Query keys — report §6.4 lists these verbatim:
 *
 *   ['organization', organizationId]
 *   ['projects', organizationId, filters]
 *   ['project', projectId]
 *   ['changeOrder', changeOrderId]
 *   ['changeOrderVersions', changeOrderId]
 *   ['dashboard', organizationId, dateRange]
 *
 * Centralising them is what makes "invalidate narrowly after mutations"
 * enforceable: a mutation names the exact key it affects rather than clearing
 * the cache.
 */
export const queryKeys = {
  me: () => ['me'] as const,
  organization: (organizationId: string) => ['organization', organizationId] as const,
  members: (organizationId: string) => ['members', organizationId] as const,

  dashboard: (organizationId: string, dateRange = 'current-month') =>
    ['dashboard', organizationId, dateRange] as const,

  customers: (organizationId: string, filters: Record<string, unknown> = {}) =>
    ['customers', organizationId, filters] as const,
  customer: (customerId: string) => ['customer', customerId] as const,

  projects: (organizationId: string, filters: Record<string, unknown> = {}) =>
    ['projects', organizationId, filters] as const,
  project: (projectId: string) => ['project', projectId] as const,
  changeRegister: (projectId: string) => ['changeRegister', projectId] as const,

  changeOrders: (organizationId: string, filters: Record<string, unknown> = {}) =>
    ['changeOrders', organizationId, filters] as const,
  changeOrder: (changeOrderId: string) => ['changeOrder', changeOrderId] as const,
  changeOrderVersions: (changeOrderId: string) => ['changeOrderVersions', changeOrderId] as const,
  changeOrderEvents: (changeOrderId: string) => ['changeOrderEvents', changeOrderId] as const,

  search: (organizationId: string, term: string) => ['search', organizationId, term] as const,
  report: (organizationId: string, filters: Record<string, unknown> = {}) =>
    ['report', organizationId, filters] as const,
} as const;
